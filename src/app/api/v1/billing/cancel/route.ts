import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { audit, notify } from "@/lib/notify";

/** POST /api/v1/billing/cancel — cancel at period end (PRD §6.18). */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const sub = await db.subscription.findUnique({ where: { userId: user.id }, include: { plan: true } });
  if (!sub) throw new HttpError(404, "No subscription found");
  if (sub.status !== "ACTIVE") throw new HttpError(409, "Subscription is not active");

  const updated = await db.subscription.update({
    where: { userId: user.id },
    data: { cancelAtPeriodEnd: true },
    include: { plan: true },
  });
  await audit(user, "billing.cancel", "subscription", sub.id);
  await notify(user.id, "info", "Subscription cancelled", `Your ${sub.plan.name} plan stays active until ${sub.periodEnd.toISOString().slice(0, 10)}.`, undefined, "billing");
  return ok({ subscription: updated });
});
