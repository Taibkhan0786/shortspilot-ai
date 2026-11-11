"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, EmptyState, SectionHeader, Spinner, timeAgo } from "./common";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { FileText, Loader2, Check, RefreshCw, Trash2, Mic, ImageIcon } from "lucide-react";

type Scene = { sceneNumber: number; narration: string; visualPrompt: string; caption: string };
type ScriptT = {
  id: string; topic: string; hook: string; cta: string; status: string; version: number;
  scenes: Scene[]; warnings: string[]; duration: number; language: string; tone: string; updatedAt: string;
};

export function Scripts() {
  const { setView, focusResource, clearFocus } = useApp();
  const [scripts, setScripts] = useState<ScriptT[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ scripts: ScriptT[] }>("/api/v1/scripts?limit=50")
      .then((d) => setScripts(d.scripts))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  // notification deep link → expand + highlight the linked script
  useEffect(() => {
    if (focusResource && !loading && scripts.some((s) => s.id === focusResource)) {
      setOpenId(focusResource);
      setHighlightId(focusResource);
      const t = setTimeout(() => setHighlightId(null), 4000);
      clearFocus();
      return () => clearTimeout(t);
    }
  }, [focusResource, loading, scripts, clearFocus]);

  async function save(script: ScriptT) {
    setBusy(script.id);
    try {
      await api.patch(`/api/v1/scripts/${script.id}`, { hook: script.hook, cta: script.cta, scenes: script.scenes });
      toast.success("Script saved");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function approve(script: ScriptT) {
    setBusy(script.id);
    try {
      await api.patch(`/api/v1/scripts/${script.id}`, { status: "APPROVED" });
      setScripts((l) => l.map((s) => (s.id === script.id ? { ...s, status: "APPROVED" } : s)));
      toast.success("Script approved");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(script: ScriptT) {
    setBusy(script.id);
    try {
      const d = await api.post<{ script: ScriptT }>(`/api/v1/scripts/${script.id}/regenerate`, {});
      toast.success(`New version created (v${d.script.version})`);
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/api/v1/scripts/${id}`);
      setScripts((l) => l.filter((s) => s.id !== id));
      toast.success("Script deleted");
    } catch (e) {
      toastError(e);
    }
  }

  function generateVoice(script: ScriptT) {
    setView("studio");
    toast.info("Voice generation lives in the AI Studio — open it from the sidebar.");
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  return (
    <div>
      <SectionHeader
        title="Scripts"
        description="Edit, version and approve your scene-level scripts."
        actions={<Button variant="outline" onClick={() => setView("studio")}><FileText className="mr-2 h-4 w-4" /> New script in Studio</Button>}
      />
      {scripts.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="No scripts yet"
          description="Generate a script from an idea or a topic in the AI Studio."
          action={<Button onClick={() => setView("studio")}>Open AI Studio</Button>}
        />
      ) : (
        <div className="space-y-4">
          {scripts.map((s) => {
            const open = openId === s.id;
            return (
              <Card key={s.id} className={`border-border/60 transition-shadow ${highlightId === s.id ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 cursor-pointer flex-1" onClick={() => setOpenId(open ? null : s.id)}>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{s.topic}</h3>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        v{s.version} · {s.scenes.length} scenes · {s.duration}s · {s.language} · {s.tone} · updated {timeAgo(s.updatedAt)}
                      </p>
                      {s.warnings.length > 0 && (
                        <p className="mt-1 text-xs text-amber-400">⚠ {s.warnings[0]}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {!open && <Button size="sm" variant="outline" onClick={() => setOpenId(s.id)}>Open editor</Button>}
                      {s.status !== "APPROVED" && (
                        <Button size="sm" onClick={() => approve(s)} disabled={busy === s.id}>
                          {busy === s.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />} Approve
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => regenerate(s)} disabled={busy === s.id}>
                        {busy === s.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} Regenerate
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => generateVoice(s)}><Mic className="mr-1 h-3.5 w-3.5" /> Voice</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(s.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>

                  {open && (
                    <div className="mt-5 space-y-3 border-t border-border/60 pt-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Hook</label>
                        <Textarea
                          value={s.hook}
                          onChange={(e) => setScripts((l) => l.map((x) => (x.id === s.id ? { ...x, hook: e.target.value } : x)))}
                          className="min-h-16"
                        />
                      </div>
                      {s.scenes.map((sc, idx) => (
                        <div key={sc.sceneNumber} className="rounded-lg border border-border/50 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-semibold text-primary">Scene {sc.sceneNumber}</span>
                            <Input
                              value={sc.caption}
                              onChange={(e) => {
                                const v = { ...sc, caption: e.target.value };
                                setScripts((l) => l.map((x) => (x.id === s.id ? { ...x, scenes: x.scenes.map((y, j) => (j === idx ? v : y)) } : x)));
                              }}
                              className="h-7 max-w-56 text-xs"
                              placeholder="Caption"
                            />
                          </div>
                          <Textarea
                            value={sc.narration}
                            onChange={(e) => {
                              const v = { ...sc, narration: e.target.value };
                              setScripts((l) => l.map((x) => (x.id === s.id ? { ...x, scenes: x.scenes.map((y, j) => (j === idx ? v : y)) } : x)));
                            }}
                            className="min-h-16 text-sm"
                          />
                          <p className="mt-1.5 line-clamp-1 text-xs text-muted-foreground">Visual: {sc.visualPrompt}</p>
                        </div>
                      ))}
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => save(s)} disabled={busy === s.id}>
                          {busy === s.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null} Save changes
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
