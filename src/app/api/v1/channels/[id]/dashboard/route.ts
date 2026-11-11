import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { syncChannel } from "@/lib/youtube";

/**
 * GET /api/v1/channels/[id]/dashboard — real-time channel dashboard payload.
 * Auto-syncs from the live YouTube Data API when data is older than 60s
 * (the client polls this every 60s → real-time). If the live sync fails we
 * still return cached data flagged `stale: true` so the dashboard stays usable.
 */
export const GET = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;

  const channel = await db.youTubeChannel.findUnique({ where: { id } });
  if (!channel || channel.userId !== user.id) throw new HttpError(404, "Channel not found");

  let stale = false;
  let syncNote: string | null = null;

  const isStale = !channel.lastSyncedAt || Date.now() - channel.lastSyncedAt.getTime() > 60_000;
  if (isStale && channel.mode !== "sandbox") {
    try {
      await syncChannel(channel);
      stale = false;
    } catch (e) {
      stale = true;
      syncNote = e instanceof Error ? e.message.slice(0, 200) : "Live sync failed — showing cached stats";
      console.error("[yt-dashboard]", syncNote);
    }
  } else if (channel.mode === "sandbox") {
    // sandbox channel: append a simulated datapoint only once per hour
    const lastStat = await db.channelStat.findFirst({ where: { channelId: channel.id }, orderBy: { capturedAt: "desc" } });
    if (!lastStat || Date.now() - lastStat.capturedAt.getTime() > 3_600_000) {
      await db.channelStat.create({
        data: { channelId: channel.id, subscribers: channel.subscribers, views: channel.viewCount, videoCount: channel.videoCount },
      });
    }
  }

  const fresh = await db.youTubeChannel.findUnique({
    where: { id },
    include: {
      settings: true,
      stats: { orderBy: { capturedAt: "asc" }, take: 60 },
      ytVideos: { orderBy: { publishedAt: "desc" }, take: 25 },
    },
  });
  if (!fresh) throw new HttpError(404, "Channel not found");

  const { encryptedToken: _t, accessToken: _a, ...safe } = fresh;
  const recentViews = fresh.ytVideos.reduce((s, v) => s + v.views, 0);
  const recentLikes = fresh.ytVideos.reduce((s, v) => s + v.likes, 0);
  const recentComments = fresh.ytVideos.reduce((s, v) => s + v.comments, 0);

  return ok({
    channel: safe,
    totals: {
      subscribers: fresh.subscribers,
      views: fresh.viewCount,
      videos: fresh.videoCount,
      avgViewsPerVideo: fresh.videoCount > 0 ? Math.round(fresh.viewCount / fresh.videoCount) : 0,
      recentUploads: fresh.ytVideos.length,
      recentViews,
      recentLikes,
      recentComments,
    },
    growth: fresh.stats.map((s) => ({
      at: s.capturedAt.toISOString(),
      subscribers: s.subscribers,
      views: s.views,
      videoCount: s.videoCount,
    })),
    videos: fresh.ytVideos.map((v) => ({
      videoId: v.videoId,
      title: v.title,
      thumbnail: v.thumbnail,
      publishedAt: v.publishedAt.toISOString(),
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
    })),
    stale,
    syncNote,
    lastSyncedAt: fresh.lastSyncedAt?.toISOString() ?? null,
  });
});
