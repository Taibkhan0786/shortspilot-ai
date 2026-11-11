"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { SectionHeader, Spinner } from "./common";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Bot, Loader2, Play, Pause, Zap } from "lucide-react";

type Rule = {
  enabled: boolean; mode: string; scheduleDays: string; scheduleTime: string; timezone: string;
  dailyLimit: number; weeklyLimit: number; approvalRequired: boolean; budgetLimit: number;
  niche: string; lastRunAt?: string | null; running?: boolean;
};

const DAYS = [
  { v: "1", l: "Mon" }, { v: "2", l: "Tue" }, { v: "3", l: "Wed" }, { v: "4", l: "Thu" },
  { v: "5", l: "Fri" }, { v: "6", l: "Sat" }, { v: "0", l: "Sun" },
];

export function Automation() {
  const [rule, setRule] = useState<Rule | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Rule>("/api/v1/automation")
      .then(setRule)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  async function save(patch: Partial<Rule>) {
    if (!rule) return;
    setBusy("save");
    try {
      const updated = await api.patch<Rule>("/api/v1/automation", patch);
      setRule(updated);
      toast.success("Automation settings saved");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy("run");
    try {
      await api.post("/api/v1/automation/run-now");
      toast.success("Automation run started — idea → script → voice → visuals → render. Watch your Video Library!");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;
  if (!rule) return null;

  const days = rule.scheduleDays.split(",").filter(Boolean);

  return (
    <div>
      <SectionHeader
        title="Automation"
        description="Let ShortsPilot run the whole pipeline on your schedule."
        actions={
          <Button variant="outline" onClick={runNow} disabled={busy === "run" || rule.running}>
            {busy === "run" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            Run once now
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-border/60 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-primary" /> Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
              <div>
                <p className="text-sm font-medium">Automation {rule.enabled ? "enabled" : "disabled"}</p>
                <p className="text-xs text-muted-foreground">
                  {rule.enabled ? "Runs automatically at the scheduled times below." : "Turn on to enable scheduled runs."}
                </p>
              </div>
              <Switch
                checked={rule.enabled}
                onCheckedChange={(v) => save({ enabled: v })}
                disabled={busy === "save"}
                aria-label="Toggle automation"
              />
            </div>

            <div className="space-y-2">
              <Label>Publishing mode</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { id: "manual", t: "Manual", d: "Generate & download only" },
                  { id: "approval", t: "Approval", d: "Wait for my approval" },
                  { id: "automatic", t: "Automatic", d: "Publish to YouTube directly" },
                ].map((m) => (
                  <button
                    key={m.id} type="button" onClick={() => save({ mode: m.id })}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      rule.mode === m.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                    )}
                  >
                    <div className="text-sm font-medium">{m.t}</div>
                    <div className="text-xs text-muted-foreground">{m.d}</div>
                  </button>
                ))}
              </div>
              {rule.mode === "automatic" && (
                <p className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-400">
                  Automatic mode uploads without review. Quality checks still gate publishing.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Publish time</Label>
                <Input type="time" value={rule.scheduleTime} onChange={(e) => setRule({ ...rule, scheduleTime: e.target.value })} onBlur={() => save({ scheduleTime: rule.scheduleTime })} />
              </div>
              <div className="space-y-2">
                <Label>Niche for automation</Label>
                <Input value={rule.niche} onChange={(e) => setRule({ ...rule, niche: e.target.value })} onBlur={() => save({ niche: rule.niche })} placeholder="Uses your profile niche if empty" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Active days</Label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d) => {
                  const active = days.includes(d.v);
                  return (
                    <button
                      key={d.v} type="button"
                      onClick={() => save({ scheduleDays: active ? days.filter((x) => x !== d.v).join(",") : [...days, d.v].sort().join(",") })}
                      className={cn(
                        "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                        active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {d.l}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/60">
            <CardHeader><CardTitle className="text-base">Limits</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><Label>Daily limit</Label><span>{rule.dailyLimit}/day</span></div>
                <Slider value={[rule.dailyLimit]} min={1} max={10} step={1} onValueChange={([v]) => setRule({ ...rule, dailyLimit: v })} onValueCommit={(v) => save({ dailyLimit: v[0] })} />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><Label>Weekly limit</Label><span>{rule.weeklyLimit}/week</span></div>
                <Slider value={[rule.weeklyLimit]} min={1} max={50} step={1} onValueChange={([v]) => setRule({ ...rule, weeklyLimit: v })} onValueCommit={(v) => save({ weeklyLimit: v[0] })} />
              </div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm"><Label>Budget limit</Label><span>{rule.budgetLimit} credits/mo</span></div>
                <Slider value={[rule.budgetLimit]} min={10} max={1000} step={10} onValueChange={([v]) => setRule({ ...rule, budgetLimit: v })} onValueCommit={(v) => save({ budgetLimit: v[0] })} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Enabled</span><span>{rule.enabled ? "Yes" : "No"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Mode</span><span className="capitalize">{rule.mode}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Last run</span><span>{rule.lastRunAt ? new Date(rule.lastRunAt).toLocaleString() : "Never"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Running now</span><span>{rule.running ? "Yes" : "No"}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
