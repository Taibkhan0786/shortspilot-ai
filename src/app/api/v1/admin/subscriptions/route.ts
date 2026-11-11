import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, HttpError } from "@/lib/auth";
import { handler, ok, getPagination, parseBody } from "@/lib/api";
import { audit, notify } from "@/lib/notify";
import { z } from "zod";

/** GET /api/v1/admin/subscriptions — every subscription with user + plan + billing info. */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const { skip, take, page } = getPagination(req.url, 30);
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q") || undefined;
  const status = sp.get("status") || undefined;
  const planId = sp.get("planId") || undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(planId ? { planId } : {}),
    ...(q ? { user: { OR: [{ email: { contains: q } }, { name: { contains: q } }] } } : {}),
  };

  const [subs, total, plans] = await Promise.all([
    db.subscription.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true, status: true } },
        plan: true,
        _count: { select: { invoices: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.subscription.count({ where }),
    db.plan.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true, price: true } }),
  ]);
  return ok({ subscriptions: subs, total, page, plans });
});

const patchSchema = z.object({
  subscriptionId: z.string().min(5),
  planId: z.string().min(2).optional(),
  status: z.enum(["TRIAL", "ACTIVE", "CANCELLED", "PAST_DUE"]).optional(),
  extendDays: z.number().int().min(1).max(3650).optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
});

/** PATCH /api/v1/admin/subscriptions — admin override: plan, status, extension, cancellation. */
export const PATCH = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, patchSchema);

  const existing = await db.subscription.findUnique({
    where: { id: body.subscriptionId },
    include: { plan: true, user: { select: { email: true } } },
  });
  if (!existing) throw new HttpError(404, "Subscription not found");

  let periodEnd = existing.periodEnd;
  if (body.extendDays) periodEnd = new Date(periodEnd.getTime() + body.extendDays * 86400000);
  if (body.planId) {
    const plan = await db.plan.findUnique({ where: { id: body.planId } });
    if (!plan) throw new HttpError(404, "Plan not found");
  }

  const sub = await db.subscription.update({
    where: { id: body.subscriptionId },
    data: {
      ...(body.planId ? { planId: body.planId } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.extendDays ? { periodEnd, cancelAtPeriodEnd: false } : {}),
      ...(typeof body.cancelAtPeriodEnd === "boolean" ? { cancelAtPeriodEnd: body.cancelAtPeriodEnd } : {}),
    },
    include: { plan: true, user: { select: { email: true } } },
  });

  await audit(admin, "admin.subscription.update", "subscription", sub.id, body as Record<string, unknown>);
  const changes = [
    body.planId ? `plan → ${sub.plan.name}` : null,
    body.status ? `status → ${body.status}` : null,
    body.extendDays ? `extended +${body.extendDays} days (till ${periodEnd.toISOString().slice(0, 10)})` : null,
    typeof body.cancelAtPeriodEnd === "boolean"
      ? `cancel at period end ${body.cancelAtPeriodEnd ? "ON" : "OFF"}`
      : null,
  ].filter(Boolean) as string[];
  await notify(
    sub.userId,
    "info",
    "Subscription updated by admin",
    changes.length ? `Your subscription was changed: ${changes.join(", ")}.` : "Your subscription was reviewed by an administrator.",
    undefined,
    "billing"
  );
  return ok({ subscription: sub });
});
