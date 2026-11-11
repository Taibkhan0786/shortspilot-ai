import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import { CREDIT_COSTS, getCreditCosts, setCreditCostOverrides, type UsageOperation } from "@/lib/usage";

/** GET /api/v1/admin/settings — effective AI credit pricing (defaults + overrides). */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const costs = await getCreditCosts();
  const setting = await db.appSetting.findUnique({ where: { key: "credit_costs" } }).catch(() => null);
  let overrides: Partial<Record<UsageOperation, number>> = {};
  try {
    overrides = setting ? (JSON.parse(setting.value) as Partial<Record<UsageOperation, number>>) : {};
  } catch {
    overrides = {};
  }
  return ok({
    defaults: CREDIT_COSTS,
    costs,
    overrides,
    operations: Object.keys(CREDIT_COSTS) as UsageOperation[],
  });
});

const schema = z.object({
  costs: z.record(z.string(), z.number().min(0).max(1000)),
  reset: z.boolean().optional(),
});

/** PUT /api/v1/admin/settings — save AI credit-pricing overrides (or reset). */
export const PUT = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, schema);

  if (body.reset) {
    await setCreditCostOverrides({});
  } else {
    // validate keys against known operations
    const valid = Object.keys(CREDIT_COSTS) as UsageOperation[];
    const overrides: Partial<Record<UsageOperation, number>> = {};
    for (const [key, value] of Object.entries(body.costs)) {
      if (!valid.includes(key as UsageOperation)) {
        throw Object.assign(new Error(`Unknown operation "${key}"`), { status: 400 });
      }
      overrides[key as UsageOperation] = value;
    }
    await setCreditCostOverrides(overrides);
  }

  await audit(admin, body.reset ? "admin.settings.pricing.reset" : "admin.settings.pricing.update", "appSetting", "credit_costs", body.reset ? undefined : body.costs);
  const costs = await getCreditCosts();
  return ok({ costs });
});
