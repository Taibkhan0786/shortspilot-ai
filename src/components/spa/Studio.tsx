"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, EmptyState, SectionHeader, Spinner, formatDuration } from "./common";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Wand2, Lightbulb, FileText, Mic, ImageIcon, Film, UploadCloud,
  ArrowRight, ArrowLeft, RefreshCw, Check, Loader2, Pencil, CalendarClock, Download, Play,
} from "lucide-react";

type Idea = { id: string; topic: string; hook: string; angle: string; duration: number; score: number; sources: { title: string; url: string }[] };
type Scene = { sceneNumber: number; narration: string; visualPrompt: string; caption: string };
type ScriptT = { id: string; topic: string; hook: string; cta: string; scenes: Scene[]; warnings: string[]; duration: number };
type VoiceoverT = { id: string; audioUrl: string; duration: number; sceneAudio: { sceneNumber: number; url: string; duration: number }[] };
type AssetT = { id: string; sceneNumber: number | null; assetUrl: string; prompt?: string };
type VisualJobT = { id: string; status: string; progress: number; stage: string; totalScenes: number; createdCount: number; failedCount: number; error?: string | null };
type VideoT = {
  id: string; title: string; description?: string; hashtags?: string; tags?: string;
  status: string; progress: number; statusMessage?: string; videoUrl?: string; thumbnailUrl?: string;
  duration: number; scheduledAt?: string | null; youtubeUrl?: string; error?: string;
  scenes?: { sceneNumber: number; caption?: string }[];
};

const STEPS = [
  { id: 0, label: "Brief", icon: Wand2 },
  { id: 1, label: "Idea", icon: Lightbulb },
  { id: 2, label: "Script", icon: FileText },
  { id: 3, label: "Voice", icon: Mic },
  { id: 4, label: "Visuals", icon: ImageIcon },
  { id: 5, label: "Render", icon: Film },
  { id: 6, label: "Publish", icon: UploadCloud },
];

const VOICE_OPTIONS = [
  { id: "tongtong", label: "Tongtong — warm" }, { id: "chuichui", label: "Chuichui — lively" },
  { id: "xiaochen", label: "Xiaochen — professional" }, { id: "jam", label: "Jam — British" },
  { id: "kazi", label: "Kazi — clear" }, { id: "douji", label: "Douji — smooth" }, { id: "luodo", label: "Luodo — expressive" },
];

