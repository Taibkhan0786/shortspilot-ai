import { db } from "@/lib/db";

/** Default estimated internal credit costs per operation (PRD §6.19). */
export const CREDIT_COSTS = {
  idea: 1,
  research: 1,
  script: 2,
  script_regenerate: 2,
  metadata: 0.5,
  voiceover: 4,
  visual_per_scene: 1.5,
  render: 3,
  publish: 1,
} as const;

export type UsageOperation = keyof typeof CREDIT_COSTS;
export type CreditCosts = Record<UsageOperation, number>;

const COSTS_SETTING_KEY = "credit_costs";

/**
 * Effective credit costs = admin overrides (AppSetting "credit_costs") merged
 * over the defaults. Admin can re-price AI operations from the /admin console.
 */
export async function getCreditCosts(): Promise<CreditCosts> {
  const setting = await db.appSetting.findUnique({ where: { key: COSTS_SETTING_KEY } });
  let overrides: Partial<CreditCosts> = {};
  if (setting) {
    try {
      overrides = JSON.parse(setting.value) as Partial<CreditCosts>;
    } catch {
      overrides = {};
    }
  }
  const merged = { ...CREDIT_COSTS } as CreditCosts;
  for (const key of Object.keys(CREDIT_COSTS) as UsageOperation[]) {
    const v = overrides[key];
    if (typeof v === "number" && isFinite(v) && v >= 0) merged[key] = v;
  }
  return merged;
}

/** Persist admin credit-cost overrides (null object resets to defaults). */
export async function setCreditCostOverrides(overrides: Partial<CreditCosts>) {
  await db.appSetting.upsert({
    where: { key: COSTS_SETTING_KEY },
    update: { value: JSON.stringify(overrides) },
    create: { key: COSTS_SETTING_KEY, value: JSON.stringify(overrides) },
  });
}

export async function getBalance(userId: string): Promise<number> {
  const last = await db.creditLedger.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return last?.balance ?? 0;
}

/** ADMINS are never charged and never capped — unlimited platform usage. */
export async function isAdminUser(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === "ADMIN";
}

export async function grantCredits(userId: string, amount: number, description: string, referenceId?: string) {
  const balance = await getBalance(userId);
  await db.creditLedger.create({
    data: {
      userId,
      type: "GRANT",
      amount,
      balance: balance + amount,
      description,
      referenceId,
    },
  });
  return balance + amount;
}

/** Charge credits; throws when balance or user monthly cap would be exceeded.
 * ADMIN accounts bypass ALL credit limits (unlimited usage, balance untouched). */
export async function chargeCredits(
  userId: string,
  operation: UsageOperation,
  description: string,
  referenceId?: string,
  units = 1
) {
  const costs = await getCreditCosts();
  const amount = costs[operation] * units;

  // Admins: unlimited — no ledger charge, no balance check, no monthly cap.
  if (await isAdminUser(userId)) {
    return getBalance(userId);
  }

  const profile = await db.userProfile.findUnique({ where: { userId } });
  const monthlyCap = profile?.monthlyLimit ?? 50;
  const balance = await getBalance(userId);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthSpend = await db.creditLedger.aggregate({
    where: { userId, type: "CHARGE", createdAt: { gte: monthStart } },
    _sum: { amount: true },
  });
  const spentThisMonth = monthSpend._sum.amount ?? 0;

  if (balance < amount) {
    throw Object.assign(new Error("Insufficient credits. Please upgrade your plan or top up."), {
      status: 402,
    });
  }
  if (spentThisMonth + amount > monthlyCap) {
    throw Object.assign(
      new Error(`Monthly spending cap reached (${monthlyCap} credits). Increase it in Settings to continue.`),
      { status: 402 }
    );
  }

  await db.creditLedger.create({
    data: {
      userId,
      type: "CHARGE",
      amount,
      balance: balance - amount,
      referenceId,
      description,
    },
  });
  return balance - amount;
}

/** Refund/release credits for a failed job (PRD §6.19).
 * Admins are never charged, so they never receive refunds either. */
export async function releaseCredits(userId: string, amount: number, description: string, referenceId?: string) {
  if (await isAdminUser(userId)) return;
  const balance = await getBalance(userId);
  await db.creditLedger.create({
    data: {
      userId,
      type: "RELEASE",
      amount,
      balance: balance + amount,
      referenceId,
      description,
    },
  });
}

export async function logUsage(
  userId: string,
  provider: string,
  operation: string,
  opts: { units?: number; estimatedCost?: number; actualCost?: number; referenceId?: string } = {}
) {
  await db.usageLog.create({
    data: {
      userId,
      provider,
      operation,
      units: opts.units ?? 1,
      estimatedCost: opts.estimatedCost ?? 0,
      actualCost: opts.actualCost ?? 0,
      referenceId: opts.referenceId,
    },
  });
}

/** Plan entitlements check (PRD §6.18). */
export async function getEntitlements(userId: string) {
  const sub = await db.subscription.findUnique({
    where: { userId },
    include: { plan: true },
  });
  const plan = sub?.plan ?? (await db.plan.findUnique({ where: { id: "free_trial" } }));
  return { subscription: sub, plan };
}

export async function assertCanCreateVideo(userId: string) {
  const { plan } = await getEntitlements(userId);
  if (!plan) throw Object.assign(new Error("No plan found"), { status: 402 });
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const used = await db.video.count({
    where: { userId, createdAt: { gte: monthStart } },
  });
  // Admins are unlimited — the plan's Shorts/month cap never applies.
  if (await isAdminUser(userId)) {
    return { used, limit: Number.MAX_SAFE_INTEGER, plan, unlimited: true };
  }
  if (used >= plan.shortsLimit) {
    throw Object.assign(
      new Error(`Plan limit reached: ${plan.shortsLimit} Shorts/month on ${plan.name}. Upgrade to continue.`),
      { status: 402 }
    );
  }
  return { used, limit: plan.shortsLimit, plan, unlimited: false };
}
