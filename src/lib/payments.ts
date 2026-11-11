import { db } from "@/lib/db";
import { encryptField, decryptField } from "@/lib/password";
import { grantCredits } from "@/lib/usage";
import { audit, notify } from "@/lib/notify";
import { HttpError } from "@/lib/auth";
import type { AuthUser } from "@/lib/auth";
import type { Plan } from "@prisma/client";

// ============================================================
// Gateway settings — ADMIN PANEL ONLY.
// Razorpay / PayPal credentials are configured by an Admin in
// /admin -> Payments and stored as AppSettings (AES-256-GCM
// encrypted at rest). No .env fallback.
// ============================================================

export type RazorpayConfig = { keyId: string; keySecret: string; source: "db" };
export type PaypalConfig = { clientId: string; clientSecret: string; mode: "test" | "live"; source: "db" };

async function setting(key: string): Promise<string | null> {
  try {
    const row = await db.appSetting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function settingDecrypted(key: string): Promise<string | null> {
  const v = await setting(key);
  if (!v) return null;
  try {
    return decryptField(v);
  } catch {
    return null;
  }
}

export async function setSettingValue(key: string, value: string, encrypt = false): Promise<void> {
  const stored = encrypt ? encryptField(value) : value;
  await db.appSetting.upsert({ where: { key }, create: { key, value: stored }, update: { value: stored } });
}

export async function deleteSettingValue(key: string): Promise<void> {
  await db.appSetting.deleteMany({ where: { key } });
}

export async function getRazorpayConfig(): Promise<RazorpayConfig | null> {
  const keyId = await setting("razorpay_key_id");
  const keySecret = await settingDecrypted("razorpay_key_secret");
  if (keyId && keySecret) return { keyId, keySecret, source: "db" };
  return null;
}

export async function getPaypalConfig(): Promise<PaypalConfig | null> {
  const clientId = await setting("paypal_client_id");
  const clientSecret = await settingDecrypted("paypal_client_secret");
  const mode = ((await setting("paypal_mode")) as "test" | "live" | null) ?? "test";
  if (clientId && clientSecret) return { clientId, clientSecret, mode: mode === "live" ? "live" : "test", source: "db" };
  return null;
}

/** Which gateways are ready (used by the UI to show/hide payment options). */
export async function getGatewaysStatus(): Promise<{
  razorpay: { configured: boolean; mode: "test" | "live"; source: string | null };
  paypal: { configured: boolean; mode: "test" | "live"; source: string | null };
}> {
  const [rz, pp] = await Promise.all([getRazorpayConfig(), getPaypalConfig()]);
  return {
    razorpay: { configured: Boolean(rz), mode: rz ? "live" : "test", source: rz?.source ?? null },
    paypal: { configured: Boolean(pp), mode: pp?.mode ?? "test", source: pp?.source ?? null },
  };
}

// ============================================================
// Subscription activation (shared by sandbox checkout / Razorpay / PayPal)
// ============================================================

export const PLAN_CREDITS: Record<string, number> = {
  free_trial: 25,
  starter: 120,
  pro: 400,
  agency: 1200,
};

/**
 * Activate (or upgrade) a user's subscription after a successful payment.
 * Creates a PAID invoice, grants the plan's monthly credits and notifies the user.
 */
export async function activatePaidSubscription(
  userId: string,
  plan: Plan,
  meta: { provider: string; providerRef?: string | null; amountUsd?: number; note?: string }
): Promise<{ subscriptionId: string }> {
  const periodEnd = new Date(Date.now() + 30 * 86400000);
  const sub = await db.subscription.upsert({
    where: { userId },
    update: { planId: plan.id, status: "ACTIVE", periodStart: new Date(), periodEnd, cancelAtPeriodEnd: false },
    create: { userId, planId: plan.id, status: "ACTIVE", periodEnd },
  });

  await db.invoice.create({
    data: {
      subscriptionId: sub.id,
      amount: meta.amountUsd ?? plan.price,
      status: "PAID",
      description: `${plan.name} — monthly (${meta.provider}${meta.note ? `, ${meta.note}` : ""})`,
      providerRef: meta.providerRef ?? null,
    },
  });

  const creditGrant = PLAN_CREDITS[plan.id] ?? 100;
  await grantCredits(userId, creditGrant, `${plan.name} monthly credits`);

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true } });
  await audit(user as AuthUser, `billing.paid.${meta.provider}`, "subscription", sub.id, { planId: plan.id, ref: meta.providerRef });
  await notify(
    userId,
    "success",
    `Subscription active: ${plan.name}`,
    `Paid via ${meta.provider}. ${plan.shortsLimit} Shorts/month, ${plan.channelsLimit} channel(s). ${creditGrant} credits added.`,
    undefined,
    "billing"
  );
  return { subscriptionId: sub.id };
}

