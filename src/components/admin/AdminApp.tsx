"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "./common";
import { api, toastError } from "@/components/spa/api";
import { cn } from "@/lib/utils";
import { APP_VERSION, APP_BUILD } from "@/lib/version";
import {
  LayoutDashboard, Users, CreditCard, Tags, Coins, SlidersHorizontal,
  Activity, Plug, ScrollText, ShieldCheck, LogOut, ExternalLink, Clapperboard, ShieldAlert, Wallet,
} from "lucide-react";
import { LoginPanel } from "./LoginPanel";
import { OverviewPanel } from "./OverviewPanel";
import { UsersPanel } from "./UsersPanel";
import { SubscriptionsPanel } from "./SubscriptionsPanel";
import { PlansPanel } from "./PlansPanel";
import { CreditsPanel } from "./CreditsPanel";
import { PricingPanel } from "./PricingPanel";
import { JobsPanel } from "./JobsPanel";
import { IntegrationsPanel } from "./IntegrationsPanel";
import { PaymentsPanel } from "./PaymentsPanel";
import { AuditPanel } from "./AuditPanel";

type AdminUser = { id: string; email: string; name: string; role: string };
type TabId =
  | "overview" | "users" | "subscriptions" | "plans" | "credits"
  | "pricing" | "payments" | "jobs" | "integrations" | "audit";

const NAV: { id: TabId; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "Platform" },
  { id: "users", label: "Users", icon: Users, group: "Platform" },
  { id: "subscriptions", label: "Subscriptions", icon: CreditCard, group: "Platform" },
  { id: "plans", label: "Plans & Pricing", icon: Tags, group: "Monetization" },
  { id: "credits", label: "Credits Ledger", icon: Coins, group: "Monetization" },
  { id: "pricing", label: "AI Pricing", icon: SlidersHorizontal, group: "Monetization" },
  { id: "payments", label: "Payments", icon: Wallet, group: "Monetization" },
  { id: "jobs", label: "Jobs Monitor", icon: Activity, group: "Operations" },
  { id: "integrations", label: "API & Integrations", icon: Plug, group: "Operations" },
  { id: "audit", label: "Audit Log", icon: ScrollText, group: "Operations" },
];

const TABS: Record<TabId, { title: string; description: string }> = {
  overview: { title: "Platform Overview", description: "Live KPIs across users, revenue, credits, videos and jobs." },
  users: { title: "User Management", description: "Search, roles, suspensions, credit adjustments, password resets and caps." },
  subscriptions: { title: "Subscriptions", description: "Every plan subscription — change plan, extend, cancel or reactivate." },
  plans: { title: "Plans & Pricing", description: "Edit public pricing tiers, monthly limits and feature lists." },
  credits: { title: "Credits Ledger", description: "Platform-wide credit balance, grants, spends and manual adjustments." },
  pricing: { title: "AI Pricing", description: "Set credit cost per AI operation — applied to all new jobs instantly." },
  payments: { title: "Payment Gateways", description: "Razorpay (INR) and PayPal (international) — real checkout with server-side verification." },
  jobs: { title: "Jobs Monitor", description: "Render and publishing pipelines across every tenant." },
  integrations: { title: "API & Integrations", description: "Google OAuth client, YouTube Data API key and provider status." },
  audit: { title: "Audit Log", description: "Immutable trail of every privileged action on this instance." },
};

export function AdminApp() {
  const [phase, setPhase] = useState<"loading" | "login" | "denied" | "ready">("loading");
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [tab, setTab] = useState<TabId>("overview");

  const check = useCallback(async () => {
    try {
      const me = await api.get<{ user: AdminUser | null }>("/api/v1/auth/me");
      if (!me.user) {
        setPhase("login");
        return;
      }
      if (me.user.role !== "ADMIN") {
        setAdmin(me.user);
        setPhase("denied");
        return;
      }
      setAdmin(me.user);
      setPhase("ready");
    } catch {
      setPhase("login");
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void check(), 0);
    return () => clearTimeout(t);
  }, [check]);

  async function logout() {
    try {
      await api.post("/api/v1/auth/logout");
    } catch {
      /* ignore */
    }
    toast.success("Signed out of Admin Console");
    setPhase("login");
    setAdmin(null);
  }

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (phase === "login") return <LoginPanel onSuccess={() => void check()} />;

  if (phase === "denied") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md border-destructive/30">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Access denied</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {admin?.email} is not an administrator. Sign in with an admin account to open this console.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={logout}>Switch account</Button>
              <Button asChild variant="ghost">
                <Link href="/">Back to app <ExternalLink className="ml-1 h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const groups = Array.from(new Set(NAV.map((n) => n.group)));
  const meta = TABS[tab];

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar (mobile) */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-emerald-400" />
          <span className="font-bold">Admin Console</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/"><ExternalLink className="h-3.5 w-3.5" /></Link>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void logout()}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border/60 bg-card/30 lg:flex">
          <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Clapperboard className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight">ShortsPilot AI</p>
              <p className="text-[11px] text-muted-foreground">Admin Console</p>
            </div>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Admin sections">
            {groups.map((group) => (
              <div key={group}>
                <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{group}</p>
                <div className="space-y-0.5">
                  {NAV.filter((n) => n.group === group).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setTab(n.id)}
                      aria-current={tab === n.id ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        tab === n.id
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <n.icon className="h-4 w-4 shrink-0" />
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-border/60 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{admin?.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{admin?.email}</p>
                <p className="text-[10px] text-muted-foreground/60" title="Running build — if this is older than the latest release, re-extract the project zip">v{APP_VERSION} · {APP_BUILD}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button asChild size="icon" variant="ghost" className="h-8 w-8" title="Open app">
                  <Link href="/"><ExternalLink className="h-3.5 w-3.5" /></Link>
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => void logout()} title="Sign out">
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
            <div className="mb-6">
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{meta.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
            </div>

            {/* Section tabs (mobile) */}
            <div className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden" role="tablist" aria-label="Admin sections">
              {NAV.map((n) => (
                <button
                  key={n.id}
                  role="tab"
                  aria-selected={tab === n.id}
                  onClick={() => setTab(n.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    tab === n.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-card/40 text-muted-foreground"
                  )}
                >
                  <n.icon className="h-3.5 w-3.5" />
                  {n.label}
                </button>
              ))}
            </div>

            {tab === "overview" && <OverviewPanel />}
            {tab === "users" && <UsersPanel />}
            {tab === "subscriptions" && <SubscriptionsPanel />}
            {tab === "plans" && <PlansPanel />}
            {tab === "credits" && <CreditsPanel />}
            {tab === "pricing" && <PricingPanel />}
            {tab === "jobs" && <JobsPanel />}
            {tab === "payments" && <PaymentsPanel />}
            {tab === "integrations" && <IntegrationsPanel />}
            {tab === "audit" && <AuditPanel />}
          </div>
        </main>
      </div>
    </div>
  );
}
