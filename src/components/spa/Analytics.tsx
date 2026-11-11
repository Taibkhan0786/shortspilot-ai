"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionHeader, Spinner, formatDuration } from "./common";
import { api, toastError } from "./api";
import { toast } from "sonner";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { BarChart3, Sparkles, Eye, ThumbsUp, MessageSquare, Users, Clock, Lightbulb } from "lucide-react";
import { ExternalLink } from "lucide-react";

type AnalyticsData = {
  totals: { views: number; likes: number; comments: number; subs: number; watchTime: number; publishedCount: number; avgViewDuration: number };
  series: { date: string; views: number; likes: number }[];
  topVideos: { id: string; title: string; thumbnailUrl?: string | null; channel?: string; views: number; likes: number; comments: number; duration: number; youtubeUrl?: string | null; publishedAt?: string | null }[];
  dataSource: string;
  note: string;
};

type Recs = { recommendations: string[]; experiments: string[]; evidence: { videosAnalyzed: number; disclaimer: string } };

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [recs, setRecs] = useState<Recs | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [recsLoading, setRecsLoading] = useState(false);

  const load = useCallback(() => {
    api.get<AnalyticsData>(`/api/v1/analytics/overview?days=${days}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => load(), [load]);

  async function loadRecs() {
    setRecsLoading(true);
    try {
      setRecs(await api.get<Recs>("/api/v1/analytics/recommendations"));
    } catch (e) {
      toastError(e);
    } finally {
      setRecsLoading(false);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;
  if (!data) return null;

  const stats = [
    { label: "Views", value: data.totals.views, icon: Eye },
    { label: "Likes", value: data.totals.likes, icon: ThumbsUp },
    { label: "Comments", value: data.totals.comments, icon: MessageSquare },
    { label: "Subscribers gained", value: data.totals.subs, icon: Users },
    { label: "Watch time", value: formatDuration(data.totals.watchTime), icon: Clock },
    { label: "Avg view duration", value: `${data.totals.avgViewDuration}s`, icon: BarChart3 },
  ];

  return (
    <div>
      <SectionHeader
        title="Analytics"
        description="Performance of your published Shorts."
        actions={
          <div className="flex gap-1.5">
            {[7, 30, 90].map((d) => (
              <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
                {d}d
              </Button>
            ))}
          </div>
        }
      />

      {data.totals.publishedCount === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No analytics yet"
          description="Publish your first Short — metrics appear after the analytics sync runs."
        />
      ) : (
        <div className="space-y-6">
          {data.dataSource === "sandbox_sync" && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-300">
              Sandbox mode: metrics are simulated by the analytics sync worker. Connect a real channel with Google OAuth
              credentials to pull genuine YouTube Analytics data.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {stats.map((s) => (
              <Card key={s.label} className="border-border/60">
                <CardContent className="p-4">
                  <s.icon className="h-4 w-4 text-muted-foreground" />
                  <div className="mt-2 text-xl font-bold">{typeof s.value === "number" ? s.value.toLocaleString() : s.value}</div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-border/60">
            <CardHeader><CardTitle className="text-base">Views over time</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.series}>
                    <defs>
                      <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(244 63 94)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="rgb(244 63 94)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(63 63 70 / 0.4)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "rgb(161 161 170)" }} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11, fill: "rgb(161 161 170)" }} width={40} />
                    <Tooltip
                      contentStyle={{ background: "rgb(24 24 27)", border: "1px solid rgb(63 63 70)", borderRadius: 8, color: "#fafafa" }}
                      labelStyle={{ color: "rgb(161 161 170)" }}
                    />
                    <Area type="monotone" dataKey="views" stroke="rgb(244 63 94)" strokeWidth={2} fill="url(#viewsGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader><CardTitle className="text-base">Top performing Shorts</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {data.topVideos.map((v) => (
                <div key={v.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-2.5">
                  <div className="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
                    {v.thumbnailUrl && (
                       
                      <img src={v.thumbnailUrl} alt={v.title} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-sm font-medium">{v.title}</div>
                    <div className="text-xs text-muted-foreground">{v.views.toLocaleString()} views · {v.likes} likes · {v.comments} comments</div>
                  </div>
                  {v.youtubeUrl && (
                    <a href={v.youtubeUrl} target="_blank" rel="noreferrer" aria-label="Open on YouTube" className="text-primary hover:underline">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" /> AI Performance Optimizer
              </CardTitle>
              <Button size="sm" variant="outline" onClick={loadRecs} disabled={recsLoading}>
                {recsLoading ? <Spinner className="mr-2 h-3.5 w-3.5" /> : <Lightbulb className="mr-2 h-3.5 w-3.5" />}
                Analyze
              </Button>
            </CardHeader>
            <CardContent>
              {recs ? (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-sm font-medium">Recommendations</p>
                    <ul className="space-y-1.5">
                      {recs.recommendations.map((r, i) => (
                        <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {recs.experiments.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-medium">Suggested experiments</p>
                      <ul className="space-y-1.5">
                        {recs.experiments.map((r, i) => (
                          <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" /> {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{recs.evidence.disclaimer} ({recs.evidence.videosAnalyzed} videos analyzed)</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click “Analyze” to get evidence-based recommendations from your channel data.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
