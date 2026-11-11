import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, HttpError } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import { z } from "zod";

const planBody = z.object({
  id: z.string().min(2).max(40).regex(/^[a-z0-9_]+$/, "id must be lowercase slug").optional(),
  name: z.string().min(2).max(60),
  price: z.number().min(0).max(100000),
  shortsLimit: z.number().int().min(1).max(100000),
  channelsLimit: z.number().int().min(1).max(100),
  watermark: z.boolean().optional(),
  features: z.array(z.string().max(120)).max(12).optional(),
  order: z.number().int().min(0).max(100).optional(),
});

/** GET /api/v1/admin/plans — all plans + live subscriber counts (pricing editor). */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const [plans, counts] = await Promise.all([
    db.plan.findMany({ orderBy: { order: "asc" } }),
    db.subscription.groupBy({ by: ["planId"], _count: { _all: true } }),
  ]);
  return ok({
    plans: plans.map((p) => ({
      ...p,
      features: JSON.parse(p.features || "[]") as string[],
      subscribers: counts.find((c) => c.planId === p.id)?._count._all ?? 0,
    })),
  });
});

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

/** POST /api/v1/admin/plans — create a new pricing plan. */
export const POST = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, planBody);
  const id = body.id ?? slugify(body.name);
  const exists = await db.plan.findUnique({ where: { id } });
  if (exists) throw new HttpError(409, `Plan id "${id}" already exists`);
  const plan = await db.plan.create({
    data: {
      id,
      name: body.name,
      price: body.price,
      shortsLimit: body.shortsLimit,
      channelsLimit: body.channelsLimit,
      watermark: body.watermark ?? false,
      features: JSON.stringify(body.features ?? []),
      order: body.order ?? 99,
    },
  });
  await audit(admin, "admin.plan.create", "plan", plan.id, { name: plan.name, price: plan.price });
  return ok({ plan: { ...plan, features: JSON.parse(plan.features || "[]") } }, 201);
});

const patchSchema = planBody.partial().extend({ id: z.string().min(2) });

/** PATCH /api/v1/admin/plans — update pricing / limits / features. */
export const PATCH = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const { id, ...rest } = await parseBody(req, patchSchema);
  const existing = await db.plan.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Plan not found");
  const plan = await db.plan.update({
    where: { id },
    data: {
      ...(rest.name ? { name: rest.name } : {}),
      ...(typeof rest.price === "number" ? { price: rest.price } : {}),
      ...(typeof rest.shortsLimit === "number" ? { shortsLimit: rest.shortsLimit } : {}),
      ...(typeof rest.channelsLimit === "number" ? { channelsLimit: rest.channelsLimit } : {}),
      ...(typeof rest.watermark === "boolean" ? { watermark: rest.watermark } : {}),
      ...(rest.features ? { features: JSON.stringify(rest.features) } : {}),
      ...(typeof rest.order === "number" ? { order: rest.order } : {}),
    },
  });
  await audit(admin, "admin.plan.update", "plan", id, rest as Record<string, unknown>);
  return ok({ plan: { ...plan, features: JSON.parse(plan.features || "[]") } });
});

/** DELETE /api/v1/admin/plans?id= — delete a plan (blocked while subscriptions use it). */
export const DELETE = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "id query parameter is required");
  const inUse = await db.subscription.count({ where: { planId: id } });
  if (inUse > 0) throw new HttpError(409, `Plan is used by ${inUse} subscription(s) — reassign them first`);
  await db.plan.delete({ where: { id } });
  await audit(admin, "admin.plan.delete", "plan", id);
  return ok({ success: true });
});
