import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { syncChannel, getApiKey, fetchChannelByHandle, fetchChannelById, parseHandle } from "@/lib/youtube";
import { encryptField } from "@/lib/password";
import { audit } from "@/lib/notify";
import { z } from "zod";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sync"), channelId: z.string().min(1) }),
  z.object({ action: z.literal("connect-apikey"), handle: z.string().min(2).max(120) }),
]);

/**
 * POST /api/v1/youtube/sync
 *  - action=sync           → force-refresh one channel from the live YouTube API
 *  - action=connect-apikey → connect a public channel by @handle using the API key
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);

  if (body.action === "sync") {
    const channel = await db.youTubeChannel.findUnique({ where: { id: body.channelId } });
    if (!channel || channel.userId !== user.id) throw new HttpError(404, "Channel not found");
    if (channel.mode === "sandbox") {
      throw new HttpError(400, "Sandbox channels have no live YouTube connection — connect via OAuth 2.0 or an API key for real-time stats.");
    }
    try {
      const result = await syncChannel(channel);
      await audit(user, "youtube.sync", "youtubeChannel", channel.id, result);
      return ok({ synced: true, ...result, syncedAt: new Date().toISOString() });
    } catch (e) {
      const message = e instanceof Error ? e.message.slice(0, 300) : "Sync failed";
      await db.youTubeChannel.update({ where: { id: channel.id }, data: { lastSyncError: message } });
      // revoked token → mark channel
      if (message.includes("401") || message.toLowerCase().includes("invalid_grant")) {
        await db.youTubeChannel.update({ where: { id: channel.id }, data: { status: "REVOKED" } });
      }
      throw new HttpError(502, message);
    }
  }

  // ---- connect-apikey ----
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new HttpError(400, "No YouTube API key configured. Ask an Admin to set it in /admin → API & Integrations.");
  }
  const { plan } = (await db.subscription.findUnique({ where: { userId: user.id }, include: { plan: true } })) ?? {};
  const count = await db.youTubeChannel.count({ where: { userId: user.id, status: "CONNECTED" } });
  if (plan && count >= plan.channelsLimit) {
    throw new HttpError(402, `Plan limit reached: ${plan.channelsLimit} channel(s) on ${plan.name}. Upgrade to connect more.`);
  }

  const handle = parseHandle(body.handle);
  let ch;
  try {
    ch = handle.startsWith("UC") && handle.length > 20
      ? await fetchChannelById(handle, apiKey)
      : await fetchChannelByHandle(handle, apiKey);
  } catch (e) {
    throw new HttpError(502, e instanceof Error ? e.message.slice(0, 300) : "YouTube API request failed");
  }

  const duplicate = await db.youTubeChannel.findFirst({ where: { userId: user.id, channelId: ch.id } });
  if (duplicate) throw new HttpError(409, "This channel is already connected");

  const row = await db.youTubeChannel.create({
    data: {
      userId: user.id,
      channelId: ch.id,
      channelTitle: ch.snippet?.title ?? handle,
      handle: ch.snippet?.customUrl ?? `@${handle}`,
      description: ch.snippet?.description?.slice(0, 2000) ?? null,
      country: ch.snippet?.country ?? null,
      thumbnail: ch.snippet?.thumbnails?.medium?.url ?? ch.snippet?.thumbnails?.default?.url ?? null,
      subscribers: parseInt(ch.statistics?.subscriberCount ?? "0", 10),
      viewCount: parseInt(ch.statistics?.viewCount ?? "0", 10),
      videoCount: parseInt(ch.statistics?.videoCount ?? "0", 10),
      uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads ?? null,
      encryptedToken: encryptField(`apikey-${ch.id}`),
      mode: "apikey",
      status: "CONNECTED",
      scopes: "public-stats",
      channelCreatedAt: ch.snippet?.publishedAt ? new Date(ch.snippet.publishedAt) : null,
      settings: { create: {} },
    },
  });

  // seed recent videos + growth datapoint
  try {
    const fresh = await db.youTubeChannel.findUnique({ where: { id: row.id } });
    if (fresh) await syncChannel(fresh);
  } catch (e) {
    console.error("[yt-apikey] initial sync failed:", e instanceof Error ? e.message : e);
  }

  await audit(user, "channel.connect.apikey", "youtubeChannel", row.id, { channelId: ch.id });
  return ok({ channel: row, mode: "apikey" }, 201);
});
