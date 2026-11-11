"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AdminKpi, Spinner, timeAgo, fmtMoney, fmtN,
} from "./common";
import { api } from "@/components/spa/api";
import {
  Users, UserPlus, DollarSign, TrendingUp, Coins, Film,
  UploadCloud, Clock, AlertTriangle, ShieldCheck, Zap, Youtube, RefreshCw,
} from "lucide-react";

type Overview = {
  users: { total: number; active: number; newThisMonth: number };
  subscriptions: { byStatus: { status: string; count: number }[]; byPlan: { planId: string; count: number }[] };
  videos: { total: number; published: number; thisMonth: number; pendingApproval: number; scheduled: number };
  jobs: { failedRenders: number; failedPublishes: number };
  channels: { mode: string; count: number }[];
  costs: { monthEstimated: number; monthActual: number; monthCalls: number };
  credits: { outstanding: number; granted: number; spent: number; released: number };
  revenue: { total: number; month: number; mrr: number };
  recentAudit: { id: string; action: string; email?: string; resourceType?: string; createdAt: string }[];
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  TRIAL: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  CANCELLED: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400",
  PAST_DUE: "border-amber-500/40 bg-amber-500/10 text-amber-400",
};

const MODE_COLORS: Record<string, string> = {
  oauth: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  apikey: "border-violet-500/40 bg-violet-500/10 text-violet-400",
  sandbox: "border-amber-500/40 bg-amber-500/10 text-amber-400",
};

export function OverviewPanel() {
  const [data, setData] = useState<Overview | null>(null);

  const load = useCallback(() => {
    api.get<Overview>("/api/v1/admin/overview").then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  const failed = data.jobs.failedRenders + data.jobs.failedPublishes;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh · auto 30s
        </button>
      </div>

      {/* Revenue */}
      <section aria-label="Revenue">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminKpi label="MRR (active subs)" value={fmtMoney(data.revenue.mrr)} icon={<TrendingUp className="h-4 w-4" />} accent="text-emerald-400" sub="Sum of active plan prices" />
          <AdminKpi label="Revenue this month" value={fmtMoney(data.revenue.month)} icon={<DollarSign className="h-4 w-4" />} sub="Paid invoices (MTD)" />
          <AdminKpi label="Revenue all time" value={fmtMoney(data.revenue.total)} icon={<DollarSign className="h-4 w-4" />} sub="All paid invoices" />
          <AdminKpi label="AI credits outstanding" value={fmtN(data.credits.outstanding)} icon={<Coins className="h-4 w-4" />} accent="text-violet-400" sub={`Granted ${fmtN(data.credits.granted)} · Spent ${fmtN(data.credits.spent)}`} />
        </div>
      </section>

      {/* Users & videos */}
      <section aria-label="Users and videos" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <AdminKpi label="Total users" value={data.users.total} icon={<Users className="h-4 w-4" />} sub={`+${data.users.newThisMonth} this month`} />
        <AdminKpi label="Active sessions" value={data.users.active} icon={<ShieldCheck className="h-4 w-4" />} sub="Live logins" />
        <AdminKpi label="Videos generated" value={data.videos.total} icon={<Film className="h-4 w-4" />} sub={`${data.videos.thisMonth} this month`} />
        <AdminKpi label="Published" value={data.videos.published} icon={<UploadCloud className="h-4 w-4" />} sub="On YouTube" />
        <AdminKpi label="Pending approval" value={data.videos.pendingApproval} icon={<Clock className="h-4 w-4" />} sub={data.videos.scheduled > 0 ? `${data.videos.scheduled} scheduled` : undefined} />
        <AdminKpi label="Failed jobs" value={failed} icon={<AlertTriangle className="h-4 w-4" />} accent={failed > 0 ? "text-amber-400" : undefined} sub={`${data.jobs.failedRenders} render · ${data.jobs.failedPublishes} publish`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Subscriptions breakdown */}
        <Card className="border-border/60">
          <CardHeader className="pb-3"><CardTitle className="text-base">Subscriptions & channels</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">By status</p>
              <div className="flex flex-wrap gap-2">
                {data.subscriptions.byStatus.map((s) => (
                  <Badge key={s.status} variant="outline" className={STATUS_COLORS[s.status] ?? ""}>
                    {s.status}: {s.count}
                  </Badge>
                ))}
                {data.subscriptions.byStatus.length === 0 && <span className="text-xs text-muted-foreground">No subscriptions yet</span>}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">By plan</p>
              <div className="flex flex-wrap gap-2">
                {data.subscriptions.byPlan.map((p) => (
                  <Badge key={p.planId} variant="outline">{p.planId}: {p.count}</Badge>
                ))}
                {data.subscriptions.byPlan.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Youtube className="h-3.5 w-3.5" /> Connected channels by mode
              </p>
              <div className="flex flex-wrap gap-2">
                {data.channels.map((c) => (
                  <Badge key={c.mode} variant="outline" className={MODE_COLORS[c.mode] ?? ""}>
                    {c.mode}: {c.count}
                  </Badge>
                ))}
                {data.channels.length === 0 && <span className="text-xs text-muted-foreground">No channels connected</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-accent/30 px-3 py-2 text-xs text-muted-foreground">
              <Zap className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              AI usage this month: <span className="font-medium text-foreground">{fmtN(data.costs.monthCalls)} calls</span> · est. {fmtN(data.costs.monthEstimated)} credits
            </div>
          </CardContent>
        </Card>

        {/* Recent audit */}
        <Card className="border-border/60">
          <CardHeader className="pb-3"><CardTitle className="text-base">Recent activity (audit)</CardTitle></CardHeader>
          <CardContent className="max-h-72 space-y-1.5 overflow-y-auto">
            {data.recentAudit.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm odd:bg-accent/30">
                <span className="line-clamp-1">
                  <span className="font-medium">{a.action}</span>
                  {a.email && <span className="text-muted-foreground"> — {a.email}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
              </div>
            ))}
            {data.recentAudit.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">No audit entries yet.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
