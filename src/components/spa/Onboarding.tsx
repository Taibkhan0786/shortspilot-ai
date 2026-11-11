"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { Loader2, ArrowRight, ArrowLeft, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

const NICHES = [
  "Space & Science", "History Facts", "Tech & AI", "Finance & Investing",
  "Health & Fitness", "Psychology", "Nature & Wildlife", "Motivation",
  "Food & Cooking", "Travel", "Gaming", "DIY & Crafts",
];
const LANGUAGES = ["English", "Hindi", "Spanish", "Portuguese", "German", "French", "Arabic", "Indonesian"];
const STYLES = [
  { id: "educational", label: "Educational", desc: "Teach something fast" },
  { id: "storytelling", label: "Storytelling", desc: "Narrative arcs" },
  { id: "commentary", label: "Commentary", desc: "Opinions & analysis" },
  { id: "entertainment", label: "Entertainment", desc: "Fun & light" },
];
const VISUALS = [
  { id: "cinematic", label: "Cinematic", desc: "Dramatic, film-like" },
  { id: "cartoon", label: "Cartoon", desc: "Colorful & playful" },
  { id: "realistic", label: "Realistic", desc: "Photoreal" },
  { id: "minimalist", label: "Minimalist", desc: "Clean flat design" },
];
const DAYS = [
  { v: "1", l: "Mon" }, { v: "2", l: "Tue" }, { v: "3", l: "Wed" }, { v: "4", l: "Thu" },
  { v: "5", l: "Fri" }, { v: "6", l: "Sat" }, { v: "0", l: "Sun" },
];

