"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SectionHeader, Spinner } from "./common";
import { api } from "./api";
import { Coins, Zap, History } from "lucide-react";

type UsageData = {
  credits: { balance: number; spentThisMonth: number; monthlyCap: number };
  plan: { name: string; shortsLimit: number; shortsUsed: number } | null;
  usageByProvider: { provider: string; operation: string; calls: number; units: number; estimatedCost: number }[];
};
type Ledger = { id: string; type: string; amount: number; balance: number; description: string; createdAt: string };

const TYPE_COLOR: Record<string, string> = {
  GRANT: "text-emerald-400",
  CHARGE: "text-rose-400",
  RELEASE: "text-sky-400",
  RESERVE: "text-amber-400",
};

export function UsageView() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      api.get<UsageData>("/api/v1/usage"),
      api.get<{ entries: Ledger[] }>("/api/v1/usage/ledger?limit=30"),
    ])
      .then(([u, l]) => {
        setUsage(u);
        setLedger(l.entries);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;
  if (!usage) return null;

  const capPct = Math.min(100, Math.round((usage.credits.spentThisMonth / Math.max(1, usage.credits.monthlyCap)) * 100));

  return (
    <div>
      <SectionHeader title="Usage & Credits" description="Transparent credit ledger for every AI operation." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-border/60">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Coins className="h-4 w-4 text-primary" /> Credit balance</CardTitle></CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-primary">{usage.credits.balance}</div>
            <p className="mt-1 text-sm text-muted-foreground">credits available</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader><CardTitle className="text-base">This month</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="text-muted-foreground">Spent</span>
                <span>{usage.credits.spentThisMonth} / {usage.credits.monthlyCap}</span>
              </div>
              <Progress value={capPct} />
            </div>
            {usage.plan && (
              <div>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="text-muted-foreground">{usage.plan.name} plan</span>
                  <span>{usage.plan.shortsUsed}/{usage.plan.shortsLimit} Shorts</span>
                </div>
                <Progress value={Math.min(100, (usage.plan.shortsUsed / Math.max(1, usage.plan.shortsLimit)) * 100)} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Zap className="h-4 w-4 text-primary" /> By operation</CardTitle></CardHeader>
          <CardContent>
            {usage.usageByProvider.length === 0 ? (
              <p className="text-sm text-muted-foreground">No usage this month.</p>
            ) : (
              <div className="space-y-2 text-sm">
                {usage.usageByProvider.map((u, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{u.provider}/{u.operation}</span>
                    <span>{u.calls} calls · {u.estimatedCost} cr</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 inline-flex items-center gap-2 text-lg font-semibold">
        <History className="h-4 w-4" /> Credit ledger
      </h2>
      <Card className="border-border/60">
        <CardContent className="max-h-96 overflow-y-auto p-0">
          <div className="divide-y divide-border/60">
            {ledger.map((e) => (
              <div key={e.id} className="flex items-center justify-between p-3.5">
                <div className="min-w-0">
                  <div className="line-clamp-1 text-sm">{e.description}</div>
                  <div className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</div>
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <div className={`text-sm font-semibold ${TYPE_COLOR[e.type] ?? ""}`}>
                    {e.type === "CHARGE" ? "−" : "+"}{e.amount}
                  </div>
                  <div className="text-xs text-muted-foreground">bal {e.balance}</div>
                </div>
              </div>
            ))}
            {ledger.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No transactions yet.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
