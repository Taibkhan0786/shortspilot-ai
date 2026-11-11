"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api, toastError } from "@/components/spa/api";
import { toast } from "sonner";
import { Mic, ShieldCheck, Trash2 } from "lucide-react";

type VoiceCfg = { elevenlabs?: { configured: boolean }; gemini: { configured: boolean } };

/** Voice provider keys. Order used by the app: ElevenLabs → Gemini TTS → Edge → Google Translate. */
export function VoiceProviderCard() {
  const [cfg, setCfg] = useState<VoiceCfg | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<VoiceCfg>("/api/v1/admin/ai/config").then(setCfg).catch(() => {});
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
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><Mic className="h-4 w-4 text-sky-400" /> Voice provider — natural voices</span>
          <Badge variant="outline" className={el ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-400"}>
            {el ? "ElevenLabs on" : cfg?.gemini.configured ? "Gemini TTS" : "robotic fallback"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs text-muted-foreground">
        <p>
          Voiceover tries, in order: <span className="font-medium text-foreground">ElevenLabs</span> (key below, most natural, Hindi supported) →{" "}
          <span className="font-medium text-foreground">Gemini TTS</span> (uses your Gemini key above) → Edge TTS → Google Translate voice (robotic).
          Get an ElevenLabs key at{" "}
          <a className="text-primary underline underline-offset-2" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">elevenlabs.io → API keys</a>.
        </p>
        <div className="flex items-end gap-2">
          <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste ElevenLabs API key (sk_…)" autoComplete="off" className="flex-1" />
          <Button size="sm" onClick={() => void save()} disabled={busy || !key.trim()}>
            <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Save
          </Button>
          {el && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => void clear()} disabled={busy}>
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
