"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { api, toastError } from "@/components/spa/api";
import { toast } from "sonner";
import { Mic, ShieldCheck, Trash2, Loader2 } from "lucide-react";

type VoiceProvider = "auto" | "elevenlabs" | "google" | "edge";
type VoiceCfg = {
  elevenlabs?: { configured: boolean; source?: string | null };
  gemini: { configured: boolean };
  voiceProvider?: VoiceProvider;
};

const PROVIDERS: { value: VoiceProvider; label: string; hint: string }[] = [
  { value: "auto", label: "Auto (recommended)", hint: "ElevenLabs → Google AI Studio → free Edge → fallback" },
  { value: "elevenlabs", label: "ElevenLabs first", hint: "Most natural voices on every voice — needs an ElevenLabs key" },
  { value: "google", label: "Google AI Studio first", hint: "Original Google voices (Gemini TTS) on every voice — needs a Gemini key in the pool" },
  { value: "edge", label: "Free Edge only", hint: "No keys needed — robotic-ish neural voices, zero cost" },
];

/** Voice provider keys + which provider speaks FIRST for voiceovers. */
export function VoiceProviderCard() {
  const [cfg, setCfg] = useState<VoiceCfg | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<VoiceProvider>("auto");

  const load = useCallback(() => {
    api.get<VoiceCfg>("/api/v1/admin/ai/config").then((c) => {
      setCfg(c);
      if (c.voiceProvider) setProvider(c.voiceProvider);
    }).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  async function save() {
    if (!key.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/v1/admin/ai/config", { elevenlabsApiKey: key.trim() });
      setKey("");
      load();
      toast.success("ElevenLabs key saved (encrypted). New voiceovers will use it.");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function changeProvider(next: VoiceProvider) {
    const prev = provider;
    setProvider(next);
    setBusy(true);
    try {
      await api.post("/api/v1/admin/ai/config", { voiceProvider: next });
      load();
      toast.success(`Voice provider: ${PROVIDERS.find((p) => p.value === next)?.label} — live immediately`);
    } catch (e) {
      setProvider(prev);
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await api.del("/api/v1/admin/ai/config?key=elevenlabs");
      load();
      toast.success("ElevenLabs key cleared");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  const el = Boolean(cfg?.elevenlabs?.configured);
  const gem = Boolean(cfg?.gemini?.configured);
  const activeLabel =
    provider === "elevenlabs" ? (el ? "ElevenLabs" : "ElevenLabs (key missing — will fall back)") :
    provider === "google" ? (gem ? "Google AI Studio" : "Google (key missing — will fall back)") :
    provider === "edge" ? "Free Edge" :
    el ? "Auto — ElevenLabs" : gem ? "Auto — Google AI Studio" : "Auto — free Edge";
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><Mic className="h-4 w-4 text-sky-400" /> Voice provider — natural voices</span>
          <Badge variant="outline" className={el || gem ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}>
            {activeLabel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-xs text-muted-foreground">
        <div className="space-y-1.5">
          <Label className="text-[11px] font-medium text-foreground">Which voice engine speaks first?</Label>
          <Select value={provider} onValueChange={(v) => void changeProvider(v as VoiceProvider)} disabled={busy}>
            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  <span className="flex flex-col">
                    <span className="text-xs font-medium text-foreground">{p.label}</span>
                    <span className="text-[10px] text-muted-foreground">{p.hint}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p>
            Original Google voices (Kore, Puck, Charon…) are in the <span className="font-medium text-foreground">Voice Library</span> with a
            &ldquo;Google&rdquo; tag — they speak through your Gemini keys (Google AI Studio). Hindi narration is supported on ElevenLabs and Google voices.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] font-medium text-foreground">
            ElevenLabs API key{" "}
            {el && (
              <span className="text-emerald-400">
                (saved{cfg?.elevenlabs?.source === "env" ? " via .env — paste here to override" : ""})
              </span>
            )}
          </Label>
          <div className="flex items-end gap-2">
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste ElevenLabs API key (sk_…)" autoComplete="off" className="flex-1" />
            <Button size="sm" onClick={() => void save()} disabled={busy || !key.trim()}>
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1 h-3.5 w-3.5" />} Save
            </Button>
            {el && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => void clear()} disabled={busy}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>
          <p>
            Get a free key at{" "}
            <a className="text-primary underline underline-offset-2" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">elevenlabs.io → API keys</a>
            {" "}· Gemini keys go in the <span className="font-medium text-foreground">Gemini account pool</span> above.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