export function Studio() {
  const { profile, subscription } = useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  // brief
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState(profile?.language || "English");
  const [duration, setDuration] = useState(profile?.duration || 45);
  const [tone, setTone] = useState(profile?.scriptStyle || "educational");
  const [voice, setVoice] = useState(profile?.voiceId || "tongtong");
  const [style, setStyle] = useState(profile?.visualStyle || "cinematic");
  const [useResearch, setUseResearch] = useState(true);

  // pipeline artifacts
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [idea, setIdea] = useState<Idea | null>(null);
  const [script, setScript] = useState<ScriptT | null>(null);
  const [voiceover, setVoiceover] = useState<VoiceoverT | null>(null);
  const [assets, setAssets] = useState<AssetT[]>([]);
  const [visualJob, setVisualJob] = useState<VisualJobT | null>(null);
  const [video, setVideo] = useState<VideoT | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const watermark = subscription?.plan?.watermark ?? true;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const generateIdeas = useCallback(async () => {
    setBusy("ideas");
    try {
      const d = await api.post<{ ideas: Idea[] }>("/api/v1/ideas/generate", {
        topic: topic || undefined, language, count: 3, research: useResearch,
      });
      setIdeas(d.ideas);
      setStep(1);
      toast.success(`${d.ideas.length} ideas generated`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }, [topic, language, useResearch]);

  async function pickIdea(i: Idea) {
    setIdea(i);
    setBusy("script");
    try {
      const d = await api.post<{ script: ScriptT }>("/api/v1/scripts/generate", {
        ideaId: i.id, language, tone, duration: i.duration || duration,
      });
      setScript(d.script);
      setStep(2);
      toast.success("Script ready — review and edit below");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function approveScript() {
    if (!script) return;
    setBusy("approve-script");
    try {
      await api.patch(`/api/v1/scripts/${script.id}`, { status: "APPROVED" });
      setStep(3);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function regenerateScript() {
    if (!script) return;
    setBusy("regen-script");
    try {
      const d = await api.post<{ script: ScriptT }>(`/api/v1/scripts/${script.id}/regenerate`, {});
      setScript(d.script);
      toast.success("New script version generated");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function generateVoice() {
    if (!script) return;
    setBusy("voice");
    try {
      const d = await api.post<{ voiceover: VoiceoverT }>("/api/v1/voice/generate", { scriptId: script.id, voice });
      setVoiceover(d.voiceover);
      setStep(4);
      toast.success(`Voiceover ready (${Math.round(d.voiceover.duration)}s)`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function generateVisuals() {
    if (!script) return;
    setBusy("visuals");
    setVisualJob(null);
    try {
      // async job — image generation runs in the background; we poll for progress
      const d = await api.post<{ jobId: string; totalScenes: number }>("/api/v1/visuals/generate", {
        scriptId: script.id, style,
      });
      toast.success(`Visual generation started (${d.totalScenes} scenes)`);
      let polls = 0;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.get<{ job: VisualJobT | null; assets: AssetT[]; assetCount: number }>(
            `/api/v1/visuals/status?scriptId=${script.id}`
          );
          setVisualJob(s.job);
          if (s.assets.length) setAssets(s.assets);
          polls++;
          if (s.job && (s.job.status === "DONE" || s.job.status === "FAILED")) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(null);
            if (s.job.status === "DONE") {
              const failed = s.job.failedCount ? ` · ${s.job.failedCount} failed (retriable)` : "";
              toast.success(`${s.job.createdCount} scene visuals ready${failed}`);
              setStep(5);
            } else {
              toast.error(s.job.error || "Visual generation failed");
            }
          } else if (polls > 240) {
            // hard stop after ~10 min
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setBusy(null);
            toast.error("Visual generation timed out — try again");
          }
        } catch {
          /* transient poll errors — keep polling */
        }
      }, 2500);
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  }

  async function createAndRender() {
    if (!script) return;
    setBusy("render");
    try {
      const channels = await api.get<{ channels: { id: string; channelTitle: string }[] }>("/api/v1/channels");
      const v = await api.post<{ video: VideoT }>("/api/v1/videos", {
        scriptId: script.id,
        channelId: channels.channels[0]?.id,
      });
      setVideo(v.video);
      await api.post(`/api/v1/videos/${v.video.id}/render`);
      // poll progress
      pollRef.current = setInterval(async () => {
        const cur = await api.get<{ video: VideoT }>(`/api/v1/videos/${v.video.id}`);
        setVideo(cur.video);
        if (!["RENDERING", "DRAFT", "QUALITY_CHECK"].includes(cur.video.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(null);
          setStep(6);
        }
      }, 3000);
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  }

  async function approveVideo() {
    if (!video) return;
    setBusy("approve-video");
    try {
      await api.patch(`/api/v1/videos/${video.id}`, { status: "APPROVED" });
      setVideo({ ...video, status: "APPROVED" });
      toast.success("Video approved — ready to publish");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function publishNow() {
    if (!video) return;
    setBusy("publish");
    try {
      await api.post("/api/v1/publishing/upload", { videoId: video.id });
      toast.success("Upload queued — the worker will publish it shortly");
      setBusy(null);
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  }

  async function scheduleVideo() {
    if (!video) return;
    const when = new Date(Date.now() + 3600000);
    setBusy("schedule");
    try {
      await api.post("/api/v1/publishing/upload", { videoId: video.id, scheduledAt: when.toISOString() });
      toast.success(`Scheduled for ${when.toLocaleString()}`);
      setBusy(null);
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  }

  function downloadVideo() {
    if (!video) return;
    window.open(`/api/v1/videos/${video.id}/download`, "_blank");
  }

  const canNext = (s: number) => {
    if (s === 0) return ideas.length > 0;
    if (s === 1) return Boolean(script);
    if (s === 2) return Boolean(script);
    if (s === 3) return Boolean(voiceover);
    if (s === 4) return assets.length > 0;
    if (s === 5) return video && video.status === "PENDING_APPROVAL";
    return false;
  };

  return (
    <div>
      <SectionHeader
        title="AI Studio"
        description="From brief to publish-ready Short — the full pipeline in one place."
      />

      {/* Stepper */}
      <div className="mb-6 flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, idx) => (
          <div key={s.id} className="flex items-center">
            <button
              onClick={() => canNext(s.id) && setStep(s.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                step === s.id
                  ? "border-primary bg-primary/15 font-medium text-primary"
                  : s.id < step
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-border text-muted-foreground"
              )}
            >
              {s.id < step ? <Check className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
              {s.label}
            </button>
            {idx < STEPS.length - 1 && <div className="mx-1 h-px w-4 shrink-0 bg-border" />}
          </div>
        ))}
      </div>

      {/* STEP 0: brief */}
      {step === 0 && (
        <Card className="border-border/60">
          <CardContent className="p-6">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic or brief (optional)</Label>
                  <Textarea
                    id="topic" value={topic} onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. The engineering behind NASA's newest Mars mission"
                    className="min-h-24"
                  />
                  <p className="text-xs text-muted-foreground">Leave empty to generate trend-aware ideas from your niche ({profile?.niche || "set in onboarding"}).</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["English", "Hindi", "Spanish", "Portuguese", "German", "French", "Arabic", "Indonesian"].map((l) => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Script tone</Label>
                    <Select value={tone} onValueChange={setTone}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="educational">Educational</SelectItem>
                        <SelectItem value="storytelling">Storytelling</SelectItem>
                        <SelectItem value="commentary">Commentary</SelectItem>
                        <SelectItem value="entertainment">Entertainment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Duration: {duration}s</Label>
                    <Input type="range" min={15} max={90} step={5} value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} className="p-0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Voice</Label>
                    <Select value={voice} onValueChange={setVoice}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{VOICE_OPTIONS.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Visual style</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {["cinematic", "cartoon", "realistic", "minimalist"].map((s) => (
                      <button
                        key={s} type="button" onClick={() => setStyle(s)}
                        className={cn(
                          "rounded-lg border p-2 text-xs capitalize transition-colors",
                          style === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={useResearch} onChange={(e) => setUseResearch(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
                  Ground ideas in web research (adds source references)
                </label>
                <Button onClick={generateIdeas} disabled={busy === "ideas"} className="w-full sm:w-auto">
                  {busy === "ideas" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lightbulb className="mr-2 h-4 w-4" />}
                  Generate ideas {busy === "ideas" ? "(researching…)" : ""}
                </Button>
              </div>
              <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
                <Wand2 className="mb-3 h-6 w-6 text-primary" />
                <p className="font-medium text-foreground">How the pipeline works</p>
                <ol className="mt-3 space-y-2">
                  <li>1. <b className="text-foreground">Idea</b> — AI researches your niche and proposes topics with hooks.</li>
                  <li>2. <b className="text-foreground">Script</b> — scene-level narration, visual prompts and captions.</li>
                  <li>3. <b className="text-foreground">Voice</b> — TTS narration per scene + a full track.</li>
                  <li>4. <b className="text-foreground">Visuals</b> — a vertical AI image per scene.</li>
                  <li>5. <b className="text-foreground">Render</b> — real 1080×1920 MP4 with synced audio, captions and zoom motion.</li>
                  <li>6. <b className="text-foreground">Publish</b> — approve, then upload or schedule to YouTube.</li>
                </ol>
                {watermark && (
                  <p className="mt-4 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-400">
                    Free trial plan: rendered videos carry a small watermark. Upgrade to remove it.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 1: ideas */}
      {step === 1 && (
        <div className="space-y-4">
          {ideas.map((i) => (
            <Card key={i.id} className="border-border/60 transition-colors hover:border-primary/40">
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{i.topic}</h3>
                    <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">{i.score}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">&ldquo;{i.hook}&rdquo;</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{i.angle}</p>
                  {i.sources?.length > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      <Lightbulb className="mr-1 inline h-3 w-3" />
                      {i.sources.length} research sources attached
                    </p>
                  )}
                </div>
                <Button onClick={() => pickIdea(i)} disabled={busy === "script"}>
                  {busy === "script" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                  Write script
                </Button>
              </CardContent>
            </Card>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" onClick={generateIdeas} disabled={busy === "ideas"}>
              <RefreshCw className="mr-2 h-4 w-4" /> Regenerate ideas
            </Button>
            <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="mr-2 h-4 w-4" /> Back to brief</Button>
          </div>
        </div>
      )}

      {/* STEP 2: script */}
      {step === 2 && script && (
        <div className="space-y-4">
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{script.topic}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">{script.scenes.length} scenes · ~{script.duration}s · v{script.id.slice(0, 4)}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={regenerateScript} disabled={busy === "regen-script"}>
                    {busy === "regen-script" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                    Regenerate
                  </Button>
                  <Button size="sm" onClick={approveScript} disabled={busy === "approve-script"}>
                    {busy === "approve-script" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-2 h-3.5 w-3.5" />}
                    Approve script
                  </Button>
                </div>
              </div>
              {script.warnings.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
                  <b>Quality warnings:</b> {script.warnings.join(" ")}
                </div>
              )}
            </CardContent>
          </Card>
          {script.scenes.map((s, idx) => (
            <Card key={s.sceneNumber} className="border-border/60">
              <CardContent className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-primary">Scene {s.sceneNumber}</span>
                  <span className="text-xs text-muted-foreground">{s.narration.split(/\s+/).length} words</span>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Narration</Label>
                    <Textarea
                      value={s.narration}
                      onChange={(e) => {
                        const scenes = [...script.scenes];
                        scenes[idx] = { ...s, narration: e.target.value };
                        setScript({ ...script, scenes });
                      }}
                      className="min-h-20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Caption</Label>
                    <Input
                      value={s.caption}
                      onChange={(e) => {
                        const scenes = [...script.scenes];
                        scenes[idx] = { ...s, caption: e.target.value };
                        setScript({ ...script, scenes });
                      }}
                    />
                    <Label>Visual prompt</Label>
                    <Textarea
                      value={s.visualPrompt}
                      onChange={(e) => {
                        const scenes = [...script.scenes];
                        scenes[idx] = { ...s, visualPrompt: e.target.value };
                        setScript({ ...script, scenes });
                      }}
                      className="min-h-16 text-xs"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="mr-2 h-4 w-4" /> Ideas</Button>
            <Button onClick={approveScript} disabled={busy === "approve-script"}>
              {busy === "approve-script" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Approve & continue to voice
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3: voice */}
      {step === 3 && (
        <Card className="border-border/60">
          <CardContent className="p-6">
            {voiceover ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Voiceover ready</h3>
                    <p className="text-sm text-muted-foreground">{Math.round(voiceover.duration)}s total · {voiceover.sceneAudio.length} scene tracks</p>
                  </div>
                  <Button onClick={() => setStep(4)}>Continue to visuals <ArrowRight className="ml-2 h-4 w-4" /></Button>
                </div>
                <audio controls src={voiceover.audioUrl} className="w-full" />
                <div className="grid gap-2 sm:grid-cols-2">
                  {voiceover.sceneAudio.map((s) => (
                    <div key={s.sceneNumber} className="flex items-center gap-2 rounded-lg border border-border/50 p-2.5">
                      <Mic className="h-4 w-4 shrink-0 text-primary" />
                      <span className="text-sm">Scene {s.sceneNumber}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{s.duration.toFixed(1)}s</span>
                    </div>
                  ))}
                </div>
                <Button variant="outline" onClick={generateVoice} disabled={busy === "voice"}>
                  {busy === "voice" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Regenerate voiceover
                </Button>
              </div>
            ) : (
              <div className="space-y-4 text-center sm:text-left">
                <Mic className="mx-auto h-8 w-8 text-primary sm:mx-0" />
                <h3 className="font-semibold">Generate the narration</h3>
                <p className="text-sm text-muted-foreground">One audio track per scene plus a combined master — voice &ldquo;{voice}&rdquo;.</p>
                <Button onClick={generateVoice} disabled={busy === "voice"}>
                  {busy === "voice" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
                  {busy === "voice" ? "Generating voice…" : "Generate voiceover"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 4: visuals */}
      {step === 4 && (
        <Card className="border-border/60">
          <CardContent className="p-6">
            {busy === "visuals" && (
              <div className="mb-5 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    {visualJob?.stage || "Generating visuals…"}
                  </span>
                  <span className="text-muted-foreground">{visualJob?.progress ?? 0}%</span>
                </div>
                <Progress value={visualJob?.progress ?? 0} />
                <p className="text-xs text-muted-foreground">
                  AI images render in the background — safe to wait here. {visualJob?.createdCount ?? 0}/{visualJob?.totalScenes ?? "…"} scenes done.
                </p>
              </div>
            )}
            {assets.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">{assets.length} scene visuals ready</h3>
                    <p className="text-sm text-muted-foreground">Style: {style} · vertical 768×1344</p>
                  </div>
                  <Button onClick={() => setStep(5)}>Continue to render <ArrowRight className="ml-2 h-4 w-4" /></Button>
                </div>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                  {assets.sort((a, b) => (a.sceneNumber ?? 0) - (b.sceneNumber ?? 0)).map((a) => (
                    <div key={a.id} className="overflow-hidden rounded-lg border border-border/60">
                      { }
                      <img src={a.assetUrl} alt={`Scene ${a.sceneNumber}`} className="aspect-[768/1344] w-full object-cover" />
                      <div className="p-1.5 text-center text-xs text-muted-foreground">Scene {a.sceneNumber}</div>
                    </div>
                  ))}
                </div>
                <Button variant="outline" onClick={generateVisuals} disabled={busy === "visuals"}>
                  {busy === "visuals" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Regenerate all
                </Button>
              </div>
            ) : (
              <div className="space-y-4 text-center sm:text-left">
                <ImageIcon className="mx-auto h-8 w-8 text-primary sm:mx-0" />
                <h3 className="font-semibold">Paint the scenes</h3>
                <p className="text-sm text-muted-foreground">One vertical AI image per scene, directed by each scene&apos;s visual prompt.</p>
                <Button onClick={generateVisuals} disabled={busy === "visuals"}>
                  {busy === "visuals" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
                  {busy === "visuals" ? "Generating visuals…" : "Generate visuals"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 5: render */}
      {step === 5 && (
        <Card className="border-border/60">
          <CardContent className="p-6">
            {video ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{video.title}</h3>
                  <StatusBadge status={video.status} />
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between text-sm text-muted-foreground">
                    <span>{video.statusMessage ?? "Rendering…"}</span>
                    <span>{video.progress}%</span>
                  </div>
                  <Progress value={video.progress} />
                </div>
                {video.status === "PENDING_APPROVAL" && (
                  <Button onClick={() => setStep(6)}>Review video <ArrowRight className="ml-2 h-4 w-4" /></Button>
                )}
              </div>
            ) : (
              <div className="space-y-4 text-center sm:text-left">
                <Film className="mx-auto h-8 w-8 text-primary sm:mx-0" />
                <h3 className="font-semibold">Assemble & render</h3>
                <p className="text-sm text-muted-foreground">
                  Combines scene images + narration into a 1080×1920 MP4 with caption overlays, zoom motion and quality checks.
                  This runs on the background worker (not in your browser).
                </p>
                <Button onClick={createAndRender} disabled={busy === "render"}>
                  {busy === "render" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}
                  {busy === "render" ? "Queueing render…" : "Start render"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 6: publish */}
      {step === 6 && video && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/60">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Preview</h3>
                <StatusBadge status={video.status} />
              </div>
              {video.videoUrl ? (
                <div className="mt-4 space-y-3">
                  <div className="relative mx-auto max-w-56 overflow-hidden rounded-xl bg-black">
                    <video
                      src={video.videoUrl}
                      poster={video.thumbnailUrl ?? undefined}
                      controls
                      className="aspect-[9/16] w-full"
                      aria-label={`Preview of ${video.title}`}
                    />
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    {formatDuration(video.duration)} · 1080×1920 · H.264 {watermark ? "· watermarked (free plan)" : ""}
                  </p>
                </div>
              ) : (
                <EmptyState title="Not rendered yet" className="mt-4" />
              )}
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardContent className="space-y-4 p-5">
              <div>
                <Label>Title</Label>
                <Input value={video.title} onChange={(e) => setVideo({ ...video, title: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={video.description ?? ""} onChange={(e) => setVideo({ ...video, description: e.target.value })} className="mt-1.5 min-h-20" />
              </div>
              <div>
                <Label>Hashtags</Label>
                <Input value={video.hashtags ?? ""} onChange={(e) => setVideo({ ...video, hashtags: e.target.value })} className="mt-1.5" />
              </div>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await api.patch(`/api/v1/videos/${video.id}`, { title: video.title, description: video.description, hashtags: video.hashtags });
                    toast.success("Metadata saved");
                  } catch (e) { toastError(e); }
                }}
              >
                <Pencil className="mr-2 h-4 w-4" /> Save metadata
              </Button>
              <div className="rounded-lg border border-border/60 p-4">
                <p className="mb-3 text-sm font-medium">Publishing</p>
                {video.status === "PENDING_APPROVAL" && (
                  <Button onClick={approveVideo} disabled={busy === "approve-video"} className="w-full">
                    {busy === "approve-video" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                    Approve video
                  </Button>
                )}
                {video.status === "APPROVED" && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Button onClick={publishNow} disabled={busy === "publish"}>
                      {busy === "publish" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />} Upload now
                    </Button>
                    <Button variant="outline" onClick={scheduleVideo} disabled={busy === "schedule"}>
                      <CalendarClock className="mr-2 h-4 w-4" /> +1 hour
                    </Button>
                    <Button variant="outline" onClick={downloadVideo}><Download className="mr-2 h-4 w-4" /> Download</Button>
                  </div>
                )}
                {video.status === "SCHEDULED" && (
                  <p className="text-sm text-muted-foreground">Scheduled for {video.scheduledAt ? new Date(video.scheduledAt).toLocaleString() : "—"}</p>
                )}
                {video.status === "PUBLISHED" && video.youtubeUrl && (
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-500" />
                    <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">{video.youtubeUrl}</a>
                  </div>
                )}
              </div>
              <Button variant="ghost" onClick={() => window.location.reload()} className="w-full">
                <Wand2 className="mr-2 h-4 w-4" /> Start another Short
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Preview</DialogTitle></DialogHeader>
          {video?.videoUrl && <video src={video.videoUrl} controls className="aspect-[9/16] w-full rounded-lg" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
