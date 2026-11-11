"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeader, StatusBadge } from "./common";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import {
  ShieldCheck, ExternalLink, Users, CreditCard, Tags, Coins,
  SlidersHorizontal, Activity, Plug, ScrollText,
} from "lucide-react";
import Link from "next/link";

type Overview = {
  users: { total: number; active: number };
  videos: { total: number; published: number };
  revenue: { total: number; mrr: number };
  credits: { outstanding: number };
  jobs: { failedRenders: number; failedPublishes: number };
};

type AdminUser = {
  id: string; email: string; status: string;
};

/** In-app quick console — the full backend panel lives at /admin. */
export function Admin() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [userCount, setUserCount] = useState(0);
  const [pending, setPending] = useState<AdminUser[]>([]);

  useEffect(() => {
    api.get<Overview>("/api/v1/admin/overview").then(setOverview).catch(() => {});
    api
      .get<{ users: AdminUser[]; total: number }>("/api/v1/admin/users?limit=100")
      .then((d) => {
        setUserCount(d.total);
        setPending(d.users.filter((u) => u.status !== "ACTIVE"));
      })
      .catch(() => {});
  }, []);

  async function reactivate(u: AdminUser) {
    try {
      await api.patch("/api/v1/admin/users", { userId: u.id, status: "ACTIVE" });
      toast.success(`${u.email} re-activated`);
      setPending((p) => p.filter((x) => x.id !== u.id));
    } catch (e) {
      toastError(e);
    }
  }

  const sections = [
    { icon: Users, title: "Users", desc: "Roles, suspensions, credits, password resets" },
    { icon: CreditCard, title: "Subscriptions", desc: "Change plan, extend, cancel, reactivate" },
    { icon: Tags, title: "Plans & Pricing", desc: "Edit public pricing tiers & limits" },
    { icon: Coins, title: "Credits Ledger", desc: "Balances, grants, spends, adjustments" },
    { icon: SlidersHorizontal, title: "AI Pricing", desc: "Credit cost per AI operation" },
    { icon: Activity, title: "Jobs Monitor", desc: "Render & publishing pipelines" },
    { icon: Plug, title: "API & Integrations", desc: "Google OAuth, YouTube Data API key" },
    { icon: ScrollText, title: "Audit Log", desc: "Every privileged action, searchable" },
  ];

  return (
    <div>
      <SectionHeader
        title="Admin Console"
        description="Full backend control panel — users, pricing, subscriptions, credits, APIs and ops."
        actions={
          <Button asChild>
            <Link href="/admin" target="_blank">
              Open /admin panel <ExternalLink className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Users", value: overview?.users.total, sub: `${overview?.users.active ?? 0} active sessions` },
          { label: "MRR", value: overview ? `$${overview.revenue.mrr.toFixed(0)}` : undefined, sub: `${userCount} accounts` },
          { label: "Videos", value: overview?.videos.total, sub: `${overview?.videos.published ?? 0} published` },
          { label: "Credits outstanding", value: overview?.credits.outstanding, sub: `$${overview?.revenue.total.toFixed(0) ?? 0} billed` },
        ].map((k) => (
          <Card key={k.label} className="border-border/60">
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{typeof k.value === "number" ? k.value.toLocaleString() : (k.value ?? "—")}</div>
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">{k.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Everything you can manage
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {sections.map((s) => (
              <Link
                key={s.title}
                href="/admin"
                className="group flex items-start gap-2.5 rounded-lg border border-border/50 p-2.5 transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" />
                <div className="min-w-0">
                  <p className="text-sm font-medium group-hover:text-primary">{s.title}</p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">{s.desc}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Suspended accounts</CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 space-y-2 overflow-y-auto">
            {pending.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{u.email}</p>
                  <StatusBadge status="FAILED" />
                </div>
                <Button size="sm" variant="outline" className="text-emerald-400" onClick={() => void reactivate(u)}>
                  Reactivate
                </Button>
              </div>
            ))}
            {pending.length === 0 && (
              <p className="flex items-center gap-2 p-4 text-center text-sm text-muted-foreground">
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400">all clear</Badge>
                No suspended accounts.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

