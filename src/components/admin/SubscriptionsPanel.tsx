"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination, Spinner, StatusBadge, timeAgo } from "./common";
import { api, toastError } from "@/components/spa/api";
import { toast } from "sonner";
import { Search, RefreshCw, Loader2, CalendarPlus } from "lucide-react";

type PlanLite = { id: string; name: string; price: number };
type Subscription = {
  id: string; planId: string; status: string; periodStart: string; periodEnd: string;
  cancelAtPeriodEnd: boolean; provider: string; createdAt: string;
  user: { id: string; email: string; name: string; status: string };
  plan: PlanLite & { shortsLimit: number; channelsLimit: number };
  _count: { invoices: number };
};

const STATUSES = ["TRIAL", "ACTIVE", "CANCELLED", "PAST_DUE"];
const PAGE_SIZE = 20;

export function SubscriptionsPanel() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<PlanLite[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    api
      .get<{ subscriptions: Subscription[]; total: number; plans: PlanLite[] }>(`/api/v1/admin/subscriptions?${params}`)
      .then((d) => {
        setSubs(d.subscriptions);
        setTotal(d.total);
        setPlans(d.plans);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [q, status, page]);

  useEffect(() => load(), [load]);

  function onSearch(v: string) {
    setSearchText(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setQ(v);
      setPage(1);
    }, 350);
  }

  async function patch(sub: Subscription, data: Record<string, unknown>, msg: string) {
    setBusy(sub.id);
    try {
      await api.patch("/api/v1/admin/subscriptions", { subscriptionId: sub.id, ...data });
      toast.success(msg);
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={searchText} onChange={(e) => onSearch(e.target.value)} placeholder="Search user email or name…" className="pl-8" aria-label="Search subscriptions" />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load} className="shrink-0">
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {loading && subs.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : (
        <>
          <Card className="border-border/60">
            <CardContent className="p-0">
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-3 py-3 font-medium">Plan</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Period ends</th>
                    <th className="px-3 py-3 font-medium text-center">Cancel @ end</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id} className="border-b border-border/40 last:border-0">
                      <td className="max-w-48 px-4 py-3">
                        <p className="truncate font-medium">{s.user.email}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.provider} · {s._count.invoices} invoices · joined {timeAgo(s.createdAt)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <Select value={s.planId} onValueChange={(v) => patch(s, { planId: v }, `Plan changed to ${plans.find((p) => p.id === v)?.name ?? v}`)}>
                          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — ${p.price}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={s.status === "CANCELLED" ? "CANCELLED_SUB" : s.status} />
                          {s.cancelAtPeriodEnd && <Badge variant="outline" className="text-[10px]">ending</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {new Date(s.periodEnd).toLocaleDateString()}
                        <span className="block text-muted-foreground">
                          {new Date(s.periodEnd) < new Date() ? "expired" : `${Math.ceil((new Date(s.periodEnd).getTime() - Date.now()) / 86400000)}d left`}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <Switch
                          checked={s.cancelAtPeriodEnd}
                          aria-label="Cancel at period end"
                          onCheckedChange={(v) => patch(s, { cancelAtPeriodEnd: v }, v ? "Will cancel at period end" : "Auto-renew restored")}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === s.id}
                            onClick={() => patch(s, { extendDays: 30 }, "Extended +30 days")}>
                            <CalendarPlus className="mr-1 h-3 w-3" /> +30d
                          </Button>
                          {s.status !== "ACTIVE" ? (
                            <Button size="sm" variant="outline" className="h-8 text-xs text-emerald-400" disabled={busy === s.id}
                              onClick={() => patch(s, { status: "ACTIVE" }, "Subscription reactivated")}>
                              Reactivate
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="h-8 text-xs text-muted-foreground" disabled={busy === s.id}
                              onClick={() => patch(s, { status: "CANCELLED" }, "Subscription cancelled")}>
                              Cancel
                            </Button>
                          )}
                          {busy === s.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile cards */}
              <div className="space-y-3 p-3 md:hidden">
                {subs.map((s) => (
                  <div key={s.id} className="rounded-lg border border-border/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{s.user.email}</p>
                        <p className="text-xs text-muted-foreground">ends {new Date(s.periodEnd).toLocaleDateString()}</p>
                      </div>
                      <StatusBadge status={s.status === "CANCELLED" ? "CANCELLED_SUB" : s.status} />
                    </div>
                    <div className="mt-3 space-y-2">
                      <Select value={s.planId} onValueChange={(v) => patch(s, { planId: v }, "Plan changed")}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — ${p.price}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === s.id}
                          onClick={() => patch(s, { extendDays: 30 }, "Extended +30 days")}>
                          <CalendarPlus className="mr-1 h-3 w-3" /> +30d
                        </Button>
                        {s.status !== "ACTIVE" ? (
                          <Button size="sm" variant="outline" className="h-8 text-xs text-emerald-400" disabled={busy === s.id}
                            onClick={() => patch(s, { status: "ACTIVE" }, "Reactivated")}>Reactivate</Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === s.id}
                            onClick={() => patch(s, { status: "CANCELLED" }, "Cancelled")}>Cancel</Button>
                        )}
                        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === s.id}
                          onClick={() => patch(s, { cancelAtPeriodEnd: !s.cancelAtPeriodEnd }, "Auto-renew updated")}>
                          {s.cancelAtPeriodEnd ? "Restore renew" : "Stop renew"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {subs.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No subscriptions match these filters.</p>}
            </CardContent>
          </Card>
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />
        </>
      )}
    </div>
  );
}
