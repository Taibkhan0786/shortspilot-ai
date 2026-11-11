import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import { z } from "zod";
import {
  getGatewaysStatus,
  razorpayCreateOrder,
  paypalCreateOrder,
  activatePaidSubscription,
  createPendingInvoice,
} from "@/lib/payments";

const schema = z.object({
  planId: z.string().min(2),
  gateway: z.enum(["razorpay", "paypal"]).optional(),
});

/**
 * POST /api/v1/billing/checkout — start a plan checkout.
 *
 * Free plans (price 0) activate immediately.
 * Paid plans require a real payment gateway:
 *  - gateway=razorpay  -> creates an INR order, returns { keyId, orderId } for Checkout.js
 *  - gateway=paypal    -> creates a PayPal order, returns an approval redirect URL
 * The subscription flips to ACTIVE only after server-side verification/capture
 * (POST /billing/razorpay/verify or GET /billing/paypal/return).
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);

  const plan = await db.plan.findUnique({ where: { id: body.planId } });
  if (!plan) throw new HttpError(404, "Plan not found");

  // ---- Free plan: activate directly, no gateway needed --------------------
  if (plan.price <= 0) {
    const { subscriptionId } = await activatePaidSubscription(user.id, plan, {
      provider: "free",
      amountUsd: 0,
    });
    const sub = await db.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
    return ok({ subscription: sub, free: true }, 201);
  }

  // ---- Paid plan: a gateway is required -----------------------------------
  if (!body.gateway) {
    const gateways = await getGatewaysStatus();
    throw new HttpError(400, 
        `Plan "${plan.name}" requires payment. Available gateways: ${
          [gateways.razorpay.configured ? "razorpay" : null, gateways.paypal.configured ? "paypal" : null]
            .filter(Boolean)
            .join(", ") || "none configured (admin must add gateway keys)"
        }`
      );
  }

  // Ensure a subscription row exists (PENDING) so the invoice can attach to it
  const periodEnd = new Date(Date.now() + 30 * 86400000);
  const sub = await db.subscription.upsert({
    where: { userId: user.id },
    update: { planId: plan.id, status: "PENDING", periodStart: new Date(), periodEnd },
    create: { userId: user.id, planId: plan.id, status: "PENDING", periodEnd },
  });

  if (body.gateway === "razorpay") {
    const order = await razorpayCreateOrder(plan, `sub_${sub.id}`);
    await createPendingInvoice(sub.id, plan.price, `${plan.name} — monthly (Razorpay order pending)`, order.orderId);
    await audit(user, "billing.checkout.razorpay", "subscription", sub.id, { planId: plan.id, orderId: order.orderId });
    return ok(
      {
        gateway: "razorpay",
        orderId: order.orderId,
        keyId: order.keyId,
        amountInr: order.amountInr,
        currency: "INR",
        planName: plan.name,
      },
      201
    );
  }

  // gateway === "paypal"
  const origin = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const base = `${origin}://${host}`;
  const order = await paypalCreateOrder(plan, {
    returnUrl: `${base}/api/v1/billing/paypal/return`,
    cancelUrl: `${base}/?pay=cancelled`,
    reference: sub.id,
  });
  await createPendingInvoice(sub.id, plan.price, `${plan.name} — monthly (PayPal order pending)`, order.orderId);
  await audit(user, "billing.checkout.paypal", "subscription", sub.id, { planId: plan.id, orderId: order.orderId });
  return ok(
    { gateway: "paypal", orderId: order.orderId, approveUrl: order.approveUrl, mode: order.mode, planName: plan.name },
    201
  );
});
