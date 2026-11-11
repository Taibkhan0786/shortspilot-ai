"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { EmptyState, SectionHeader, Spinner, formatDuration } from "./common";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { Mic, Loader2, Play } from "lucide-react";

type Voice = { id: string; name: string; description: string; accent: string; gender: string };
type Voiceover = {
  id: string; audioUrl: string; duration: number; voiceId: string; speed: number; status: string; createdAt: string;
  script: { topic: string; language: string };
  sceneAudio: { sceneNumber: number; url: string; duration: number }[];
};

export function VoiceLibrary() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceovers, setVoiceovers] = useState<Voiceover[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewVoice, setPreviewVoice] = useState<string>("tongtong");
  const [previewText, setPreviewText] = useState("This is what your Shorts narration could sound like with this voice.");
  const [speed, setSpeed] = useState(1.0);
  const [previewing, setPreviewing] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<{ voices: Voice[] }>("/api/v1/voices"),
      api.get<{ voiceovers: Voiceover[] }>("/api/v1/voiceovers?limit=30"),
    ])
      .then(([v, vo]) => {
        setVoices(v.voices);
        setVoiceovers(vo.voiceovers);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  async function preview(voiceId: string) {
    setPreviewing(voiceId);
    try {
      const d = await api.post<{ audioUrl: string }>("/api/v1/voice/preview", {
        text: previewText, voice: voiceId, speed,
      });
      new Audio(d.audioUrl).play();
    } catch (e) {
      toastError(e);
    } finally {
      setPreviewing(null);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  return (
    <div>
      <SectionHeader title="Voice Library" description="Preview AI voices and manage generated voiceovers." />

      <div className="mb-6 rounded-xl border border-border/60 bg-card/40 p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_200px_200px]">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Preview text</label>
            <Input value={previewText} onChange={(e) => setPreviewText(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Voice</label>
            <Select value={previewVoice} onValueChange={setPreviewVoice}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {voices.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Speed: {speed.toFixed(1)}×</label>
            <Slider value={[speed]} min={0.5} max={2} step={0.1} onValueChange={([v]) => setSpeed(v)} />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {voices.map((v) => (
          <Card key={v.id} className={`border-border/60 ${previewVoice === v.id ? "border-primary/50" : ""}`}>
            <CardContent className="flex items-center gap-3 p-4">
              <button
                onClick={() => preview(v.id)}
                aria-label={`Preview ${v.name}`}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary transition-transform hover:scale-105"
              >
                {previewing === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </button>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{v.name}</div>
                <div className="truncate text-xs text-muted-foreground">{v.description} · {v.gender} · {v.accent}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Generated voiceovers</h2>
      {voiceovers.length === 0 ? (
        <EmptyState icon={<Mic className="h-6 w-6" />} title="No voiceovers yet" description="Voiceovers you generate in the AI Studio appear here with per-scene tracks." />
      ) : (
        <div className="grid gap-3">
          {voiceovers.map((v) => (
            <Card key={v.id} className="border-border/60">
              <CardContent className="p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="line-clamp-1 text-sm font-medium">{v.script.topic}</div>
                    <div className="text-xs text-muted-foreground">
                      {v.voiceId} · {v.speed}× · {formatDuration(v.duration)} · {v.sceneAudio.length} scene tracks
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => new Audio(v.audioUrl).play()}>
                      <Play className="mr-1 h-3.5 w-3.5" /> Full
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {v.sceneAudio.map((s) => (
                    <button
                      key={s.sceneNumber}
                      onClick={() => s.url && new Audio(s.url).play()}
                      className="rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      S{s.sceneNumber} · {s.duration.toFixed(1)}s
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
