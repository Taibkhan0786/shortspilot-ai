import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { exchangeCode, fetchMyChannel, syncChannel, getRedirectUri } from "@/lib/youtube";
import { encryptField } from "@/lib/password";
import { audit, notify } from "@/lib/notify";
import { pickThumbUrl } from "./thumb";

/**
 * GET /api/v1/youtube/callback — Google redirects back here after consent.
 * Exchanges the code for tokens, creates the connected channel with real stats,
 * then redirects the SPA back to /?yt=connected (or ?yt=error&msg=…).
 */
export async function GET(req: NextRequest) {
  const base = getBase(req);
  const fail = (msg: string) => NextResponse.redirect(`${base}/?yt=error&msg=${encodeURIComponent(msg.slice(0, 180))}`);

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");

    if (err) return fail(`Google consent was denied (${err})`);
    if (!code || !state) return fail("Missing code/state in OAuth callback");

    // CSRF: state cookie must match
    const cookieState = req.cookies.get("sp_oauth_state")?.value;
    if (!cookieState || cookieState !== state) return fail("OAuth state mismatch — please try connecting again");

    const user = await getSessionUser(req);
    if (!user) return fail("Session expired — sign in and try again");

    // 1) exchange authorization code for tokens
    const tokens = await exchangeCode(code, getRedirectUri(req));

    // 2) fetch the user's real channel
    const ch = await fetchMyChannel(tokens.access_token);
    const channelId = ch.id;

    // 3) upsert the channel (one row per YouTube channel per user)
    const existing = await db.youTubeChannel.findFirst({
      where: { userId: user.id, channelId },
    });

    const subs = parseInt(ch.statistics?.subscriberCount ?? "0", 10);
    const views = parseInt(ch.statistics?.viewCount ?? "0", 10);
    const vids = parseInt(ch.statistics?.videoCount ?? "0", 10);
    const uploadsPlaylist = ch.contentDetails?.relatedPlaylists?.uploads ?? null;
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000);

    let row;
    if (existing) {
      row = await db.youTubeChannel.update({
        where: { id: existing.id },
        data: {
          channelTitle: ch.snippet?.title ?? existing.channelTitle,
          handle: ch.snippet?.customUrl ?? existing.handle,
          description: ch.snippet?.description?.slice(0, 2000),
          country: ch.snippet?.country ?? existing.country,
          thumbnail: pickThumbUrl(ch.snippet?.thumbnails) ?? existing.thumbnail,
          subscribers: subs,
          viewCount: views,
          videoCount: vids,
          encryptedToken: encryptField(tokens.refresh_token ?? ""),
          accessToken: encryptField(tokens.access_token),
          tokenExpiresAt: tokenExpiry,
          uploadsPlaylistId: uploadsPlaylist ?? existing.uploadsPlaylistId,
          scopes: "youtube.readonly youtube.upload youtubepartner",
          mode: "oauth",
          status: "CONNECTED",
          lastSyncError: null,
        },
      });
    } else {
      // plan limit check (same as sandbox connect)
      const { plan } = (await db.subscription.findUnique({ where: { userId: user.id }, include: { plan: true } })) ?? {};
      const count = await db.youTubeChannel.count({ where: { userId: user.id, status: "CONNECTED" } });
      if (plan && count >= plan.channelsLimit) {
        return fail(`Plan limit reached: ${plan.channelsLimit} channel(s) on ${plan.name}. Upgrade to connect more.`);
      }
      row = await db.youTubeChannel.create({
        data: {
          userId: user.id,
          channelId,
          channelTitle: ch.snippet?.title ?? "My YouTube channel",
          handle: ch.snippet?.customUrl ?? null,
          description: ch.snippet?.description?.slice(0, 2000) ?? null,
          country: ch.snippet?.country ?? null,
          thumbnail: pickThumbUrl(ch.snippet?.thumbnails),
          subscribers: subs,
          viewCount: views,
          videoCount: vids,
          encryptedToken: encryptField(tokens.refresh_token ?? ""),
          accessToken: encryptField(tokens.access_token),
          tokenExpiresAt: tokenExpiry,
          uploadsPlaylistId: uploadsPlaylist,
          scopes: "youtube.readonly youtube.upload youtubepartner",
          mode: "oauth",
          status: "CONNECTED",
          channelCreatedAt: ch.snippet?.publishedAt ? new Date(ch.snippet.publishedAt) : null,
          settings: { create: {} },
        },
      });
    }

    // 4) first sync: channel stats + recent uploads + growth datapoint
    try {
      const fresh = await db.youTubeChannel.findUnique({ where: { id: row.id } });
      if (fresh) await syncChannel(fresh);
    } catch (e) {
      console.error("[yt-callback] initial sync failed:", e instanceof Error ? e.message : e);
    }

    await audit(user, "channel.connect.oauth", "youtubeChannel", row.id, { channelId });
    await notify(user.id, "info", `Channel connected: ${row.channelTitle}`,
      "Connected via Google OAuth 2.0. Real-time channel dashboard is now live.",
      undefined,
      `channels:${row.id}`);

    const res = NextResponse.redirect(`${base}/?yt=connected`);
    res.cookies.delete("sp_oauth_state");
    return res;
  } catch (e) {
    console.error("[yt-callback]", e instanceof Error ? e.message : e);
    return fail(e instanceof Error ? e.message : "OAuth callback failed");
  }
}

function getBase(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
