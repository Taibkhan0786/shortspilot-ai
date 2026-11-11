"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination, Spinner, fmtN, timeAgo } from "./common";
import { api, toastError } from "@/components/spa/api";
import { toast } from "sonner";
import {
  Search, Ban, CheckCircle2, Coins, KeyRound, Gauge, ShieldCheck, Trash2, Loader2, RefreshCw,
} from "lucide-react";

type AdminUser = {
  id: string; email: string; name: string; role: string; status: string; createdAt: string;
  credits: number;
  subscription?: { status: string; plan: { id: string; name: string; price: number } } | null;
  profile?: { monthlyLimit: number } | null;
  _count: { videos: number; ideas: number; channels: number };
};

type DialogState =
  | { mode: "credits"; user: AdminUser }
  | { mode: "password"; user: AdminUser }
  | { mode: "cap"; user: AdminUser }
  | null;

const PAGE_SIZE = 20;

export function UsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchText, setSearchText] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ users: AdminUser[]; total: number }>(`/api/v1/admin/users?q=${encodeURIComponent(searchText)}&page=${page}&limit=${PAGE_SIZE}`)
      .then((d) => {
        setUsers(d.users);
        setTotal(d.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [searchText, page]);

  useEffect(() => load(), [load]);

  function onSearch(v: string) {
    setSearchText(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setPage(1), 350);
  }

  async function patch(userId: string, data: Record<string, unknown>, successMsg: string) {
    setBusy(userId);
    try {
      await api.patch("/api/v1/admin/users", { userId, ...data });
      toast.success(successMsg);
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(deleteTarget.id);
    try {
      await api.del(`/api/v1/admin/users?userId=${deleteTarget.id}`);
      toast.success(`${deleteTarget.email} deleted`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={searchText} onChange={(e) => onSearch(e.target.value)} placeholder="Search email or name…" className="pl-8" aria-label="Search users" />
        </div>
        <Button variant="outline" size="sm" onClick={load} className="shrink-0">
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {loading && users.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden border-border/60 md:block">
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-3 py-3 font-medium">Plan</th>
                    <th className="px-3 py-3 font-medium text-right">Credits</th>
                    <th className="px-3 py-3 font-medium text-right">Videos</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-border/40 last:border-0">
                      <td className="max-w-56 px-4 py-3">
                        <p className="truncate font-medium">{u.email}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {u.name} · joined {timeAgo(u.createdAt)} · cap {u.profile?.monthlyLimit ?? 50}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {u.subscription ? (
                          <span className="font-medium">{u.subscription.plan.name}</span>
                        ) : (
                          <span className="text-muted-foreground">no plan</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{fmtN(u.credits)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{u._count.videos}</td>
                      <td className="px-3 py-3">
                        <Badge variant="outline" className={u.status === "ACTIVE" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-destructive/40 bg-destructive/10 text-destructive"}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          disabled={busy === u.id}
                          onClick={() => patch(u.id, { role: u.role === "ADMIN" ? "USER" : "ADMIN" }, `Role updated for ${u.email}`)}
                          title="Toggle role"
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent"
                        >
                          {u.role === "ADMIN" ? (
                            <>
                              <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
                              <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 text-violet-400">ADMIN</Badge>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">USER</span>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Adjust credits" onClick={() => setDialog({ mode: "credits", user: u })}>
                            <Coins className="h-3.5 w-3.5 text-violet-400" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Reset password" onClick={() => setDialog({ mode: "password", user: u })}>
                            <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Monthly spending cap" onClick={() => setDialog({ mode: "cap", user: u })}>
                            <Gauge className="h-3.5 w-3.5 text-sky-400" />
                          </Button>
                          <Button
                            size="icon" variant="ghost" className="h-8 w-8" title={u.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                            disabled={busy === u.id}
                            onClick={() => patch(u.id, { status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }, `${u.email} ${u.status === "ACTIVE" ? "suspended" : "re-activated"}`)}
                          >
                            {u.status === "ACTIVE"
                              ? <Ban className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                              : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" title="Delete user" onClick={() => setDeleteTarget(u)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive/70" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No users match this search.</p>}
            </CardContent>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {users.map((u) => (
              <Card key={u.id} className="border-border/60">
                <CardContent className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{u.email}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.name} · {u.subscription?.plan.name ?? "no plan"}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant="outline" className={u.status === "ACTIVE" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-destructive/40 bg-destructive/10 text-destructive"}>
                        {u.status}
                      </Badge>
                      <span className="text-xs font-medium tabular-nums">{fmtN(u.credits)} credits</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDialog({ mode: "credits", user: u })}>
                      <Coins className="mr-1 h-3 w-3" /> Credits
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDialog({ mode: "password", user: u })}>
                      <KeyRound className="mr-1 h-3 w-3" /> Password
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setDialog({ mode: "cap", user: u })}>
                      <Gauge className="mr-1 h-3 w-3" /> Cap
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy === u.id}
                      onClick={() => patch(u.id, { status: u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }, `${u.email} updated`)}>
                      {u.status === "ACTIVE" ? <Ban className="mr-1 h-3 w-3" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                      {u.status === "ACTIVE" ? "Suspend" : "Activate"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive" onClick={() => setDeleteTarget(u)}>
                      <Trash2 className="mr-1 h-3 w-3" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {users.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No users match this search.</p>}
          </div>

          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />
        </>
      )}

      {dialog && <UserDialog state={dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the user and all their channels, videos, scripts, credits and history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void remove()}>
              {busy === deleteTarget?.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1 h-4 w-4" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UserDialog({ state, onClose, onDone }: { state: NonNullable<DialogState>; onClose: () => void; onDone: () => void }) {
  const { mode, user } = state;
  const [amount, setAmount] = useState("50");
  const [direction, setDirection] = useState<"grant" | "deduct">("grant");
  const [description, setDescription] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [cap, setCap] = useState(String(user.profile?.monthlyLimit ?? 50));
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (mode === "credits") {
        const amt = Number(amount);
        if (!isFinite(amt) || amt <= 0) throw new Error("Enter a valid amount");
        await api.post("/api/v1/admin/credits", { userId: user.id, direction, amount: amt, description: description || undefined });
        toast.success(`${direction === "grant" ? "Granted" : "Deducted"} ${amt} credits ${direction === "grant" ? "to" : "from"} ${user.email}`);
      } else if (mode === "password") {
        if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
        await api.patch("/api/v1/admin/users", { userId: user.id, newPassword });
        toast.success(`Password reset for ${user.email}`);
      } else {
        const c = Number(cap);
        if (!isFinite(c) || c < 1) throw new Error("Cap must be at least 1");
        await api.patch("/api/v1/admin/users", { userId: user.id, monthlyLimit: c });
        toast.success(`Monthly cap set to ${c} for ${user.email}`);
      }
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    credits: `Adjust credits — ${user.email}`,
    password: `Reset password — ${user.email}`,
    cap: `Monthly spending cap — ${user.email}`,
  } as const;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{titles[mode]}</DialogTitle>
          <DialogDescription>
            {mode === "credits" && `Current balance: ${fmtN(user.credits)} credits. The user gets a notification and in-app toast.`}
            {mode === "password" && "Sets a new password immediately and notifies the user."}
            {mode === "cap" && "Caps how many credits the user can spend in a calendar month."}
          </DialogDescription>
        </DialogHeader>

        {mode === "credits" && (
          <div className="space-y-3.5 py-1">
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "grant" | "deduct")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="grant">Grant (add credits)</SelectItem>
                  <SelectItem value="deduct">Deduct (remove credits)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-amount">Amount</Label>
              <Input id="credit-amount" type="number" min="0.5" step="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="credit-desc">Description (optional)</Label>
              <Input id="credit-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Goodwill top-up" />
            </div>
          </div>
        )}

        {mode === "password" && (
          <div className="space-y-1.5 py-1">
            <Label htmlFor="new-password">New password (min 8 chars)</Label>
            <Input id="new-password" type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="at least 8 characters" />
          </div>
        )}

        {mode === "cap" && (
          <div className="space-y-1.5 py-1">
            <Label htmlFor="monthly-cap">Monthly credit cap</Label>
            <Input id="monthly-cap" type="number" min="1" value={cap} onChange={(e) => setCap(e.target.value)} />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {mode === "credits" ? "Apply" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
