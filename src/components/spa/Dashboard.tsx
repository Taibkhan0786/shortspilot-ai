"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge, EmptyState, formatDuration, timeAgo, Spinner } from "./common";
import { useApp } from "./store";
import { api } from "./api";
import {
  Youtube, Film, UploadCloud, Clock, AlertTriangle, Lightbulb, Gauge,
  Wand2, ArrowRight, Coins,
} from "lucide-react";
import Link from "next/link";

type DashboardData = {
  channels: number;
  generated: number;
  published: number;
  pendingApproval: number;
  failedJobs: number;
  ideas: number;
  upcoming: { id: string; title: string; scheduledAt: string | null }[];
  recentVideos: { id: string; title: string; status: string; thumbnailUrl?: string | null; createdAt: string; duration: number }[];
  usage: { balance: number; spentThisMonth: number; monthlyCap: number; plan: { name: string; shortsUsed: number; shortsLimit: number } | null };
};

export function Dashboard() {
  const { setView, user } = useApp();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api
      .get<DashboardData>("/api/v1/dashboard")
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="flex justify-center py-20"><Spinner className="h-6 w-6 text-primary" /></div>
    );
  }
  if (!data) return null;

  const widgets = [
    { label: "Connected channels", value: data.channels, icon: Youtube, view: "channels" as const },
    { label: "Generated Shorts", value: data.generated, icon: Film, view: "videos" as const },
    { label: "Published", value: data.published, icon: UploadCloud, view: "analytics" as const },
    { label: "Pending approval", value: data.pendingApproval, icon: Clock, view: "videos" as const },
    { label: "Failed jobs", value: data.failedJobs, icon: AlertTriangle, view: "videos" as const },
    { label: "Content ideas", value: data.ideas, icon: Lightbulb, view: "ideas" as const },
  ];

  const plan = data.usage.plan;
  const planPct = plan ? Math.min(100, Math.round((plan.shortsUsed / Math.max(1, plan.shortsLimit)) * 100)) : 0;
  const capPct = Math.min(100, Math.round((data.usage.spentThisMonth / Math.max(1, data.usage.monthlyCap)) * 100));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
            Welcome back, {user?.name?.split(" ")[0]} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Your Shorts pipeline at a glance.</p>
        </div>
        <Button onClick={() => setView("studio")} className="gap-2">
          <Wand2 className="h-4 w-4" /> New Short in AI Studio
        </Button>
      </div>

      {/* Widgets */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {widgets.map((w) => (
          <button key={w.label} onClick={() => setView(w.view)} className="text-left">
            <Card className="border-border/60 bg-card/60 transition-colors hover:border-primary/40">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <w.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-2xl font-bold">{w.value}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{w.label}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent videos */}
        <Card className="border-border/60 lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Recent videos</CardTitle>
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => setView("videos")}>
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            {data.recentVideos.length === 0 ? (
              <EmptyState
                icon={<Film className="h-6 w-6" />}
                title="No videos yet"
                description="Generate your first Short in the AI Studio — idea to rendered video in minutes."
                action={<Button onClick={() => setView("studio")}>Open AI Studio</Button>}
              />
            ) : (
              <div className="space-y-2">
                {data.recentVideos.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setView("videos")}
                    className="flex w-full items-center gap-3 rounded-lg border border-border/50 p-2.5 text-left transition-colors hover:border-primary/40"
                  >
                    <div className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                      {v.thumbnailUrl ? (
                         
                        <img src={v.thumbnailUrl} alt={v.title} className="h-full w-full object-cover" />
                      ) : (
                        <Film className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-sm font-medium">{v.title}</div>
                      <div className="text-xs text-muted-foreground">{formatDuration(v.duration)} · {timeAgo(v.createdAt)}</div>
                    </div>
                    <StatusBadge status={v.status} />
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-6">
          {/* Upcoming schedule */}
          <Card className="border-border/60">
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Upcoming schedule</CardTitle>
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => setView("calendar")}>
                Calendar <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent>
              {data.upcoming.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Nothing scheduled yet</p>
              ) : (
                <div className="space-y-2">
                  {data.upcoming.slice(0, 4).map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 p-2.5">
                      <span className="line-clamp-1 text-sm">{u.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {u.scheduledAt ? new Date(u.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Monthly usage */}
          <Card className="border-border/60">
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Monthly usage</CardTitle>
              <Gauge className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-4">
              {plan && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{plan.name} plan</span>
                    <span>{plan.shortsUsed}/{plan.shortsLimit} Shorts</span>
                  </div>
                  <Progress value={planPct} />
                </div>
              )}
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Coins className="h-3.5 w-3.5" /> Credits spent
                  </span>
                  <span>{data.usage.spentThisMonth}/{data.usage.monthlyCap}</span>
                </div>
                <Progress value={capPct} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Credit balance</span>
                <span className="font-semibold text-primary">{data.usage.balance}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
