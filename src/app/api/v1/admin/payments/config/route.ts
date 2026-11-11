import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import {
  getGatewaysStatus,
  setSettingValue,
  deleteSettingValue,
} from "@/lib/payments";

/**
 * GET /api/v1/admin/payments/config — payment gateway configuration status
 * (Razorpay for INR, PayPal for international). Secrets are never returned.
 */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const gateways = await getGatewaysStatus();
  return ok({ ...gateways, help: { razorpayDashboard: "https://dashboard.razorpay.com/app/keys", paypalDashboard: "https://developer.paypal.com/dashboard/applications" } });
});

const schema = z.object({
  razorpayKeyId: z.string().min(6).max(200).optional(),
  razorpayKeySecret: z.string().min(6).max(300).optional(),
  paypalClientId: z.string().min(6).max(300).optional(),
  paypalClientSecret: z.string().min(6).max(300).optional(),
  paypalMode: z.enum(["test", "live"]).optional(),
});

/**
 * POST /api/v1/admin/payments/config — Admin saves gateway credentials from the
 * /admin panel. Secrets are AES-256-GCM encrypted at rest (AppSetting).
 * The admin panel is the single source of payment credentials — no .env fallback.
 */
export const POST = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, schema);

  if (body.razorpayKeyId) await setSettingValue("razorpay_key_id", body.razorpayKeyId);
  if (body.razorpayKeySecret) await setSettingValue("razorpay_key_secret", body.razorpayKeySecret, true);
  if (body.paypalClientId) await setSettingValue("paypal_client_id", body.paypalClientId);
  if (body.paypalClientSecret) await setSettingValue("paypal_client_secret", body.paypalClientSecret, true);
  if (body.paypalMode) await setSettingValue("paypal_mode", body.paypalMode);

  await audit(admin, "admin.payments.config.update", "appSetting", undefined, {
    razorpayKeyId: Boolean(body.razorpayKeyId),
    razorpayKeySecret: Boolean(body.razorpayKeySecret),
    paypalClientId: Boolean(body.paypalClientId),
    paypalClientSecret: Boolean(body.paypalClientSecret),
    paypalMode: body.paypalMode ?? undefined,
  });

  const gateways = await getGatewaysStatus();
  return ok(gateways);
});

/** DELETE /api/v1/admin/payments/config?key=razorpay|paypal|paypalMode — clear DB-stored credentials. */
export const DELETE = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const key = new URL(req.url).searchParams.get("key");
  if (key === "razorpay") {
    await deleteSettingValue("razorpay_key_id");
    await deleteSettingValue("razorpay_key_secret");
  } else if (key === "paypal") {
    await deleteSettingValue("paypal_client_id");
    await deleteSettingValue("paypal_client_secret");
  } else if (key === "paypalMode") {
    await deleteSettingValue("paypal_mode");
  } else {
    return ok({ error: "Unknown key — use razorpay | paypal | paypalMode" }, 400);
  }
  await audit(admin, "admin.payments.config.clear", "appSetting", key ?? undefined);
  const gateways = await getGatewaysStatus();
  return ok(gateways);
});
