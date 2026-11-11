import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

/**
 * GET /api/v1/analytics/overview — channel overview + per-video performance (PRD §6.15).
 * Metrics come from the analytics sync worker. Unavailable metrics are clearly
 * identified; no fabricated data outside the sandbox adapter.
 */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const days = Math.min(90, Math.max(7, parseInt(new URL(req.url).searchParams.get("days") || "30", 10)));
  const since = new Date(Date.now() - days * 86400000);

  const videos = await db.video.findMany({
    where: { userId: user.id },
    include: {
      analytics: { where: { date: { gte: since } }, orderBy: { date: "asc" } },
      channel: { select: { channelTitle: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const published = videos.filter((v) => v.status === "PUBLISHED");
  const totals = published.reduce(
    (acc, v) => {
      const last = v.analytics[v.analytics.length - 1];
      acc.views += last?.views ?? 0;
      acc.likes += last?.likes ?? 0;
      acc.comments += last?.comments ?? 0;
      acc.subs += last?.subscribersGained ?? 0;
      acc.watchTime += last?.watchTime ?? 0;
      return acc;
    },
    { views: 0, likes: 0, comments: 0, subs: 0, watchTime: 0 }
  );

  // daily series for charts
  const byDate = new Map<string, { date: string; views: number; likes: number }>();
  for (const v of published) {
    for (const a of v.analytics) {
      const key = a.date.toISOString().slice(0, 10);
      const cur = byDate.get(key) ?? { date: key, views: 0, likes: 0 };
      cur.views += a.views;
      cur.likes += a.likes;
      byDate.set(key, cur);
    }
  }
  const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const topVideos = published
    .map((v) => {
      const last = v.analytics[v.analytics.length - 1];
      return {
        id: v.id,
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        channel: v.channel?.channelTitle,
        duration: Math.round(v.duration),
        publishedAt: v.publishedAt,
        youtubeUrl: v.youtubeUrl,
        views: last?.views ?? 0,
        likes: last?.likes ?? 0,
        comments: last?.comments ?? 0,
      };
    })
    .sort((a, b) => b.views - a.views);

  return ok({
    totals: {
      ...totals,
      publishedCount: published.length,
      avgViewDuration: published.length
        ? Math.round(totals.watchTime / Math.max(1, totals.views))
        : 0,
    },
    series,
    topVideos,
    dataSource: published.length > 0 ? "sandbox_sync" : "none",
    note:
      published.length > 0
        ? "Sandbox mode: metrics are simulated by the sync worker because no real YouTube OAuth channel is configured."
        : "No published videos yet. Publish a Short to start collecting analytics.",
  });
});
