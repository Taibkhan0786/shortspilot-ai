import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

/** GET /api/v1/admin/overview — full platform KPIs for the /admin console. */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalUsers,
    activeUsers,
    newUsersThisMonth,
    subsByStatus,
    planCounts,
    totalVideos,
    publishedVideos,
    videosThisMonth,
    failedRenders,
    failedPublishes,
    pendingApprovals,
    scheduledVideos,
    monthCosts,
    revenueAll,
    revenueMonth,
    activeSubsWithPlan,
    channelModes,
    creditStats,
    balances,
    recentAudit,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { sessions: { some: { expiresAt: { gte: now } } } } }),
    db.user.count({ where: { createdAt: { gte: monthStart } } }),
    db.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    db.subscription.groupBy({ by: ["planId"], _count: { _all: true } }),
    db.video.count(),
    db.video.count({ where: { status: "PUBLISHED" } }),
    db.video.count({ where: { createdAt: { gte: monthStart } } }),
    db.renderJob.count({ where: { status: "FAILED" } }),
    db.publishingJob.count({ where: { uploadStatus: "FAILED" } }),
    db.video.count({ where: { status: "PENDING_APPROVAL" } }),
    db.video.count({ where: { status: "SCHEDULED" } }),
    db.usageLog.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { estimatedCost: true, actualCost: true },
      _count: { _all: true },
    }),
    db.invoice.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    db.invoice.aggregate({ where: { status: "PAID", createdAt: { gte: monthStart } }, _sum: { amount: true } }),
    db.subscription.findMany({ where: { status: "ACTIVE" }, select: { plan: { select: { price: true } } } }),
    db.youTubeChannel.groupBy({ by: ["mode"], _count: { _all: true }, where: { status: "CONNECTED" } }),
    db.creditLedger.groupBy({ by: ["type"], _sum: { amount: true } }),
    db.$queryRaw<{ balance: number }[]>`
      SELECT SUM(balance) as balance FROM CreditLedger
      WHERE rowid IN (SELECT MAX(rowid) FROM CreditLedger GROUP BY userId)
    `,
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 14,
      include: { user: { select: { email: true } } },
    }),
  ]);

  const mrr = activeSubsWithPlan.reduce((sum, s) => sum + s.plan.price, 0);

  return ok({
    users: { total: totalUsers, active: activeUsers, newThisMonth: newUsersThisMonth },
    subscriptions: {
      byStatus: subsByStatus.map((s) => ({ status: s.status, count: s._count._all })),
      byPlan: planCounts.map((p) => ({ planId: p.planId, count: p._count._all })),
    },
    videos: { total: totalVideos, published: publishedVideos, thisMonth: videosThisMonth, pendingApproval: pendingApprovals, scheduled: scheduledVideos },
    jobs: { failedRenders, failedPublishes },
    channels: channelModes.map((c) => ({ mode: c.mode, count: c._count._all })),
    costs: {
      monthEstimated: monthCosts._sum.estimatedCost ?? 0,
      monthActual: monthCosts._sum.actualCost ?? 0,
      monthCalls: monthCosts._count._all,
    },
    credits: {
      outstanding: balances[0]?.balance ?? 0,
      granted: creditStats.find((c) => c.type === "GRANT")?._sum.amount ?? 0,
      spent: creditStats.find((c) => c.type === "CHARGE")?._sum.amount ?? 0,
      released: creditStats.find((c) => c.type === "RELEASE")?._sum.amount ?? 0,
    },
    revenue: { total: revenueAll._sum.amount ?? 0, month: revenueMonth._sum.amount ?? 0, mrr },
    recentAudit: recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      email: a.user?.email,
      resourceType: a.resourceType,
      resourceId: a.resourceId,
      createdAt: a.createdAt,
    })),
  });
});
