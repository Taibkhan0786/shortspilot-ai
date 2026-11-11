import { db } from "@/lib/db";
import { encryptField, decryptField } from "@/lib/password";
import type { NextRequest } from "next/server";
import type { YouTubeChannel } from "@prisma/client";

/**
 * Real YouTube integration (PRD §6.3 extended):
 *  - Google OAuth 2.0 (authorization-code, offline access) for owned channels
 *  - YouTube Data API v3 for channel stats + recent uploads (real-time dashboard)
 *  - Optional API-key mode for public stats without OAuth consent
 *
 * OAuth client credentials and the YouTube Data API key are configured by an
 * Admin in the UI (/admin -> API & Integrations) and stored in the instance
 * AppSetting table — ADMIN PANEL ONLY, no .env fallback. Secrets are always
 * AES-256-GCM encrypted at rest.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_API = "https://www.googleapis.com/youtube/v3";

export const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtubepartner",
].join(" ");

export type OAuthConfig = { clientId: string; clientSecret: string; source: "db" };

async function getSetting(key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

/** Resolve Google OAuth client config from Admin-configured AppSettings. */
export async function getOAuthConfig(): Promise<OAuthConfig | null> {
  const [id, secret] = await Promise.all([getSetting("google_client_id"), getSettingEncrypted("google_client_secret")]);
  if (id && secret) return { clientId: id, clientSecret: secret, source: "db" };
  return null;
}

async function getSettingEncrypted(key: string): Promise<string | null> {
  const stored = await getSetting(key);
  return stored ? decryptField(stored) : null;
}

/** Resolve the Admin-configured YouTube Data API key. */
export async function getApiKey(): Promise<string | null> {
  return getSettingEncrypted("youtube_api_key");
}

export async function setSetting(key: string, value: string, encrypt = false): Promise<void> {
  const stored = encrypt ? encryptField(value) : value;
  await db.appSetting.upsert({ where: { key }, create: { key, value: stored }, update: { value: stored } });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.appSetting.deleteMany({ where: { key } });
}

/** The redirect URI that must be registered in Google Cloud Console. */
export function getRedirectUri(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}/api/v1/youtube/callback`;
}

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YT_SCOPES,
    access_type: "offline", // refresh token
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type TokenSet = { access_token: string; refresh_token?: string; expires_in: number };

export async function exchangeCode(code: string, redirectUri: string): Promise<TokenSet> {
  const cfg = await getOAuthConfig();
  if (!cfg) throw new Error("Google OAuth is not configured");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenSet;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const cfg = await getOAuthConfig();
  if (!cfg) throw new Error("Google OAuth is not configured");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenSet;
}

// ---------------- YouTube Data API v3 ----------------

type ChannelResource = {
  id: string;
  snippet?: { title: string; description: string; customUrl?: string; country?: string; publishedAt?: string; thumbnails?: { default?: { url: string }; medium?: { url: string }; high?: { url: string } } };
  statistics?: { viewCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

type VideoResource = {
  id: string;
  snippet?: { title: string; publishedAt: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
};

function pickThumb(t?: { medium?: { url: string }; default?: { url: string } }): string | null {
  return t?.medium?.url ?? t?.default?.url ?? null;
}

/** GET channels?mine=true with an OAuth access token. */
export async function fetchMyChannel(accessToken: string): Promise<ChannelResource> {
  const res = await fetch(`${YT_API}/channels?part=snippet,statistics,contentDetails&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YouTube channels.list failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { items?: ChannelResource[] };
  if (!data.items?.length) throw new Error("No YouTube channel found on this Google account");
  return data.items[0];
}

