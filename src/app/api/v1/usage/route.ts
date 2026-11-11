import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { getBalance } from "@/lib/usage";

/** GET /api/v1/usage — usage summary + credit balance (PRD §6.19). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [balance, monthLedger, byProvider, videosThisMonth] = await Promise.all([
    getBalance(user.id),
    db.creditLedger.aggregate({
      where: { userId: user.id, type: "CHARGE", createdAt: { gte: monthStart } },
      _sum: { amount: true },
    }),
    db.usageLog.groupBy({
      by: ["provider", "operation"],
      where: { userId: user.id, createdAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { units: true, estimatedCost: true },
    }),
    db.video.count({ where: { userId: user.id, createdAt: { gte: monthStart } } }),
  ]);

  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });
  const { plan } = (await db.subscription.findUnique({ where: { userId: user.id }, include: { plan: true } })) ?? {};

  return ok({
    credits: {
      balance,
      spentThisMonth: monthLedger._sum.amount ?? 0,
      monthlyCap: profile?.monthlyLimit ?? 50,
    },
    plan: plan ? { name: plan.name, shortsLimit: plan.shortsLimit, shortsUsed: videosThisMonth } : null,
    usageByProvider: byProvider.map((u) => ({
      provider: u.provider,
      operation: u.operation,
      calls: u._count._all,
      units: u._sum.units ?? 0,
      estimatedCost: u._sum.estimatedCost ?? 0,
    })),
  });
});
