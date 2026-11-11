"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "./common";
import { api, toastError } from "@/components/spa/api";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2, RefreshCw } from "lucide-react";

type Plan = {
  id: string; name: string; price: number; shortsLimit: number; channelsLimit: number;
  watermark: boolean; features: string[]; order: number; subscribers: number;
};

type Draft = Omit<Plan, "features" | "subscribers"> & { featuresText: string };

function toDraft(p: Plan): Draft {
  return { ...p, featuresText: p.features.join("\n") };
}

export function PlansPanel() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ plans: Plan[] }>("/api/v1/admin/plans")
      .then((d) => {
        setPlans(d.plans);
        setDrafts(Object.fromEntries(d.plans.map((p) => [p.id, toDraft(p)])));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  function setDraft(id: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function save(planId: string) {
    const d = drafts[planId];
    setSaving(planId);
    try {
      const features = d.featuresText.split("\n").map((s) => s.trim()).filter(Boolean);
      await api.patch("/api/v1/admin/plans", {
        id: planId,
        name: d.name,
        price: Number(d.price),
        shortsLimit: Math.round(Number(d.shortsLimit)),
        channelsLimit: Math.round(Number(d.channelsLimit)),
        watermark: d.watermark,
        order: Math.round(Number(d.order)),
        features,
      });
      toast.success(`"${d.name}" pricing updated — live on the pricing page instantly`);
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setSaving(deleteTarget.id);
    try {
      await api.del(`/api/v1/admin/plans?id=${deleteTarget.id}`);
      toast.success(`Plan "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Edits go live instantly on the public pricing page & checkout. {plans.length} plans.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh</Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" /> New plan</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => {
          const d = drafts[p.id];
          if (!d) return null;
          const dirty = JSON.stringify({ name: d.name, price: Number(d.price), shortsLimit: Math.round(Number(d.shortsLimit)), channelsLimit: Math.round(Number(d.channelsLimit)), watermark: d.watermark, order: Math.round(Number(d.order)), features: d.featuresText.split("\n").map((s) => s.trim()).filter(Boolean) }) !== JSON.stringify({ name: p.name, price: p.price, shortsLimit: p.shortsLimit, channelsLimit: p.channelsLimit, watermark: p.watermark, order: p.order, features: p.features });
          return (
            <Card key={p.id} className={dirty ? "border-amber-500/40" : "border-border/60"}>
              <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {p.name}
                  <Badge variant="outline" className="font-mono text-[10px]">{p.id}</Badge>
                </CardTitle>
                <Badge variant="outline" className={p.subscribers > 0 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : ""}>
                  {p.subscribers} subscriber{p.subscribers === 1 ? "" : "s"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`name-${p.id}`} className="text-xs">Name</Label>
                    <Input id={`name-${p.id}`} className="h-8" value={d.name} onChange={(e) => setDraft(p.id, { name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`price-${p.id}`} className="text-xs">Price / month ($)</Label>
                    <Input id={`price-${p.id}`} className="h-8" type="number" min="0" step="1" value={d.price} onChange={(e) => setDraft(p.id, { price: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`shorts-${p.id}`} className="text-xs">Shorts / month</Label>
                    <Input id={`shorts-${p.id}`} className="h-8" type="number" min="1" value={d.shortsLimit} onChange={(e) => setDraft(p.id, { shortsLimit: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`channels-${p.id}`} className="text-xs">Channels</Label>
                    <Input id={`channels-${p.id}`} className="h-8" type="number" min="1" value={d.channelsLimit} onChange={(e) => setDraft(p.id, { channelsLimit: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`order-${p.id}`} className="text-xs">Display order</Label>
                    <Input id={`order-${p.id}`} className="h-8" type="number" min="0" value={d.order} onChange={(e) => setDraft(p.id, { order: Number(e.target.value) })} />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Switch checked={d.watermark} aria-label="Watermark" onCheckedChange={(v) => setDraft(p.id, { watermark: v })} />
                      <span className="text-xs text-muted-foreground">Watermark previews</span>
                    </label>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`features-${p.id}`} className="text-xs">Features (one per line)</Label>
                  <Textarea id={`features-${p.id}`} className="min-h-20 text-xs" value={d.featuresText} onChange={(e) => setDraft(p.id, { featuresText: e.target.value })} />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <Button variant="ghost" size="sm" className="h-8 text-xs text-destructive" onClick={() => setDeleteTarget(p)} disabled={p.subscribers > 0} title={p.subscribers > 0 ? "Reassign subscribers first" : undefined}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </Button>
                  <Button size="sm" className="h-8 text-xs" disabled={!dirty || saving === p.id} onClick={() => void save(p.id)}>
                    {saving === p.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                    Save changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <CreatePlanDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete plan "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>The plan disappears from the pricing page immediately. Only plans with zero subscribers can be deleted.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void remove()}>
              {saving === deleteTarget?.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreatePlanDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("19");
  const [shortsLimit, setShortsLimit] = useState("60");
  const [channelsLimit, setChannelsLimit] = useState("2");
  const [featuresText, setFeaturesText] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await api.post("/api/v1/admin/plans", {
        name,
        price: Number(price),
        shortsLimit: Math.round(Number(shortsLimit)),
        channelsLimit: Math.round(Number(channelsLimit)),
        features: featuresText.split("\n").map((s) => s.trim()).filter(Boolean),
      });
      toast.success(`Plan "${name}" created`);
      onCreated();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Create pricing plan</DialogTitle>
          <DialogDescription>The plan id is generated from the name (lowercase slug). It appears on the pricing page right away.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">Plan name</Label>
            <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Business" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="np-price">Price ($)</Label>
              <Input id="np-price" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-shorts">Shorts/mo</Label>
              <Input id="np-shorts" type="number" min="1" value={shortsLimit} onChange={(e) => setShortsLimit(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-ch">Channels</Label>
              <Input id="np-ch" type="number" min="1" value={channelsLimit} onChange={(e) => setChannelsLimit(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-features">Features (one per line)</Label>
            <Textarea id="np-features" className="min-h-20 text-xs" value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} placeholder={"60 Shorts / month\n2 channels\nPriority support"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy || name.trim().length < 2}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
