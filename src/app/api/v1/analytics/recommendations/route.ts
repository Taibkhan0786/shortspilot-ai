import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { performanceRecommendations } from "@/lib/engine/content";

/** GET /api/v1/analytics/recommendations — AI performance optimizer (PRD §6.16). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const videos = await db.video.findMany({
    where: { userId: user.id, status: "PUBLISHED" },
    include: { analytics: { orderBy: { date: "desc" }, take: 1 } },
    take: 30,
  });
  const stats = videos.map((v) => ({
    title: v.title,
    views: v.analytics[0]?.views ?? 0,
    likes: v.analytics[0]?.likes ?? 0,
    duration: Math.round(v.duration),
  }));
  const result = await performanceRecommendations({ videos: stats });
  return ok({
    ...result,
    evidence: {
      videosAnalyzed: stats.length,
      disclaimer: "Suggestions are based on your channel data only. No performance is guaranteed.",
    },
  });
});
