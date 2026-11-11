"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, EmptyState, SectionHeader, Spinner, formatDuration, timeAgo } from "./common";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { Film, Loader2, Check, X, Pencil, UploadCloud, Download, Trash2, ExternalLink, Play, RefreshCw } from "lucide-react";

type Video = {
  id: string; title: string; status: string; progress: number; statusMessage?: string;
  thumbnailUrl?: string | null; videoUrl?: string | null; duration: number;
  channel?: { channelTitle: string } | null; createdAt: string; scheduledAt?: string | null;
  youtubeUrl?: string | null; description?: string | null; hashtags?: string | null; error?: string | null;
  renderJobs?: { status: string; progress: number; stage: string }[];
};

export function VideoLibrary() {
  const { user, setView, focusResource, clearFocus } = useApp();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Video | null>(null);
  const [editing, setEditing] = useState<Video | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(() => {
    api.get<{ videos: Video[] }>("/api/v1/videos?limit=50")
      .then((d) => setVideos(d.videos))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  // notification deep link → scroll to + highlight the linked video card
  useEffect(() => {
    if (focusResource && !loading && videos.some((v) => v.id === focusResource)) {
      setHighlightId(focusResource);
      cardRefs.current[focusResource]?.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => setHighlightId(null), 4000);
      clearFocus();
      return () => clearTimeout(t);
    }
  }, [focusResource, loading, videos, clearFocus]);

  async function approve(v: Video) {
    setBusy(v.id);
    try {
      await api.patch(`/api/v1/videos/${v.id}`, { status: "APPROVED" });
      load();
      toast.success("Approved — publish from the AI Studio or here");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function reject(v: Video) {
    setBusy(v.id);
    try {
      await api.patch(`/api/v1/videos/${v.id}`, { status: "REJECTED" });
      load();
      toast.success("Video rejected");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function upload(v: Video) {
    setBusy(v.id);
    try {
      await api.post("/api/v1/publishing/upload", { videoId: v.id });
      toast.success("Upload queued — the publishing worker will process it");
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function retryRender(v: Video) {
    setBusy(v.id);
    try {
      await api.post(`/api/v1/videos/${v.id}/render`);
      toast.success("Render re-queued");
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/api/v1/videos/${id}`);
      setVideos((l) => l.filter((v) => v.id !== id));
      toast.success("Video deleted");
    } catch (e) {
      toastError(e);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    try {
      await api.patch(`/api/v1/videos/${editing.id}`, {
        title: editing.title, description: editing.description, hashtags: editing.hashtags,
      });
      load();
      setEditing(null);
      toast.success("Metadata saved");
    } catch (e) {
      toastError(e);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  return (
    <div>
      <SectionHeader
        title="Video Library"
        description="Every generated Short with status, previews and publishing controls."
        actions={<Button variant="outline" onClick={() => setView("studio")}><Film className="mr-2 h-4 w-4" /> New Short</Button>}
      />
      {videos.length === 0 ? (
        <EmptyState
          icon={<Film className="h-6 w-6" />}
          title="No videos yet"
          description="Generate your first Short end-to-end in the AI Studio."
          action={<Button onClick={() => setView("studio")}>Open AI Studio</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => {
            const rendering = v.status === "RENDERING";
            return (
              <div
                key={v.id}
                ref={(el) => { cardRefs.current[v.id] = el; }}
                className={highlightId === v.id ? "rounded-xl ring-2 ring-primary ring-offset-2 ring-offset-background transition-shadow" : undefined}
              >
              <Card className="border-border/60">
                <CardContent className="p-0">
                  <div className="relative aspect-[9/13] overflow-hidden rounded-t-xl bg-muted">
                    {v.thumbnailUrl ? (
                       
                      <img src={v.thumbnailUrl} alt={v.title} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground"><Film className="h-8 w-8" /></div>
                    )}
                    {v.videoUrl && (
                      <button
                        onClick={() => setPreview(v)}
                        aria-label={`Preview ${v.title}`}
                        className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/40"
                      >
                        <span className="flex h-11 w-11 scale-90 items-center justify-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition-all hover:scale-100 group-hover:opacity-100">
                          <Play className="ml-0.5 h-5 w-5 fill-current" />
                        </span>
                      </button>
                    )}
                    <div className="absolute left-2 top-2"><StatusBadge status={v.status} /></div>
                  </div>
                  <div className="p-4">
                    <h3 className="line-clamp-2 min-h-10 text-sm font-semibold">{v.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDuration(v.duration)} · {timeAgo(v.createdAt)}{v.channel ? ` · ${v.channel.channelTitle}` : ""}
                    </p>
                    {rendering && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>{v.statusMessage || "Rendering"}</span><span>{v.progress}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${v.progress}%` }} />
                        </div>
                      </div>
                    )}
                    {v.status === "FAILED" && (
                      <p className="mt-2 line-clamp-2 text-xs text-destructive">{v.error}</p>
                    )}
                    {v.status === "PUBLISHED" && v.youtubeUrl && (
                      <a href={v.youtubeUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <ExternalLink className="h-3 w-3" /> {v.youtubeUrl}
                      </a>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {v.videoUrl && (
                        <Button size="sm" variant="outline" onClick={() => setPreview(v)}><Play className="mr-1 h-3.5 w-3.5" /> Preview</Button>
                      )}
                      {v.status === "PENDING_APPROVAL" && (
                        <>
                          <Button size="sm" onClick={() => approve(v)} disabled={busy === v.id}>
                            {busy === v.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />} Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => reject(v)}><X className="mr-1 h-3.5 w-3.5" /></Button>
                        </>
                      )}
                      {v.status === "APPROVED" && (
                        <Button size="sm" onClick={() => upload(v)} disabled={busy === v.id}>
                          {busy === v.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="mr-1 h-3.5 w-3.5" />} Upload
                        </Button>
                      )}
                      {v.status === "FAILED" && (
                        <Button size="sm" variant="outline" onClick={() => retryRender(v)} disabled={busy === v.id}>
                          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry render
                        </Button>
                      )}
                      {v.videoUrl && (
                        <a href={`/api/v1/videos/${v.id}/download`} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline"><Download className="mr-1 h-3.5 w-3.5" /></Button>
                        </a>
                      )}
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Edit metadata" onClick={() => setEditing(v)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="ml-auto h-8 w-8 p-0 text-muted-foreground hover:text-destructive" aria-label="Delete video" onClick={() => remove(v.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview dialog */}
      <Dialog open={Boolean(preview)} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle className="line-clamp-1 pr-6">{preview?.title}</DialogTitle></DialogHeader>
          {preview?.videoUrl && (
            <video src={preview.videoUrl} poster={preview.thumbnailUrl ?? undefined} controls autoPlay className="aspect-[9/16] w-full rounded-lg" />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit metadata dialog */}
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Edit metadata</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Title" />
              <Textarea value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Description" />
              <Input value={editing.hashtags ?? ""} onChange={(e) => setEditing({ ...editing, hashtags: e.target.value })} placeholder="#hashtags" />
              <Button onClick={saveEdit} className="w-full">Save metadata</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
