"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { SectionHeader, Spinner } from "./common";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Check, CreditCard, Globe, IndianRupee, Receipt, XCircle } from "lucide-react";

type Plan = { id: string; name: string; price: number; priceInr?: number | null; shortsLimit: number; channelsLimit: number; watermark: boolean; features: string[] };
type Sub = { plan: Plan; status: string; periodEnd: string; cancelAtPeriodEnd: boolean } | null;
type Invoice = { id: string; amount: number; status: string; description: string; createdAt: string };
type Gateways = {
  razorpay: { configured: boolean };
  paypal: { configured: boolean };
};

type RazorpayCheckout = {
  open: () => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export function Billing() {
  const { setSession } = useApp();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [sub, setSub] = useState<Sub>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [gateways, setGateways] = useState<Gateways | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [payDialog, setPayDialog] = useState<{ plan: Plan } | null>(null);
  const [payBusy, setPayBusy] = useState<"razorpay" | "paypal" | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<{ plans: Plan[] }>("/api/v1/billing/plans"),
      api.get<{ subscription: Sub }>("/api/v1/billing/subscription"),
      api.get<{ invoices: Invoice[] }>("/api/v1/billing/invoices"),
      api.get<Gateways>("/api/v1/billing/gateways"),
    ])
      .then(([p, s, i, g]) => {
        setPlans(p.plans);
        setSub(s.subscription);
        setInvoices(i.invoices);
        setGateways(g);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  // Toast the result of a PayPal redirect return (?pay=success|cancelled|error)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pay = q.get("pay");
    if (pay === "success") {
      toast.success("Payment received — your new plan is active!");
      window.history.replaceState({}, "", window.location.pathname);
      load();
    } else if (pay === "cancelled") {
      toast.info("Payment cancelled — nothing was charged.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (pay === "error") {
      toast.error(`Payment failed: ${q.get("reason") ?? "unknown error"}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [load]);

  async function freeCheckout(planId: string) {
    setBusy(planId);
    try {
      await api.post("/api/v1/billing/checkout", { planId });
      toast.success("Plan activated — credits added to your balance");
      load();
      const me = await api.get("/api/v1/auth/me");
      setSession(me as never);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function payWithRazorpay(plan: Plan) {
    setPayBusy("razorpay");
    try {
      const order = await api.post<{
        orderId: string; keyId: string; amountInr: number; currency: string;
      }>("/api/v1/billing/checkout", { planId: plan.id, gateway: "razorpay" });

      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) throw new Error("Could not load Razorpay Checkout (network blocked?)");

      const me = await api.get<{ user?: { email?: string; name?: string } }>("/api/v1/auth/me");
      const rz = new window.Razorpay({
        key: order.keyId,
        amount: order.amountInr * 100,
        currency: order.currency,
        name: "ShortsPilot AI",
        description: `${plan.name} — monthly subscription`,
        order_id: order.orderId,
        prefill: { name: me?.user?.name ?? "", email: me?.user?.email ?? "" },
        theme: { color: "#10b981" },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await api.post("/api/v1/billing/razorpay/verify", {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            toast.success(`Payment verified — ${plan.name} is now active! 🎉`);
            setPayDialog(null);
            load();
            const fresh = await api.get("/api/v1/auth/me");
            setSession(fresh as never);
          } catch (e) {
            toastError(e);
          }
        },
        modal: {
          ondismiss: () => {
            toast.info("Payment window closed — nothing was charged.");
            setPayBusy(null);
          },
        },
      });
      rz.open();
    } catch (e) {
      toastError(e);
    } finally {
      setPayBusy(null);
    }
  }

  async function payWithPaypal(plan: Plan) {
    setPayBusy("paypal");
    try {
      const order = await api.post<{ approveUrl: string }>("/api/v1/billing/checkout", { planId: plan.id, gateway: "paypal" });
      window.location.href = order.approveUrl; // PayPal approval, returns to /api/v1/billing/paypal/return
    } catch (e) {
      toastError(e);
      setPayBusy(null);
    }
  }

  function startCheckout(plan: Plan) {
    const paid = plan.price > 0;
    const anyGateway = gateways?.razorpay.configured || gateways?.paypal.configured;
    if (!paid) return void freeCheckout(plan.id);
    if (!anyGateway) {
      toast.error(
        "No payment gateway configured yet. An admin must add free test keys in /admin → Payments (Razorpay or PayPal).",
        { duration: 8000 }
      );
      return;
    }
    setPayDialog({ plan });
  }

  async function cancel() {
    setBusy("cancel");
    try {
      await api.post("/api/v1/billing/cancel");
      toast.success("Subscription will end at period close");
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  const currentPlanId = sub?.plan?.id;

  return (
    <div>
      <SectionHeader
        title="Billing"
        description={
          sub
            ? `Current plan: ${sub.plan.name} · ${sub.status}${sub.cancelAtPeriodEnd ? " (cancels at period end)" : ""} · renews ${new Date(sub.periodEnd).toLocaleDateString()}`
            : "Choose a plan to power your channels."
        }
        actions={
          sub?.status === "ACTIVE" && !sub.cancelAtPeriodEnd ? (
            <Button variant="outline" onClick={cancel} disabled={busy === "cancel"} className="text-destructive hover:text-destructive">
              <XCircle className="mr-2 h-4 w-4" /> Cancel subscription
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => {
          const current = p.id === currentPlanId;
          return (
            <Card key={p.id} className={cn("flex flex-col border-border/60", current && "border-primary/60 shadow-lg shadow-primary/10")}>
              <CardContent className="flex flex-1 flex-col p-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{p.name}</h3>
                  {current && <Badge className="bg-primary text-primary-foreground">Current</Badge>}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold">${p.price}</span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                  {p.priceInr != null && p.price > 0 && (
                    <span className="text-xs text-muted-foreground">· ₹{p.priceInr}/mo</span>
                  )}
                </div>
                <ul className="mt-4 flex-1 space-y-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-muted-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-5 w-full"
                  variant={current ? "outline" : "default"}
                  disabled={current || busy === p.id}
                  onClick={() => startCheckout(p)}
                >
                  {busy === p.id ? <Spinner className="mr-2 h-4 w-4" /> : <CreditCard className="mr-2 h-4 w-4" />}
                  {current ? "Active" : p.price > 0 ? "Upgrade — pay securely" : "Switch to this plan"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {gateways?.razorpay.configured || gateways?.paypal.configured
          ? "Real payments active: Razorpay (₹) and/or PayPal ($) — the plan activates only after server-side payment verification."
          : "Paid plans need a payment gateway. Admins: add free test keys in /admin → Payments (Razorpay for INR, PayPal for USD)."}
      </p>

      <h2 className="mb-3 mt-8 inline-flex items-center gap-2 text-lg font-semibold">
        <Receipt className="h-4 w-4" /> Invoice history
      </h2>
      {invoices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invoices yet.</p>
      ) : (
        <Card className="border-border/60">
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {invoices.map((i) => (
                <div key={i.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="text-sm font-medium">{i.description}</div>
                    <div className="text-xs text-muted-foreground">{new Date(i.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">${i.amount.toFixed(2)}</span>
                    <Badge variant="outline" className={i.status === "PAID" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}>{i.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment gateway chooser */}
      <Dialog open={Boolean(payDialog)} onOpenChange={(o) => !o && !payBusy && setPayDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pay for {payDialog?.plan.name}</DialogTitle>
            <DialogDescription>
              Monthly subscription — {payDialog?.plan.shortsLimit} Shorts/month. Choose your payment method.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            {gateways?.razorpay.configured && (
              <Button
                variant="outline"
                className="h-auto justify-start gap-3 p-4"
                disabled={payBusy !== null}
                onClick={() => payDialog && void payWithRazorpay(payDialog.plan)}
              >
                <IndianRupee className="h-5 w-5 text-emerald-400" />
                <span className="flex flex-col items-start">
                  <span className="font-medium">Razorpay — UPI / Cards / NetBanking</span>
                  <span className="text-xs text-muted-foreground">
                    {payDialog ? `₹${payDialog.plan.priceInr ?? 0} per month` : "INR"} · secure popup checkout
                  </span>
                </span>
                {payBusy === "razorpay" && <Spinner className="ml-auto h-4 w-4" />}
              </Button>
            )}
            {gateways?.paypal.configured && (
              <Button
                variant="outline"
                className="h-auto justify-start gap-3 p-4"
                disabled={payBusy !== null}
                onClick={() => payDialog && void payWithPaypal(payDialog.plan)}
              >
                <Globe className="h-5 w-5 text-sky-400" />
                <span className="flex flex-col items-start">
                  <span className="font-medium">PayPal — international</span>
                  <span className="text-xs text-muted-foreground">
                    {payDialog ? `$${payDialog.plan.price} per month` : "USD"} · redirect approval
                  </span>
                </span>
                {payBusy === "paypal" && <Spinner className="ml-auto h-4 w-4" />}
              </Button>
            )}
            {!gateways?.razorpay.configured && !gateways?.paypal.configured && (
              <p className="text-sm text-muted-foreground">
                No gateway configured. Admin: /admin → Payments → add free test keys.
              </p>
            )}
          </div>
          <DialogFooter className="text-xs text-muted-foreground">
            Test mode keys charge ₹1/sandbox money — nothing real until you flip to live.
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
