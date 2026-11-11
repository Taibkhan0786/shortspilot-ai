import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { getBalance } from "@/lib/usage";

/** GET /api/v1/dashboard — aggregated widgets for the dashboard (PRD §7). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    channels, generated, published, pendingApproval, ideas, failedRenders, failedPublishes,
    upcoming, recentVideos, balance, spent, videosThisMonth, sub,
  ] = await Promise.all([
    db.youTubeChannel.count({ where: { userId: user.id, status: "CONNECTED" } }),
    db.video.count({ where: { userId: user.id } }),
    db.video.count({ where: { userId: user.id, status: "PUBLISHED" } }),
    db.video.count({ where: { userId: user.id, status: "PENDING_APPROVAL" } }),
    db.contentIdea.count({ where: { userId: user.id, status: { in: ["SUGGESTED", "APPROVED"] } } }),
    db.renderJob.count({ where: { status: "FAILED", video: { userId: user.id } } }),
    db.publishingJob.count({ where: { uploadStatus: "FAILED", video: { userId: user.id } } }),
    db.video.findMany({
      where: { userId: user.id, status: "SCHEDULED", scheduledAt: { not: null } },
      select: { id: true, title: true, scheduledAt: true },
      orderBy: { scheduledAt: "asc" },
      take: 6,
    }),
    db.video.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, status: true, thumbnailUrl: true, createdAt: true, duration: true },
    }),
    getBalance(user.id),
    db.creditLedger.aggregate({
      where: { userId: user.id, type: "CHARGE", createdAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    db.video.count({ where: { userId: user.id, createdAt: { gte: monthStart } } }),
    db.subscription.findUnique({ where: { userId: user.id }, include: { plan: true } }),
  ]);

  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });

  return ok({
    channels,
    generated,
    published,
    pendingApproval,
    failedJobs: failedRenders + failedPublishes,
    ideas,
    upcoming,
    recentVideos,
    usage: {
      balance,
      spentThisMonth: spent._sum.amount ?? 0,
      monthlyCap: profile?.monthlyLimit ?? 50,
      plan: sub?.plan ? { name: sub.plan.name, shortsUsed: videosThisMonth, shortsLimit: sub.plan.shortsLimit } : null,
    },
  });
});
