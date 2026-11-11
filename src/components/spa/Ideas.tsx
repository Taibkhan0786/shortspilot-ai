"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, EmptyState, SectionHeader, Spinner, timeAgo } from "./common";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { Lightbulb, Loader2, Check, X, Trash2, ExternalLink, Pencil } from "lucide-react";

type Idea = {
  id: string; topic: string; hook: string; angle: string; language: string;
  duration: number; status: string; score: number; createdAt: string;
  sources: { title: string; url: string }[];
};

export function Ideas() {
  const { setView } = useApp();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [topic, setTopic] = useState("");
  const [editing, setEditing] = useState<Idea | null>(null);

  const load = useCallback(() => {
    api.get<{ ideas: Idea[] }>("/api/v1/ideas?limit=50")
      .then((d) => setIdeas(d.ideas))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      const d = await api.post<{ ideas: Idea[] }>("/api/v1/ideas/generate", { topic: topic || undefined, count: 3 });
      toast.success(`${d.ideas.length} new ideas`);
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setGenerating(false);
    }
  }

  async function setStatus(idea: Idea, status: string) {
    try {
      await api.patch(`/api/v1/ideas/${idea.id}`, { status });
      setIdeas((list) => list.map((i) => (i.id === idea.id ? { ...i, status } : i)));
      toast.success(status === "APPROVED" ? "Idea approved" : "Idea rejected");
    } catch (e) {
      toastError(e);
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/api/v1/ideas/${id}`);
      setIdeas((list) => list.filter((i) => i.id !== id));
      toast.success("Idea deleted");
    } catch (e) {
      toastError(e);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api.patch(`/api/v1/ideas/${editing.id}`, { topic: editing.topic, hook: editing.hook, angle: editing.angle });
      setIdeas((list) => list.map((i) => (i.id === editing.id ? editing : i)));
      setEditing(null);
      toast.success("Idea updated");
    } catch (e) {
      toastError(e);
    }
  }

  async function generateScript(idea: Idea) {
    try {
      await api.post("/api/v1/scripts/generate", { ideaId: idea.id });
      toast.success("Script generated from idea");
      setView("scripts");
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Content Ideas"
        description="AI-researched ideas for your niche. Approve the best, generate scripts from them."
        actions={
          <div className="flex w-full gap-2 sm:w-auto">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Optional topic hint…" className="sm:w-64" />
            <Button onClick={generate} disabled={generating}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lightbulb className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : ideas.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="h-6 w-6" />}
          title="No ideas yet"
          description="Generate your first batch of researched content ideas."
          action={<Button onClick={generate} disabled={generating}>Generate ideas</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {ideas.map((i) => (
            <Card key={i.id} className="border-border/60">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold leading-snug">{i.topic}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">&ldquo;{i.hook}&rdquo;</p>
                  </div>
                  <StatusBadge status={i.status} />
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{i.angle}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">{i.score}</span>
                  <span>{i.language}</span>
                  <span>· {i.duration}s</span>
                  <span>· {timeAgo(i.createdAt)}</span>
                  {i.sources?.length > 0 && <span>· {i.sources.length} sources</span>}
                </div>
                {i.sources?.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">View research sources</summary>
                    <ul className="mt-2 space-y-1">
                      {i.sources.slice(0, 5).map((s, idx) => (
                        <li key={idx} className="truncate text-xs">
                          <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <ExternalLink className="h-3 w-3" /> {s.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setEditing(i)}><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</Button>
                  {i.status !== "APPROVED" && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(i, "APPROVED")}><Check className="mr-1 h-3.5 w-3.5 text-emerald-500" /> Approve</Button>
                  )}
                  {i.status !== "REJECTED" && (
                    <Button size="sm" variant="outline" onClick={() => setStatus(i, "REJECTED")}><X className="mr-1 h-3.5 w-3.5 text-red-400" /> Reject</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => generateScript(i)}><Lightbulb className="mr-1 h-3.5 w-3.5" /> Script</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(i.id)} className="ml-auto text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Edit idea</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Textarea value={editing.topic} onChange={(e) => setEditing({ ...editing, topic: e.target.value })} placeholder="Topic" />
              <Textarea value={editing.hook} onChange={(e) => setEditing({ ...editing, hook: e.target.value })} placeholder="Hook" />
              <Textarea value={editing.angle} onChange={(e) => setEditing({ ...editing, angle: e.target.value })} placeholder="Angle" />
              <Button onClick={saveEdit} className="w-full">Save changes</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
