import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { z } from "zod";
import { verifyRazorpaySignature, activatePaidSubscription } from "@/lib/payments";

const schema = z.object({
  razorpayOrderId: z.string().min(4),
  razorpayPaymentId: z.string().min(4),
  razorpaySignature: z.string().min(8),
});

/**
 * POST /api/v1/billing/razorpay/verify — server-side verification of a Razorpay
 * Checkout.js payment. The client handler passes razorpay_order_id,
 * razorpay_payment_id and razorpay_signature; we verify the HMAC-SHA256 signature
 * (order_id|payment_id against the key secret) and only then flip the subscription.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);

  const invoice = await db.invoice.findFirst({
    where: { providerRef: body.razorpayOrderId, status: "PENDING" },
    include: { subscription: { include: { plan: true } } },
  });
  if (!invoice) throw new HttpError(404, "No pending order found for this Razorpay order id");
  if (invoice.subscription.userId !== user.id) throw new HttpError(403, "This order belongs to a different account");

  const valid = await verifyRazorpaySignature(body.razorpayOrderId, body.razorpayPaymentId, body.razorpaySignature);
  if (!valid) throw new HttpError(400, "Payment signature verification failed — possible tampering");

  await db.invoice.update({
    where: { id: invoice.id },
    data: { status: "PAID", description: `${invoice.description.replace(" (Razorpay order pending)", "")} — payment ${body.razorpayPaymentId}` },
  });

  const plan = invoice.subscription.plan;
  const { subscriptionId } = await activatePaidSubscription(user.id, plan, {
    provider: "razorpay",
    providerRef: body.razorpayPaymentId,
    amountUsd: plan.price,
    note: `₹${invoice.amount.toFixed(0)}`,
  });
  const sub = await db.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } });
  return ok({ subscription: sub, verified: true });
});
