"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "./common";
import { VoiceProviderCard } from "./VoiceProviderCard";
import { api, toastError, ApiError } from "@/components/spa/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Copy, KeyRound, Loader2, Save, Trash2, ShieldCheck, Bot, Wallet, SlidersHorizontal, Clapperboard, Users } from "lucide-react";

type Config = {
  oauth: { configured: boolean; source: string | null };
  apiKey: { configured: boolean };
  redirectUri: string;
  scopes: string[];
};

type Tunables = {
  temperature: number;
  supportTemperature: number;
  maxTokens: number;
  timeoutMs: number;
  defaults?: { temperature: number; supportTemperature: number; maxTokens: number; timeoutMs: number };
};

type AiConfig = {
  zai?: { builtIn: boolean; available: boolean };
  gemini: { configured: boolean; source: string | null; model?: string; poolSize?: number; poolKeys?: string[] };
  selfHosted?: boolean;
  tunables?: Tunables;
  veo?: { enabled: boolean; engine?: "veo3" | "omni" };
  help: { geminiKeyUrl: string };
};

const SCOPES_DETAIL = [
  { scope: "youtube.readonly", why: "Read channel stats, uploads and dashboard metrics" },
  { scope: "youtube.upload", why: "Publish approved Shorts to your channel" },
  { scope: "youtubepartner", why: "Advanced channel management (optional)" },
];