/** Record a pending invoice while the gateway payment is in flight. */
export async function createPendingInvoice(
  subscriptionId: string,
  amountUsd: number,
  description: string,
  providerRef: string
): Promise<void> {
  await db.invoice.create({
    data: { subscriptionId, amount: amountUsd, status: "PENDING", description, providerRef },
  });
}

// ============================================================
// Razorpay (INR) — Orders API + HMAC signature verification
// ============================================================

export type RazorpayOrder = { orderId: string; amountInr: number; keyId: string };

export async function razorpayCreateOrder(plan: Plan, receipt: string): Promise<RazorpayOrder> {
  const cfg = await getRazorpayConfig();
  if (!cfg) throw new HttpError(400, "Razorpay is not configured. Add keys in Admin → API & Integrations (free test keys: dashboard.razorpay.com).");
  if (!plan.priceInr || plan.priceInr <= 0) throw Object.assign(new Error(`Plan "${plan.name}" does not support INR billing.`), { status: 400 });

  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: plan.priceInr * 100, // paise
      currency: "INR",
      receipt,
      notes: { planId: plan.id, planName: plan.name },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Razorpay order failed (${res.status}): ${text.slice(0, 300)}`), { status: 502 });
  }
  const data = (await res.json()) as { id: string; amount: number };
  return { orderId: data.id, amountInr: data.amount / 100, keyId: cfg.keyId };
}

/** Verify Razorpay checkout signature: HMAC-SHA256(order_id|payment_id, key_secret). */
export async function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): Promise<boolean> {
  const cfg = await getRazorpayConfig();
  if (!cfg) return false;
  const { createHmac, timingSafeEqual } = await import("crypto");
  const expected = createHmac("sha256", cfg.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ============================================================
// PayPal (international) — Orders API v2 with approve-redirect flow
// ============================================================

function paypalBase(mode: "test" | "live"): string {
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function paypalToken(cfg: PaypalConfig): Promise<string> {
  const auth = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const res = await fetch(`${paypalBase(cfg.mode)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`PayPal auth failed (${res.status}): ${text.slice(0, 300)}`), { status: 502 });
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export type PaypalOrder = { orderId: string; approveUrl: string; mode: "test" | "live" };

export async function paypalCreateOrder(
  plan: Plan,
  opts: { returnUrl: string; cancelUrl: string; reference: string }
): Promise<PaypalOrder> {
  const cfg = await getPaypalConfig();
  if (!cfg) throw new HttpError(400, "PayPal is not configured. Add credentials in Admin → API & Integrations (free sandbox keys: developer.paypal.com).");

  const token = await paypalToken(cfg);
  const res = await fetch(`${paypalBase(cfg.mode)}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.reference.slice(0, 50),
          description: `${plan.name} plan — ShortsPilot AI (monthly)`.slice(0, 127),
          custom_id: plan.id,
          amount: { currency_code: "USD", value: plan.price.toFixed(2) },
        },
      ],
      application_context: {
        brand_name: "ShortsPilot AI",
        user_action: "PAY_NOW",
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`PayPal order failed (${res.status}): ${text.slice(0, 300)}`), { status: 502 });
  }
  const data = (await res.json()) as {
    id: string;
    links: { rel: string; href: string }[];
  };
  const approve = data.links?.find((l) => l.rel === "approve")?.href;
  if (!approve) throw new HttpError(502, "PayPal did not return an approval URL");
  return { orderId: data.id, approveUrl: approve, mode: cfg.mode };
}

export async function paypalCaptureOrder(orderId: string): Promise<{ status: string; captureId?: string; planId?: string; amountUsd?: number }> {
  const cfg = await getPaypalConfig();
  if (!cfg) throw new HttpError(400, "PayPal is not configured.");
  const token = await paypalToken(cfg);
  const res = await fetch(`${paypalBase(cfg.mode)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    status?: string;
    purchase_units?: {
      payments?: { captures?: { id: string; amount?: { value?: string } }[] };
      custom_id?: string;
    }[];
    details?: { issue?: string; description?: string }[];
  };
  if (!res.ok) {
    const issue = data.details?.[0]?.description ?? data.details?.[0]?.issue ?? `HTTP ${res.status}`;
    throw Object.assign(new Error(`PayPal capture failed: ${issue}`), { status: 502 });
  }
  const unit = data.purchase_units?.[0];
  return {
    status: data.status ?? "UNKNOWN",
    captureId: unit?.payments?.captures?.[0]?.id,
    planId: unit?.custom_id,
    amountUsd: unit?.payments?.captures?.[0]?.amount?.value ? Number(unit.payments.captures[0].amount.value) : undefined,
  };
}
