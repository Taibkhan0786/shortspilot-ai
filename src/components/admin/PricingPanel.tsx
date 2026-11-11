"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "./common";
import { api, toastError } from "@/components/spa/api";
import { toast } from "sonner";
import { Loader2, Save, RotateCcw, SlidersHorizontal } from "lucide-react";

type Operation = string;
type PricingData = {
  defaults: Record<Operation, number>;
  costs: Record<Operation, number>;
  overrides: Partial<Record<Operation, number>>;
  operations: Operation[];
};

const LABELS: Record<string, string> = {
  idea: "Content ideas (per batch item)",
  research: "Web research (per query)",
  script: "Script generation",
  script_regenerate: "Script regeneration",
  metadata: "Title/description/hashtags",
  voiceover: "Voiceover (per Short)",
  visual_per_scene: "Scene visual (per image)",
  render: "Video render",
  publish: "YouTube publish",
};

export function PricingPanel() {
  const [data, setData] = useState<PricingData | null>(null);
  const [draft, setDraft] = useState<Record<Operation, number>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<PricingData>("/api/v1/admin/settings")
      .then((d) => {
        setData(d);
        setDraft(d.costs);
      })
      .catch(() => {});
  }, []);

  useEffect(() => load(), [load]);

  async function save() {
    setBusy(true);
    try {
      const res = await api.put<{ costs: Record<Operation, number> }>("/api/v1/admin/settings", { costs: draft });
      setData((d) => (d ? { ...d, costs: res.costs, overrides: draft } : d));
      toast.success("AI pricing saved — all new jobs are charged at the new rates");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const res = await api.put<{ costs: Record<Operation, number> }>("/api/v1/admin/settings", { costs: {}, reset: true });
      setData((d) => (d ? { ...d, costs: res.costs, overrides: {} } : d));
      setDraft(res.costs);
      toast.success("Pricing reset to defaults");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.costs);
  const hasOverrides = Object.keys(data.overrides).length > 0;

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-violet-400" /> Credit cost per AI operation
          </CardTitle>
          {hasOverrides && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-400">custom pricing active</Badge>}
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Operation</th>
                <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">Default</th>
                <th className="px-3 py-2.5 text-right font-medium">Effective</th>
                <th className="px-4 py-2.5 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {data.operations.map((op) => {
                const overridden = typeof data.overrides[op] === "number";
                return (
                  <tr key={op} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{LABELS[op] ?? op}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{op}</p>
                    </td>
                    <td className="hidden px-3 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">{data.defaults[op]}</td>
                    <td className="px-3 py-3 text-right">
                      <span className={`font-bold tabular-nums ${overridden ? "text-amber-400" : ""}`}>{data.costs[op]}</span>
                      {overridden && <span className="ml-1 text-[10px] text-amber-400">edited</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <Input
                          type="number"
                          min="0"
                          max="1000"
                          step="0.5"
                          className="h-8 w-24 text-right"
                          aria-label={`Cost for ${op}`}
                          value={draft[op] ?? data.costs[op]}
                          onChange={(e) => setDraft((d) => ({ ...d, [op]: Number(e.target.value) }))}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Changes apply instantly to new AI jobs. In-flight jobs keep the price they were charged at.</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void reset()} disabled={busy || !hasOverrides}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset to defaults
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
            Save pricing
          </Button>
        </div>
      </div>
    </div>
  );
}
