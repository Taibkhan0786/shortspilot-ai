import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { getGatewaysStatus } from "@/lib/payments";

/**
 * GET /api/v1/billing/gateways — which payment gateways are configured on this
 * instance (Razorpay for INR, PayPal for international). The Billing UI uses this
 * to decide which payment buttons to show.
 */
export const GET = handler(async (req: NextRequest) => {
  await requireUser(req);
  const gateways = await getGatewaysStatus();
  return ok(gateways);
});
