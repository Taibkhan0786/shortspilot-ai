import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { paypalCaptureOrder, activatePaidSubscription } from "@/lib/payments";

/**
 * GET /api/v1/billing/paypal/return — PayPal redirects the payer back here after
 * approval. We capture the money server-side and only then activate the plan,
 * then redirect the user to the app with a result flag.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token"); // PayPal sends the order id as ?token=
  const origin = `${url.protocol}//${url.host}`;

  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.redirect(`${origin}/?pay=error&reason=auth`);
  }
  if (!token) {
    return NextResponse.redirect(`${origin}/?pay=error&reason=missing_order`);
  }

  try {
    const invoice = await db.invoice.findFirst({
      where: { providerRef: token, status: "PENDING" },
      include: { subscription: true },
    });
    if (!invoice || invoice.subscription.userId !== user.id) {
      return NextResponse.redirect(`${origin}/?pay=error&reason=unknown_order`);
    }

    const capture = await paypalCaptureOrder(token);
    if (capture.status !== "COMPLETED") {
      await db.invoice.update({ where: { id: invoice.id }, data: { status: "PENDING" } }).catch(() => {});
      return NextResponse.redirect(`${origin}/?pay=error&reason=not_captured`);
    }

    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        description: `${invoice.description.replace(" (PayPal order pending)", "")} — capture ${capture.captureId ?? ""}`.trim(),
      },
    });

    const planId = capture.planId ?? invoice.subscription.planId;
    const plan = await db.plan.findUnique({ where: { id: planId } });
    if (!plan) return NextResponse.redirect(`${origin}/?pay=error&reason=plan_missing`);

    await activatePaidSubscription(user.id, plan, {
      provider: "paypal",
      providerRef: capture.captureId ?? token,
      amountUsd: capture.amountUsd ?? plan.price,
      note: `PayPal ${capture.status.toLowerCase()}`,
    });

    return NextResponse.redirect(`${origin}/?pay=success`);
  } catch (e) {
    console.error("[paypal-return]", e instanceof Error ? e.message : e);
    const reason = encodeURIComponent(e instanceof Error ? e.message.slice(0, 120) : "capture_failed");
    return NextResponse.redirect(`${origin}/?pay=error&reason=${reason}`);
  }
}
