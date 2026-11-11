"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "./common";
import { api, toastError } from "@/components/spa/api";
import { toast } from "sonner";
import { ExternalLink, IndianRupee, Loader2, Save, Trash2, Wallet, Globe } from "lucide-react";

type Gateways = {
  razorpay: { configured: boolean; mode: string; source: string | null };
  paypal: { configured: boolean; mode: string; source: string | null };
  help?: { razorpayDashboard: string; paypalDashboard: string };
};

/** Admin -> Payments: configure Razorpay (INR) and PayPal (international) gateways. */
export function PaymentsPanel() {
  const [cfg, setCfg] = useState<Gateways | null>(null);
  const [rzId, setRzId] = useState("");
  const [rzSecret, setRzSecret] = useState("");
  const [ppId, setPpId] = useState("");
  const [ppSecret, setPpSecret] = useState("");
  const [ppMode, setPpMode] = useState<"test" | "live">("test");
  const [busy, setBusy] = useState(false);
  const [clearTarget, setClearTarget] = useState<"razorpay" | "paypal" | null>(null);

  const load = useCallback(() => {
    api.get<Gateways>("/api/v1/admin/payments/config").then(setCfg).catch(() => {});
  }, []);

  useEffect(() => load(), [load]);

  async function saveRazorpay() {
    if (!rzId && !rzSecret) {
      toast.error("Enter Razorpay key id and/or secret");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<Gateways>("/api/v1/admin/payments/config", {
        ...(rzId ? { razorpayKeyId: rzId } : {}),
        ...(rzSecret ? { razorpayKeySecret: rzSecret } : {}),
      });
      setCfg(res);
      setRzId("");
      setRzSecret("");
      toast.success("Razorpay credentials saved (secret AES-256-GCM encrypted)");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function savePaypal() {
    if (!ppId && !ppSecret) {
      toast.error("Enter PayPal client id and/or secret");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<Gateways>("/api/v1/admin/payments/config", {
        ...(ppId ? { paypalClientId: ppId } : {}),
        ...(ppSecret ? { paypalClientSecret: ppSecret } : {}),
        paypalMode: ppMode,
      });
      setCfg(res);
      setPpId("");
      setPpSecret("");
      toast.success("PayPal credentials saved (secret AES-256-GCM encrypted)");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!clearTarget) return;
    setBusy(true);
    try {
      const res = await api.del<Gateways>(`/api/v1/admin/payments/config?key=${clearTarget}`);
      setCfg(res);
      toast.success("Stored credentials cleared");
      setClearTarget(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!cfg) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  const badge = (okState: boolean, text?: string) => (
    <Badge variant="outline" className={okState ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}>
      {okState ? `configured${text ? ` (${text})` : ""}` : "not configured"}
    </Badge>
  );

  return (
    <div className="space-y-5">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Real payments are wired into checkout — paid plans activate only after server-side verification/capture.
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Configure the gateways below (both offer <span className="font-medium text-foreground">free test-mode keys</span>).
          Users see a payment dialog on paid plans: <span className="font-medium text-foreground">Razorpay</span> charges in ₹ INR,
          <span className="font-medium text-foreground"> PayPal</span> charges in $ USD.
        </CardContent>
      </Card>

      {/* Razorpay */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><IndianRupee className="h-4 w-4 text-emerald-400" /> Razorpay — India (INR)</span>
            {badge(cfg.razorpay.configured, cfg.razorpay.source ?? undefined)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Create a free account at{" "}
            <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href={cfg.help?.razorpayDashboard ?? "https://dashboard.razorpay.com/app/keys"} target="_blank" rel="noreferrer">
              dashboard.razorpay.com <ExternalLink className="h-3 w-3" />
            </a>{" "}
            — test-mode keys are available instantly, no KYC needed. Used for ₹ plan prices (Starter ₹749, Pro ₹1999, Agency ₹4999).
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rzid">Key Id {cfg.razorpay.configured && <span className="text-xs text-muted-foreground">(leave blank to keep)</span>}</Label>
              <Input id="rzid" value={rzId} onChange={(e) => setRzId(e.target.value)} placeholder="rzp_test_xxxxxxxxxxxx" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rzsecret">Key Secret {cfg.razorpay.configured && <span className="text-xs text-muted-foreground">(leave blank to keep)</span>}</Label>
              <Input id="rzsecret" type="password" value={rzSecret} onChange={(e) => setRzSecret(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => void saveRazorpay()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save Razorpay keys
            </Button>
            {cfg.razorpay.configured && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setClearTarget("razorpay")} disabled={busy}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear stored keys
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PayPal */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><Globe className="h-4 w-4 text-sky-400" /> PayPal — International (USD)</span>
            {badge(cfg.paypal.configured, cfg.paypal.mode)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Create a free developer account at{" "}
            <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href={cfg.help?.paypalDashboard ?? "https://developer.paypal.com/dashboard/applications"} target="_blank" rel="noreferrer">
              developer.paypal.com <ExternalLink className="h-3 w-3" />
            </a>{" "}
            — sandbox (test) credentials are free. Switch to live only after real business verification.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ppid">Client ID {cfg.paypal.configured && <span className="text-xs text-muted-foreground">(leave blank to keep)</span>}</Label>
              <Input id="ppid" value={ppId} onChange={(e) => setPpId(e.target.value)} placeholder="AeXXXXXXXXXXXXXXXXXXXXXXXXX" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ppsecret">Client Secret {cfg.paypal.configured && <span className="text-xs text-muted-foreground">(leave blank to keep)</span>}</Label>
              <Input id="ppsecret" type="password" value={ppSecret} onChange={(e) => setPpSecret(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </div>
          </div>
          <div className="space-y-1.5 sm:max-w-48">
            <Label>Mode</Label>
            <Select value={ppMode} onValueChange={(v) => setPpMode(v === "live" ? "live" : "test")}>
              <SelectTrigger id="ppmode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="test">test (sandbox — free)</SelectItem>
                <SelectItem value="live">live (real money)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => void savePaypal()} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save PayPal credentials
            </Button>
            {cfg.paypal.configured && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setClearTarget("paypal")} disabled={busy}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear stored credentials
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-primary" /> How verification works</CardTitle>
        </CardHeader>
        <CardContent className="text-xs leading-relaxed text-muted-foreground">
          <p><span className="font-medium text-foreground">Razorpay:</span> Checkout.js popup → client sends order_id / payment_id / signature → server verifies HMAC-SHA256(order|payment) with the key secret → invoice PAID + subscription ACTIVE + credits granted.</p>
          <p className="mt-1.5"><span className="font-medium text-foreground">PayPal:</span> server creates the order (USD) → user approves on PayPal → PayPal redirects to <code className="font-mono text-[11px]">/api/v1/billing/paypal/return</code> → server captures the payment → plan activates → user is redirected back to the app.</p>
          <p className="mt-1.5">For live payments in production, also configure Razorpay webhooks and move PayPal mode to <code className="font-mono text-[11px]">live</code> after business approval.</p>
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(clearTarget)} onOpenChange={(o) => !o && setClearTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear stored credentials?</AlertDialogTitle>
            <AlertDialogDescription>Removes the credentials saved from this admin UI. Environment variables (if set) still apply.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void clear()}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
