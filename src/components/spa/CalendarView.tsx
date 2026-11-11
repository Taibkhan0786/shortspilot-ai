"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, SectionHeader, Spinner } from "./common";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CalendarDays, ChevronLeft, ChevronRight, X, CalendarClock } from "lucide-react";

type CalVideo = {
  id: string; title: string; status: string; thumbnailUrl?: string | null;
  scheduledAt?: string | null; publishedAt?: string | null; createdAt: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView() {
  const [videos, setVideos] = useState<CalVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [detail, setDetail] = useState<{ date: Date; items: CalVideo[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ videos: CalVideo[] }>("/api/v1/videos?limit=100")
      .then((d) => setVideos(d.videos))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const arr: { date: Date | null }[] = [];
    for (let i = 0; i < startPad; i++) arr.push({ date: null });
    for (let d = 1; d <= daysInMonth; d++) arr.push({ date: new Date(year, month, d) });
    while (arr.length % 7 !== 0) arr.push({ date: null });
    return arr;
  }, [cursor]);

  function itemsFor(date: Date) {
    return videos.filter((v) => {
      const t = v.scheduledAt ? new Date(v.scheduledAt) : v.publishedAt ? new Date(v.publishedAt) : null;
      if (!t) return false;
      return t.getFullYear() === date.getFullYear() && t.getMonth() === date.getMonth() && t.getDate() === date.getDate();
    });
  }

  async function unschedule(v: CalVideo) {
    setBusy(true);
    try {
      await api.patch(`/api/v1/videos/${v.id}`, { status: "APPROVED", scheduledAt: null });
      toast.success("Removed from schedule");
      load();
      setDetail(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function scheduleNextSlot(v: CalVideo) {
    setBusy(true);
    try {
      const when = new Date(Date.now() + 2 * 3600000);
      when.setMinutes(0, 0, 0);
      await api.post("/api/v1/publishing/upload", { videoId: v.id, scheduledAt: when.toISOString() });
      toast.success(`Scheduled for ${when.toLocaleString()}`);
      load();
      setDetail(null);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  return (
    <div>
      <SectionHeader
        title="Content Calendar"
        description="Scheduled and published Shorts at a glance. Click a day to manage its queue."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold">
              {cursor.toLocaleString([], { month: "long", year: "numeric" })}
            </span>
            <Button variant="outline" size="icon" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Card className="border-border/60">
        <CardContent className="p-3 sm:p-5">
          <div className="mb-2 grid grid-cols-7 gap-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {WEEKDAYS.map((d) => <div key={d}>{d.slice(0, 1)}<span className="hidden sm:inline">{d.slice(1)}</span></div>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {cells.map((c, i) => {
              if (!c.date) return <div key={i} className="min-h-16 rounded-lg bg-transparent sm:min-h-24" />;
              const items = itemsFor(c.date);
              const isToday = new Date().toDateString() === c.date.toDateString();
              return (
                <button
                  key={i}
                  onClick={() => items.length > 0 && setDetail({ date: c.date!, items })}
                  className={cn(
                    "min-h-16 rounded-lg border p-1.5 text-left align-top transition-colors sm:min-h-24",
                    isToday ? "border-primary/60 bg-primary/5" : "border-border/50 hover:border-primary/30",
                    items.length > 0 && "cursor-pointer"
                  )}
                >
                  <div className={cn("text-[11px]", isToday ? "font-bold text-primary" : "text-muted-foreground")}>
                    {c.date.getDate()}
                  </div>
                  <div className="mt-1 space-y-1">
                    {items.slice(0, 2).map((v) => (
                      <div key={v.id} className={cn(
                        "truncate rounded px-1 py-0.5 text-[10px] font-medium",
                        v.status === "SCHEDULED" ? "bg-sky-500/15 text-sky-400" : "bg-emerald-500/15 text-emerald-400"
                      )}>
                        {v.status === "SCHEDULED" ? "Scheduled: " : "Published: "}
                        {v.title}
                      </div>
                    ))}
                    {items.length > 2 && <div className="px-1 text-[10px] text-muted-foreground">+{items.length - 2} more</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-sky-500/60" /> Scheduled</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded bg-emerald-500/60" /> Published</span>
      </div>

      {/* Day detail dialog */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetail(null)}>
          <Card className="w-full max-w-md border-border/60" onClick={(e) => e.stopPropagation()}>
            <CardContent className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-2 font-semibold">
                  <CalendarClock className="h-4 w-4 text-primary" />
                  {detail.date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
                </h3>
                <Button variant="ghost" size="icon" onClick={() => setDetail(null)} aria-label="Close"><X className="h-4 w-4" /></Button>
              </div>
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {detail.items.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-2.5">
                    <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
                      {v.thumbnailUrl && (
                         
                        <img src={v.thumbnailUrl} alt={v.title} className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-sm font-medium">{v.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {v.scheduledAt ? `Scheduled ${new Date(v.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Published"}
                      </div>
                    </div>
                    <StatusBadge status={v.status} />
                    {v.status === "SCHEDULED" && (
                      <Button size="sm" variant="outline" onClick={() => unschedule(v)} disabled={busy}>Unschedule</Button>
                    )}
                    {v.status === "APPROVED" && (
                      <Button size="sm" variant="outline" onClick={() => scheduleNextSlot(v)} disabled={busy}>Schedule</Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// alias for import compatibility
export function Calendar() {
  return <CalendarView />;
}