/** GET channels?forHandle=… with an API key (public stats mode). */
export async function fetchChannelByHandle(handle: string, apiKey: string): Promise<ChannelResource> {
  const clean = handle.trim().replace(/^@/, "");
  const res = await fetch(`${YT_API}/channels?part=snippet,statistics,contentDetails&forHandle=${encodeURIComponent(clean)}&key=${apiKey}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`YouTube channels.list failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { items?: ChannelResource[] };
  if (!data.items?.length) throw new Error(`YouTube channel "${handle}" not found`);
  return data.items[0];
}

/** GET channels?forUsername / by id fallback with an API key. */
export async function fetchChannelById(channelId: string, apiKey: string): Promise<ChannelResource> {
  const res = await fetch(`${YT_API}/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(channelId)}&key=${apiKey}`);
  if (!res.ok) throw new Error(`YouTube channels.list failed (${res.status})`);
  const data = (await res.json()) as { items?: ChannelResource[] };
  if (!data.items?.length) throw new Error(`YouTube channel ${channelId} not found`);
  return data.items[0];
}

/** playlistItems → videos.list for the channel's most recent uploads with full statistics. */
export async function fetchRecentVideos(uploadsPlaylistId: string, auth: { accessToken?: string; apiKey?: string }, max = 25): Promise<VideoResource[]> {
  const plRes = await fetch(`${YT_API}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploadsPlaylistId)}&maxResults=${max}` + (auth.accessToken ? `&access_token=${encodeURIComponent(auth.accessToken)}` : `&key=${auth.apiKey ?? ""}`));
  if (!plRes.ok) {
    const text = await plRes.text().catch(() => "");
    throw new Error(`YouTube playlistItems failed (${plRes.status}): ${text.slice(0, 300)}`);
  }
  const plData = (await plRes.json()) as { items?: { contentDetails?: { videoId?: string } }[] };
  const ids = (plData.items ?? []).map((i) => i.contentDetails?.videoId).filter((v): v is string => Boolean(v));
  if (ids.length === 0) return [];
  const vRes = await fetch(`${YT_API}/videos?part=snippet,statistics&id=${ids.join(",")}` + (auth.accessToken ? `&access_token=${encodeURIComponent(auth.accessToken)}` : `&key=${auth.apiKey ?? ""}`));
  if (!vRes.ok) throw new Error(`YouTube videos.list failed (${vRes.status})`);
  const vData = (await vRes.json()) as { items?: VideoResource[] };
  return vData.items ?? [];
}

export type SyncResult = { subscribers: number; viewCount: number; videoCount: number };

/**
 * Sync one channel row against the live YouTube Data API.
 * - oauth: refreshes the access token when expired
 * - apikey: public stats only
 * Returns the fresh headline numbers.
 */
export async function syncChannel(channel: YouTubeChannel): Promise<SyncResult> {
  let accessToken: string | undefined;
  if (channel.mode === "oauth") {
    if (!channel.encryptedToken) throw new Error("No refresh token stored for this channel");
    const refreshToken = decryptField(channel.encryptedToken);
    if (!refreshToken) throw new Error("Failed to decrypt stored refresh token");
    const expired = !channel.tokenExpiresAt || channel.tokenExpiresAt.getTime() - 60_000 < Date.now();
    if (expired) {
      const tokens = await refreshAccessToken(refreshToken);
      accessToken = tokens.access_token;
      await db.youTubeChannel.update({
        where: { id: channel.id },
        data: {
          accessToken: encryptField(tokens.access_token),
          ...(tokens.refresh_token ? { encryptedToken: encryptField(tokens.refresh_token) } : {}),
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        },
      });
    } else {
      accessToken = channel.accessToken ? decryptField(channel.accessToken) ?? undefined : undefined;
    }
    if (!accessToken) throw new Error("No usable access token");
  }

  const apiKey = channel.mode === "apikey" ? await getApiKey() : undefined;
  if (channel.mode === "apikey" && !apiKey) throw new Error("No YouTube API key configured");

  // 1) headline channel stats
  const chRes = channel.mode === "oauth"
    ? await fetchMyChannel(accessToken!)
    : await fetchChannelById(channel.channelId, apiKey!);

  const subs = parseInt(chRes.statistics?.subscriberCount ?? "0", 10);
  const views = parseInt(chRes.statistics?.viewCount ?? "0", 10);
  const vids = parseInt(chRes.statistics?.videoCount ?? "0", 10);
  const uploadsPlaylist = chRes.contentDetails?.relatedPlaylists?.uploads ?? null;

  // 2) recent uploads with per-video stats
  let ytVideos: VideoResource[] = [];
  if (uploadsPlaylist) {
    try {
      ytVideos = await fetchRecentVideos(uploadsPlaylist, accessToken ? { accessToken } : { apiKey: apiKey ?? undefined });
    } catch (e) {
      console.error("[yt-sync] videos.list failed:", e instanceof Error ? e.message : e);
    }
  }

  // 3) persist everything + append a growth datapoint
  await db.$transaction([
    db.youTubeChannel.update({
      where: { id: channel.id },
      data: {
        channelTitle: chRes.snippet?.title ?? channel.channelTitle,
        handle: chRes.snippet?.customUrl ?? channel.handle,
        description: chRes.snippet?.description?.slice(0, 2000) ?? channel.description,
        country: chRes.snippet?.country ?? channel.country,
        thumbnail: pickThumb(chRes.snippet?.thumbnails) ?? channel.thumbnail,
        subscribers: subs,
        viewCount: views,
        videoCount: vids,
        uploadsPlaylistId: uploadsPlaylist ?? channel.uploadsPlaylistId,
        channelCreatedAt: chRes.snippet?.publishedAt ? new Date(chRes.snippet.publishedAt) : channel.channelCreatedAt,
        lastSyncedAt: new Date(),
        lastSyncError: null,
        status: "CONNECTED",
      },
    }),
    db.channelStat.create({ data: { channelId: channel.id, subscribers: subs, views, videoCount: vids } }),
    ...ytVideos.map((v) =>
      db.youTubeVideo.upsert({
        where: { videoId: v.id },
        create: {
          channelId: channel.id,
          videoId: v.id,
          title: v.snippet?.title ?? "Untitled",
          thumbnail: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url ?? null,
          publishedAt: new Date(v.snippet?.publishedAt ?? Date.now()),
          views: parseInt(v.statistics?.viewCount ?? "0", 10),
          likes: parseInt(v.statistics?.likeCount ?? "0", 10),
          comments: parseInt(v.statistics?.commentCount ?? "0", 10),
        },
        update: {
          title: v.snippet?.title ?? "Untitled",
          views: parseInt(v.statistics?.viewCount ?? "0", 10),
          likes: parseInt(v.statistics?.likeCount ?? "0", 10),
          comments: parseInt(v.statistics?.commentCount ?? "0", 10),
        },
      })
    ),
  ]);

  return { subscribers: subs, viewCount: views, videoCount: vids };
}

/** Number formatting helpers shared by API responses. */
export function parseHandle(input: string): string {
  const trimmed = input.trim();
  // accept full URLs like https://www.youtube.com/@handle or /channel/UC…
  const urlMatch = trimmed.match(/youtube\.com\/(?:@|channel\/|c\/|user\/)([A-Za-z0-9_\-.]+)/);
  return urlMatch ? urlMatch[1] : trimmed.replace(/^@/, "");
}