export function IntegrationsPanel() {
  const [config, setConfig] = useState<Config | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [poolText, setPoolText] = useState("");
  const [tunables, setTunables] = useState<Tunables | null>(null);
  const [veoEnabled, setVeoEnabled] = useState(false);
  const [veoEngine, setVeoEngine] = useState<"veo3" | "omni">("veo3");
  const [busy, setBusy] = useState(false);
  const [clearTarget, setClearTarget] = useState<"google" | "apiKey" | null>(null);

  const load = useCallback(() => {
    api.get<Config>("/api/v1/youtube/config").then(setConfig).catch(() => {});
    api.get<AiConfig>("/api/v1/admin/ai/config").then((c) => {
      setAiConfig(c);
      setGeminiModel(c.gemini.model && c.gemini.model !== "auto" ? c.gemini.model : "");
      if (c.tunables) setTunables(c.tunables);
      if (c.veo) {
        setVeoEnabled(c.veo.enabled);
        if (c.veo.engine) setVeoEngine(c.veo.engine);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => load(), [load]);

  async function save() {
    if (!clientId && !clientSecret && !apiKey) {
      toast.error("Enter at least one credential");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<Config>("/api/v1/youtube/config", {
        ...(clientId ? { googleClientId: clientId } : {}),
        ...(clientSecret ? { googleClientSecret: clientSecret } : {}),
        ...(apiKey ? { youtubeApiKey: apiKey } : {}),
      });
      setConfig(res);
      setClientId("");
      setClientSecret("");
      setApiKey("");
      toast.success("Credentials saved (secrets are AES-256-GCM encrypted at rest)");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!clearTarget) return;
    setBusy(true);
    try {
      await api.del(`/api/v1/youtube/config?key=${clearTarget}`);
      toast.success("Credentials cleared");
      setClearTarget(null);
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }

  async function saveGemini() {
    if (!geminiKey) {
      toast.error("Enter a Gemini API key (free: aistudio.google.com/apikey)");
      return;
    }
    setBusy(true);
    try {
      // Verify against the Gemini API first; only saved when the key actually works.
      const res = await api.put<{ valid: boolean; saved: boolean; message: string }>(
        "/api/v1/admin/ai/test",
        { apiKey: geminiKey }
      );
      if (res.saved) {
        setGeminiKey("");
        load();
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (e) {
      // Older/stale local builds may not ship POST/PUT /api/v1/admin/ai/test.
      // Fall back to the plain config save (exists in every release) so the key
      // still lands in the admin panel instead of failing with a 404.
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
        try {
          await api.post("/api/v1/admin/ai/config", { geminiApiKey: geminiKey });
          setGeminiKey("");
          load();
          toast.success("Gemini key saved (encrypted). Restart the local dev server once so the verify route compiles.");
        } catch (e2) {
          toastError(e2);
        }
      } else {
        toastError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  async function testGemini() {
    setBusy(true);
    try {
      const res = await api.post<{ valid: boolean; message: string }>("/api/v1/admin/ai/test", {});
      if (res.valid) toast.success(res.message);
      else toast.error(res.message);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function clearGemini() {
    setBusy(true);
    try {
      const res = await api.del<AiConfig>("/api/v1/admin/ai/config");
      setAiConfig((prev) => (prev ? { ...prev, gemini: { configured: res.gemini.configured, source: res.gemini.source } } : prev));
      toast.success("Stored Gemini key cleared");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveModel() {
    setBusy(true);
    try {
      const res = await api.post<{ gemini: { model: string } }>("/api/v1/admin/ai/config", { geminiModel: geminiModel.trim() });
      setAiConfig((prev) => (prev ? { ...prev, gemini: { ...prev.gemini, model: res.gemini.model } } : prev));
      toast.success(
        res.gemini.model === "auto"
          ? "Model override cleared — automatic chain (newest first)"
          : `Model set to ${res.gemini.model}`
      );
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveTunables(next?: Tunables, veo?: boolean, engine?: "veo3" | "omni") {
    const t = next ?? tunables;
    if (!t) return;
    setBusy(true);
    try {
      const res = await api.post<AiConfig>("/api/v1/admin/ai/config", {
        geminiTemperature: t.temperature,
        geminiSupportTemperature: t.supportTemperature,
        geminiMaxTokens: t.maxTokens,
        geminiTimeout: Math.round(t.timeoutMs / 1000),
        ...(veo !== undefined ? { veoEnabled: veo } : {}),
        ...(engine !== undefined ? { veoEngine: engine } : {}),
      });
      if (res.tunables) setTunables(res.tunables);
      if (res.veo) {
        setVeoEnabled(res.veo.enabled);
        if (res.veo.engine) setVeoEngine(res.veo.engine);
      }
      toast.success(veo !== undefined || engine !== undefined ? "Video engine updated" : "Gemini generation settings saved — live immediately");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveKeyPool() {
    setBusy(true);
    try {
      const res = await api.post<AiConfig>("/api/v1/admin/ai/config", { geminiKeyPool: poolText });
      setAiConfig((prev) => (prev ? { ...prev, gemini: { ...prev.gemini, poolSize: res.gemini.poolSize, poolKeys: res.gemini.poolKeys, configured: true } } : prev));
      setPoolText("");
      toast.success(
        res.gemini.poolSize && res.gemini.poolSize > 0
          ? `Account pool saved — ${res.gemini.poolSize} key(s) will rotate automatically`
          : "Account pool cleared"
      );
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function clearKeyPool() {
    setBusy(true);
    try {
      const res = await api.del<{ gemini: { poolSize: number; poolKeys: string[] } }>("/api/v1/admin/ai/config?key=pool");
      setAiConfig((prev) => (prev ? { ...prev, gemini: { ...prev.gemini, poolSize: res.gemini.poolSize, poolKeys: res.gemini.poolKeys } } : prev));
      toast.success("Account pool cleared");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  function resetTunables() {
    const d = tunables?.defaults;
    if (!d) return;
    const next: Tunables = { ...d };
    setTunables(next);
    void saveTunables(next);
  }

  if (!config) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  return (
    <div className="space-y-5">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-emerald-400" /> Google OAuth 2.0 client</span>
            <Badge variant="outline" className={config.oauth.configured ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}>
              {config.oauth.configured ? "configured" : "not configured"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Required for <span className="font-medium text-foreground">"Continue with Google" sign-in</span> and for users to connect{" "}
            <span className="font-medium text-foreground">real YouTube channels</span> with OAuth sign-in and live dashboards. Both features share this one client.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gclient">Client ID {config.oauth.configured && <span className="text-xs text-muted-foreground">(leave blank to keep)</span>}</Label>
              <Input id="gclient" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxxxxxx.apps.googleusercontent.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gsecret">Client secret {config.oauth.configured && <span className="text-xs text-muted-foreground">(leave blank to keep)</span>}</Label>
              <Input id="gsecret" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSPX-…" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Authorized redirect URI (add this in Google Cloud Console → Credentials)</Label>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copy(config.redirectUri)}>
                <Copy className="mr-1 h-3 w-3" /> Copy
              </Button>
            </div>
            <code className="block break-all rounded-lg border border-border/60 bg-accent/40 px-3 py-2 font-mono text-xs">{config.redirectUri}</code>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Sign-in redirect URI (also add it to the same OAuth client)</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => copy(`${window.location.origin}/api/v1/auth/google/callback`)}
              >
                <Copy className="mr-1 h-3 w-3" /> Copy
              </Button>
            </div>
            <code className="block break-all rounded-lg border border-border/60 bg-accent/40 px-3 py-2 font-mono text-xs">
              {window.location.origin}/api/v1/auth/google/callback
            </code>
            <p className="text-xs text-muted-foreground">
              Used by "Continue with Google" on the login page. Google may take a few minutes to accept a newly added redirect URI.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Requested scopes</Label>
            <div className="space-y-1">
              {SCOPES_DETAIL.map((s) => (
                <div key={s.scope} className="flex flex-col rounded-md bg-accent/30 px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between">
                  <code className="font-mono text-[11px] text-emerald-400">{s.scope}</code>
                  <span className="text-xs text-muted-foreground">{s.why}</span>
                </div>
              ))}
            </div>
          </div>
          {config.oauth.configured && (
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => setClearTarget("google")} disabled={busy}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear stored OAuth client
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-violet-400" /> YouTube Data API key</span>
            <Badge variant="outline" className={config.apiKey.configured ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}>
              {config.apiKey.configured ? "configured" : "not configured"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Optional. Enables <span className="font-medium text-foreground">@handle public-stats connections</span> without OAuth (read-only dashboards for any public channel).
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="ytkey">API key</Label>
            <Input id="ytkey" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="AIza…" />
          </div>
          {config.apiKey.configured && (
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => setClearTarget("apiKey")} disabled={busy}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear stored API key
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2"><Bot className="h-4 w-4 text-amber-400" /> AI provider — Gemini fallback</span>
              {aiConfig && (
                <Badge variant="outline" className={aiConfig.gemini.configured ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}>
                  {aiConfig.gemini.configured ? "configured" : "not configured"}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            {aiConfig?.zai && !aiConfig.zai.available && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-amber-400">
                Self-hosted mode — built-in z-ai provider is unavailable here. Add a free Gemini key below so ideas &amp; scripts work. Voice (Edge TTS), visuals (Pollinations) and search (DuckDuckGo/Google News) are already free and keyless.
              </p>
            )}
            <p><span className="font-medium text-foreground">z-ai SDK</span> is the built-in provider (sandbox only). Everywhere else, scripts/ideas and this support assistant run on <span className="font-medium text-foreground">Google Gemini</span> — get a <span className="font-medium text-emerald-400">free API key</span> at{" "}
              <a className="text-primary underline underline-offset-2" href={aiConfig?.help?.geminiKeyUrl ?? "https://aistudio.google.com/apikey"} target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> and save it here (this admin panel is the <span className="font-medium text-foreground">only</span> place keys are configured — no .env needed).
              Voiceovers use free Edge TTS and visuals use free Pollinations automatically.</p>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="Paste Gemini API key (AIza… or new AQ… format)"
                  autoComplete="off"
                />
              </div>
              <Button size="sm" onClick={() => void saveGemini()} disabled={busy || !geminiKey}>
                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Verify &amp; save
              </Button>
              {aiConfig?.gemini.configured && (
                <Button size="sm" variant="outline" onClick={() => void testGemini()} disabled={busy} title="Test the stored key against the Gemini API">
                  <Bot className="mr-1 h-3.5 w-3.5" /> Test
                </Button>
              )}
              {aiConfig?.gemini.configured && (
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => void clearGemini()} disabled={busy}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
                </Button>
              )}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="geminimodel" className="text-[11px] text-muted-foreground">
                  Model override (optional — leave empty for auto: gemini-flash-latest → gemini-2.5-flash → flash-lite → gemini-2.0-flash; auto-retries on 503)
                </Label>
                <Input
                  id="geminimodel"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  placeholder="auto"
                  autoComplete="off"
                  className="h-8 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" onClick={() => void saveModel()} disabled={busy} className="h-8">
                <Save className="mr-1 h-3.5 w-3.5" /> Save model
              </Button>
            </div>
          </CardContent>
        </Card>
        <VoiceProviderCard />
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm"><Wallet className="h-4 w-4 text-emerald-400" /> Payments</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <p><span className="font-medium text-foreground">Razorpay (₹ INR)</span> and <span className="font-medium text-foreground">PayPal ($ USD)</span> power real checkout with server-side verification. Configure both in the <span className="font-medium text-foreground">Payments</span> tab of this admin panel — free test keys are available instantly.</p>
          </CardContent>
        </Card>
      </div>

      {/* Gemini generation controls (backend API tuning) */}
      {tunables && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
              <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-sky-400" /> Gemini API controls — generation &amp; speed</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={resetTunables} disabled={busy} className="h-8">
                  Reset to defaults
                </Button>
                <Button size="sm" onClick={() => void saveTunables()} disabled={busy} className="h-8">
                  {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                  Save settings
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Script / idea creativity (temperature)</Label>
                  <span className="rounded-md bg-accent/50 px-2 py-0.5 font-mono text-xs text-foreground">{tunables.temperature.toFixed(2)}</span>
                </div>
                <Slider
                  value={[tunables.temperature]}
                  min={0}
                  max={2}
                  step={0.05}
                  onValueChange={([v]) => setTunables((t) => (t ? { ...t, temperature: v } : t))}
                  aria-label="Script generation temperature"
                />
                <p className="text-[11px] text-muted-foreground">Low = focused &amp; factual scripts. High = more creative hooks (can drift). Default 0.8.</p>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Support chat (temperature)</Label>
                  <span className="rounded-md bg-accent/50 px-2 py-0.5 font-mono text-xs text-foreground">{tunables.supportTemperature.toFixed(2)}</span>
                </div>
                <Slider
                  value={[tunables.supportTemperature]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={([v]) => setTunables((t) => (t ? { ...t, supportTemperature: v } : t))}
                  aria-label="Support chat temperature"
                />
                <p className="text-[11px] text-muted-foreground">Pilot assistant accuracy vs playfulness. Keep ≤ 0.6 for factual support. Default 0.5.</p>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Max output tokens</Label>
                  <span className="rounded-md bg-accent/50 px-2 py-0.5 font-mono text-xs text-foreground">{tunables.maxTokens}</span>
                </div>
                <Slider
                  value={[tunables.maxTokens]}
                  min={256}
                  max={16384}
                  step={256}
                  onValueChange={([v]) => setTunables((t) => (t ? { ...t, maxTokens: v } : t))}
                  aria-label="Maximum output tokens"
                />
                <p className="text-[11px] text-muted-foreground">Higher = longer scripts possible but slower. Default 4096. Long-video mode auto-raises this per request.</p>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Request timeout</Label>
                  <span className="rounded-md bg-accent/50 px-2 py-0.5 font-mono text-xs text-foreground">{Math.round(tunables.timeoutMs / 1000)}s</span>
                </div>
                <Slider
                  value={[Math.round(tunables.timeoutMs / 1000)]}
                  min={10}
                  max={120}
                  step={5}
                  onValueChange={([v]) => setTunables((t) => (t ? { ...t, timeoutMs: v * 1000 } : t))}
                  aria-label="Request timeout in seconds"
                />
                <p className="text-[11px] text-muted-foreground">Lower = fails over to the next model faster (feels snappier). Default 45s.</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-accent/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Clapperboard className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
                <div>
                  <p className="text-sm font-medium">Veo cinematic motion <span className="ml-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-violet-400">beta</span></p>
                  <p className="text-xs text-muted-foreground">
                    Render photo-motion with Google Veo (real AI video from each scene image — Flow-style realistic human movement). Needs a <span className="font-medium text-foreground">billing-enabled Gemini key</span>; every pooled account is used automatically (auto-falls back to cinematic zoom-pan if unavailable).
                  </p>
                </div>
              </div>
              <Switch
                checked={veoEnabled}
                onCheckedChange={(v) => {
                  setVeoEnabled(v);
                  void saveTunables(undefined, v);
                }}
                aria-label="Toggle Veo cinematic motion"
              />
            </div>
            {veoEnabled && (
              <div className="space-y-2.5 rounded-lg border border-border/60 bg-accent/20 p-3">
                <Label className="text-xs font-medium">Video engine mode</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    { id: "veo3" as const, title: "Veo 3 — Flow AI cinematic", desc: "Best realism: natural human motion, filmic camera. Slower per scene." },
                    { id: "omni" as const, title: "Omni Flash — fast mode", desc: "Fastest render pipeline: shorter clips, quicker polling. Great for bulk." },
                  ].map((m) => (
                    <button
                      key={m.id} type="button"
                      onClick={() => {
                        setVeoEngine(m.id);
                        void saveTunables(undefined, undefined, m.id);
                      }}
                      className={cn(
                        "rounded-lg border p-2.5 text-left transition-colors",
                        veoEngine === m.id ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/40"
                      )}
                    >
                      <p className="text-xs font-semibold">{m.title}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Gemini MULTI-ACCOUNT POOL — combine quotas from many Google accounts */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2"><Users className="h-4 w-4 text-emerald-400" /> Gemini account pool — multi-account credits</span>
            <Badge variant="outline" className={cn(
              (aiConfig?.gemini.poolSize ?? 0) > 0
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-400"
            )}>
              {(aiConfig?.gemini.poolSize ?? 0) > 0 ? `${aiConfig?.gemini.poolSize} account(s) pooled` : "pool empty"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste <span className="font-medium text-foreground">one API key per line</span> (e.g. 10 accounts x 50 credits = 500 pooled credits). Every AI call — scripts, Google voices, Veo video — rotates through the pool automatically: a key that runs out of quota is skipped for 10 minutes and the next account takes over. Keys are AES-256-GCM encrypted at rest.
          </p>
          {(aiConfig?.gemini.poolKeys?.length ?? 0) > 0 && (
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-accent/30 p-2">
              {aiConfig?.gemini.poolKeys?.map((k) => (
                <code key={k} className="block font-mono text-[11px] text-muted-foreground">{k}</code>
              ))}
            </div>
          )}
          <Textarea
            value={poolText}
            onChange={(e) => setPoolText(e.target.value)}
            placeholder={"AIzaSy…\nAIzaSy…\nAQ.abc123…"}
            className="min-h-24 font-mono text-xs"
            autoComplete="off"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveKeyPool()} disabled={busy || !poolText.trim()}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-1 h-3.5 w-3.5" />}
              Save pool
            </Button>
            {(aiConfig?.gemini.poolSize ?? 0) > 0 && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => void clearKeyPool()} disabled={busy}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear pool
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
          Save credentials
        </Button>
      </div>

      <AlertDialog open={Boolean(clearTarget)} onOpenChange={(o) => !o && setClearTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear stored credentials?</AlertDialogTitle>
            <AlertDialogDescription>Removes the credentials saved from this admin UI (the single source of truth for all API keys). Users who connected channels are not affected until tokens expire.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void clear()}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
