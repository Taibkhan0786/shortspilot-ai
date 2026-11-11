import { handler, ok } from "@/lib/api";
import { db } from "@/lib/db";

/** GET /api/v1/billing/plans — public pricing (PRD §6.18). */
export const GET = handler(async () => {
  const plans = await db.plan.findMany({ orderBy: { order: "asc" } });
  return ok({
    plans: plans.map((p) => ({ ...p, features: JSON.parse(p.features || "[]") })),
  });
});