export function Onboarding() {
  const { user, setSession, setProfile, setView } = useApp();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    niche: "Space & Science", audience: "curious adults", language: "English",
    scriptStyle: "educational", voiceId: "tongtong", voiceSpeed: 1.0,
    visualStyle: "cinematic", duration: 45, videosPerWeek: 3,
    publishDays: "1,2,3,4,5", publishTime: "18:00", approvalMode: "approval",
    monthlyLimit: 50,
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setLoading(true);
    try {
      const profile = await api.patch("/api/v1/onboarding", { ...form, onboarded: true });
      setProfile(profile as never);
      await api.patch("/api/v1/automation", {
        enabled: false, mode: form.approvalMode, scheduleDays: form.publishDays,
        scheduleTime: form.publishTime, budgetLimit: form.monthlyLimit, niche: form.niche,
      });
      const me = await api.get("/api/v1/auth/me");
      setSession(me as never);
      toast.success("Preferences saved — let's make your first Short!");
      setView("dashboard");
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-violet-600">
              <Rocket className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold">Channel setup</span>
          </div>
          <div className="text-sm text-muted-foreground">Step {step} of 3</div>
        </div>
        <div className="mb-8 flex gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className={cn("h-1.5 flex-1 rounded-full", s <= step ? "bg-primary" : "bg-muted")} />
          ))}
        </div>

        <Card className="border-border/60">
          <CardContent className="p-6">
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">What&apos;s your channel about?</h2>
                  <p className="text-sm text-muted-foreground">This drives idea research and script writing.</p>
                </div>
                <div className="space-y-2">
                  <Label>Niche</Label>
                  <div className="flex flex-wrap gap-2">
                    {NICHES.map((n) => (
                      <button
                        key={n} type="button" onClick={() => set("niche", n)}
                        className={cn(
                          "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                          form.niche === n ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <Input className="mt-2" value={form.niche} onChange={(e) => set("niche", e.target.value)} placeholder="or type a custom niche" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="audience">Target audience</Label>
                    <Input id="audience" value={form.audience} onChange={(e) => set("audience", e.target.value)} placeholder="e.g. curious adults" />
                  </div>
                  <div className="space-y-2">
                    <Label>Content language</Label>
                    <Select value={form.language} onValueChange={(v) => set("language", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Script style</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {STYLES.map((s) => (
                      <button
                        key={s.id} type="button" onClick={() => set("scriptStyle", s.id)}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          form.scriptStyle === s.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                        )}
                      >
                        <div className="text-sm font-medium">{s.label}</div>
                        <div className="text-xs text-muted-foreground">{s.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">Voice & visuals</h2>
                  <p className="text-sm text-muted-foreground">How your Shorts sound and look.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Narration voice</Label>
                    <Select value={form.voiceId} onValueChange={(v) => set("voiceId", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="g-kore">Google Kore — firm &amp; confident</SelectItem>
                        <SelectItem value="g-puck">Google Puck — upbeat &amp; energetic</SelectItem>
                        <SelectItem value="g-charon">Google Charon — deep &amp; informative</SelectItem>
                        <SelectItem value="g-leda">Google Leda — youthful &amp; warm</SelectItem>
                        <SelectItem value="g-zephyr">Google Zephyr — bright &amp; airy</SelectItem>
                        <SelectItem value="g-fenrir">Google Fenrir — excitable &amp; bold</SelectItem>
                        <SelectItem value="g-aoede">Google Aoede — breezy &amp; light</SelectItem>
                        <SelectItem value="g-orus">Google Orus — authoritative</SelectItem>
                        <SelectItem value="tongtong">Tongtong — warm &amp; friendly</SelectItem>
                        <SelectItem value="chuichui">Chuichui — lively</SelectItem>
                        <SelectItem value="xiaochen">Xiaochen — professional</SelectItem>
                        <SelectItem value="jam">Jam — British</SelectItem>
                        <SelectItem value="kazi">Kazi — clear</SelectItem>
                        <SelectItem value="douji">Douji — smooth</SelectItem>
                        <SelectItem value="luodo">Luodo — expressive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Visual style</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {VISUALS.map((s) => (
                        <button
                          key={s.id} type="button" onClick={() => set("visualStyle", s.id)}
                          className={cn(
                            "rounded-lg border p-2.5 text-left transition-colors",
                            form.visualStyle === s.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                          )}
                        >
                          <div className="text-xs font-medium">{s.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Voice speed</Label>
                    <span className="text-sm text-muted-foreground">{form.voiceSpeed.toFixed(1)}×</span>
                  </div>
                  <Slider value={[form.voiceSpeed]} min={0.5} max={2} step={0.1} onValueChange={([v]) => set("voiceSpeed", v)} />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Default Short duration</Label>
                    <span className="text-sm text-muted-foreground">{form.duration}s</span>
                  </div>
                  <Slider value={[form.duration]} min={15} max={90} step={5} onValueChange={([v]) => set("duration", v)} />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">Publishing & control</h2>
                  <p className="text-sm text-muted-foreground">Schedule, approval mode and spending guardrails.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Publish time</Label>
                    <Input type="time" value={form.publishTime} onChange={(e) => set("publishTime", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Videos per week</Label>
                    <Input type="number" min={1} max={21} value={form.videosPerWeek} onChange={(e) => set("videosPerWeek", parseInt(e.target.value) || 3)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Publishing days</Label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((d) => {
                      const days = form.publishDays.split(",").filter(Boolean);
                      const active = days.includes(d.v);
                      return (
                        <button
                          key={d.v} type="button"
                          onClick={() => set("publishDays", active ? days.filter((x) => x !== d.v).join(",") : [...days, d.v].sort().join(","))}
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
                <div className="space-y-2">
                  <Label>Approval mode</Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {[
                      { id: "manual", t: "Manual", d: "I download and upload myself" },
                      { id: "approval", t: "Approval", d: "I approve before upload" },
                      { id: "automatic", t: "Automatic", d: "Publish straight to YouTube" },
                    ].map((m) => (
                      <button
                        key={m.id} type="button" onClick={() => set("approvalMode", m.id)}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          form.approvalMode === m.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/40"
                        )}
                      >
                        <div className="text-sm font-medium">{m.t}</div>
                        <div className="text-xs text-muted-foreground">{m.d}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Monthly credit cap</Label>
                    <span className="text-sm text-muted-foreground">{form.monthlyLimit} credits</span>
                  </div>
                  <Slider value={[form.monthlyLimit]} min={10} max={500} step={10} onValueChange={([v]) => set("monthlyLimit", v)} />
                  <p className="text-xs text-muted-foreground">A typical Short uses ~10-15 credits (script, voice, visuals, render).</p>
                </div>
              </div>
            )}

            <div className="mt-8 flex items-center justify-between">
              <Button variant="ghost" onClick={() => (step === 1 ? setView("dashboard") : setStep(step - 1))}>
                <ArrowLeft className="mr-2 h-4 w-4" /> {step === 1 ? "Skip for now" : "Back"}
              </Button>
              {step < 3 ? (
                <Button onClick={() => setStep(step + 1)}>Continue <ArrowRight className="ml-2 h-4 w-4" /></Button>
              ) : (
                <Button onClick={save} disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Finish setup
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-xs text-muted-foreground">Signed in as {user?.email} — you can change everything later in Settings.</p>
      </div>
    </div>
  );
}
