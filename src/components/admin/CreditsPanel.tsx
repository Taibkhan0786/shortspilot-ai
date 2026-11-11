"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminKpi, Pagination, Spinner, fmtN, timeAgo } from "./common";
import { api, toastError } from "@/components/spa/api";
import { toast } from "sonner";
import { Search, RefreshCw, Loader2, Coins, Plus, Minus } from "lucide-react";

type LedgerRow = {
  id: string; userId: string; type: string; amount: number; balance: number;
  description: string; createdAt: string;
  user: { email: string; name: string };
};
type CreditsData = {
  ledger: LedgerRow[];
  total: number;
  page: number;
  stats: { outstanding: number; granted: number; spent: number; released: number; adjusted: number };
};
type UserLite = { id: string; email: string; name: string; credits: number };

const TYPES = ["GRANT", "CHARGE", "RELEASE", "RESERVE", "ADJUST"];
const PAGE_SIZE = 30;

const TYPE_STYLE: Record<string, string> = {
  GRANT: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  CHARGE: "border-rose-500/40 bg-rose-500/10 text-rose-400",
  RELEASE: "border-sky-500/40 bg-sky-500/10 text-sky-400",
  RESERVE: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  ADJUST: "border-violet-500/40 bg-violet-500/10 text-violet-400",
};

export function CreditsPanel() {
  const [data, setData] = useState<CreditsData | null>(null);
  const [page, setPage] = useState(1);
  const [type, setType] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (q) params.set("q", q);
    if (type !== "all") params.set("type", type);
    api
      .get<CreditsData>(`/api/v1/admin/credits?${params}`)
      .then(setData)
      .catch(() => {});
  }, [q, type, page]);

  useEffect(() => load(), [load]);

  function onSearch(v: string) {
    setSearchText(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setQ(v);
      setPage(1);
    }, 350);
  }

  if (!data) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <AdminKpi label="Outstanding credits" value={fmtN(data.stats.outstanding)} icon={<Coins className="h-4 w-4" />} accent="text-violet-400" sub="Across all users" />
        <AdminKpi label="Granted" value={fmtN(data.stats.granted)} icon={<Plus className="h-4 w-4" />} accent="text-emerald-400" />
        <AdminKpi label="Spent" value={fmtN(data.stats.spent)} icon={<Minus className="h-4 w-4" />} accent="text-rose-400" />
        <AdminKpi label="Released (refunds)" value={fmtN(data.stats.released)} icon={<RefreshCw className="h-4 w-4" />} />
        <AdminKpi label="Admin adjustments" value={fmtN(data.stats.adjusted)} icon={<Coins className="h-4 w-4" />} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={searchText} onChange={(e) => onSearch(e.target.value)} placeholder="Search user email…" className="pl-8" aria-label="Search ledger" />
        </div>
        <Select value={type} onValueChange={(v) => { setType(v); setPage(1); }}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setGrantOpen(true)} className="shrink-0">
          <Coins className="mr-1 h-3.5 w-3.5" /> Grant credits
        </Button>
        <Button variant="outline" size="sm" onClick={load} className="shrink-0">
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
        </Button>
      </div>

      <Card className="border-border/60">
        <CardContent className="p-0">
          <table className="hidden w-full text-sm md:table">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-3 py-3 font-medium">User</th>
                <th className="px-3 py-3 font-medium">Type</th>
                <th className="px-3 py-3 font-medium text-right">Amount</th>
                <th className="px-3 py-3 font-medium text-right">Balance after</th>
                <th className="px-4 py-3 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {data.ledger.map((r) => (
                <tr key={r.id} className="border-b border-border/40 last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</td>
                  <td className="max-w-44 truncate px-3 py-3 font-medium">{r.user?.email ?? r.userId}</td>
                  <td className="px-3 py-3"><Badge variant="outline" className={TYPE_STYLE[r.type] ?? ""}>{r.type}</Badge></td>
                  <td className={`px-3 py-3 text-right font-medium tabular-nums ${r.type === "CHARGE" || r.type === "ADJUST" ? "text-rose-400" : "text-emerald-400"}`}>
                    {r.type === "CHARGE" || r.type === "ADJUST" ? "−" : "+"}{fmtN(r.amount)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtN(r.balance)}</td>
                  <td className="max-w-52 truncate px-4 py-3 text-xs text-muted-foreground" title={r.description}>{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-2 p-3 md:hidden">
            {data.ledger.map((r) => (
              <div key={r.id} className="rounded-lg border border-border/50 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.user?.email ?? r.userId}</span>
                  <Badge variant="outline" className={TYPE_STYLE[r.type] ?? ""}>{r.type}</Badge>
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>{timeAgo(r.createdAt)}</span>
                  <span className={r.type === "CHARGE" || r.type === "ADJUST" ? "text-rose-400" : "text-emerald-400"}>
                    {r.type === "CHARGE" || r.type === "ADJUST" ? "−" : "+"}{fmtN(r.amount)} → {fmtN(r.balance)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {data.ledger.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No ledger entries match these filters.</p>}
        </CardContent>
      </Card>
      <Pagination page={page} total={data.total} limit={PAGE_SIZE} onPage={setPage} />

      <GrantDialog open={grantOpen} onClose={() => setGrantOpen(false)} onDone={() => { setGrantOpen(false); load(); }} />
    </div>
  );
}

function GrantDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [users, setUsers] = useState<UserLite[]>([]);
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get<{ users: UserLite[] }>("/api/v1/admin/users?limit=100").then((d) => setUsers(d.users)).catch(() => {});
  }, [open]);

  async function submit() {
    if (!userId) return;
    setBusy(true);
    try {
      const amt = Number(amount);
      const res = await api.post<{ balance: number }>("/api/v1/admin/credits", { userId, direction: "grant", amount: amt });
      toast.success(`Granted ${amt} credits — new balance ${res.balance}`);
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const selected = users.find((u) => u.id === userId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Grant credits</DialogTitle>
          <DialogDescription>Pick a user and add credits to their balance instantly.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5 py-1">
          <div className="space-y-1.5">
            <Label>User</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger><SelectValue placeholder="Select user…" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.email} ({fmtN(u.credits)})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && <p className="text-xs text-muted-foreground">Current balance: {fmtN(selected.credits)} credits</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="grant-amount">Amount</Label>
            <Input id="grant-amount" type="number" min="0.5" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !userId}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Grant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
