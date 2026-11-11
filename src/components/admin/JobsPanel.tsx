"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner, StatusBadge, timeAgo } from "./common";
import { api } from "@/components/spa/api";
import { RefreshCw, Film, UploadCloud } from "lucide-react";

type RenderJob = {
  id: string; status: string; stage: string; progress: number; error: string | null; attempts: number; createdAt: string;
  video: { id: string; title: string; user: { email: string } };
};
type PublishingJob = {
  id: string; uploadStatus: string; error: string | null; attempts: number; scheduledAt: string | null; youtubeUrl: string | null; createdAt: string;
  video: { id: string; title: string; user: { email: string } };
  channel: { channelTitle: string };
};

const JOB_STATUSES = ["ALL", "QUEUED", "RUNNING", "DONE", "FAILED"];

export function JobsPanel() {
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [publishingJobs, setPublishingJobs] = useState<PublishingJob[]>([]);
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const qs = status !== "ALL" ? `?status=${status}` : "";
    Promise.all([
      api.get<{ renderJobs: RenderJob[] }>(`/api/v1/admin/jobs${qs}`),
      api.get<{ publishingJobs: PublishingJob[] }>(`/api/v1/admin/jobs${qs}`),
    ])
      .then(([r, p]) => {
        setRenderJobs(r.renderJobs);
        setPublishingJobs(p.publishingJobs);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    const t0 = setTimeout(load, 0);
    const t = setInterval(load, 15000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {JOB_STATUSES.map((s) => <SelectItem key={s} value={s}>{s === "ALL" ? "All statuses" : s}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5" /> auto 15s
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh</Button>
        </div>
      </div>

      {loading && renderJobs.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Film className="h-4 w-4 text-violet-400" /> Render jobs
                <Badge variant="outline" className="ml-auto">{renderJobs.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-96 space-y-2 overflow-y-auto">
              {renderJobs.map((j) => (
                <div key={j.id} className="rounded-lg border border-border/50 p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 font-medium">{j.video.title}</span>
                    <StatusBadge status={j.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{j.video.user?.email} · {timeAgo(j.createdAt)} · attempt {j.attempts}</p>
                  {j.stage && <p className="mt-1 text-xs text-muted-foreground">{j.stage} ({j.progress}%)</p>}
                  {j.error && <p className="mt-1 line-clamp-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{j.error}</p>}
                </div>
              ))}
              {renderJobs.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No render jobs.</p>}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <UploadCloud className="h-4 w-4 text-emerald-400" /> Publishing jobs
                <Badge variant="outline" className="ml-auto">{publishingJobs.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-96 space-y-2 overflow-y-auto">
              {publishingJobs.map((j) => (
                <div key={j.id} className="rounded-lg border border-border/50 p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 font-medium">{j.video.title}</span>
                    <StatusBadge status={j.uploadStatus === "DONE" ? "PUBLISHED" : j.uploadStatus} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {j.video.user?.email} · → {j.channel.channelTitle} · {timeAgo(j.createdAt)}
                  </p>
                  {j.youtubeUrl && (
                    <a href={j.youtubeUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-400 hover:underline">
                      {j.youtubeUrl}
                    </a>
                  )}
                  {j.error && <p className="mt-1 line-clamp-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{j.error}</p>}
                </div>
              ))}
              {publishingJobs.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No publishing jobs.</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
