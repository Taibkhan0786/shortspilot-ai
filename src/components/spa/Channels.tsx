"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, EmptyState, SectionHeader, Spinner } from "./common";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { toast } from "sonner";
import {
  Youtube, Loader2, Plus, Trash2, Users, Eye, Film, ThumbsUp, MessageSquare,
  ArrowLeft, RefreshCw, ExternalLink, Settings2, Radio, TrendingUp, Info, KeyRound, FlaskConical,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";

// ---------------- types ----------------

type Channel = {
  id: string; channelId: string; channelTitle: string; handle?: string | null;
  thumbnail?: string | null; subscribers: number; viewCount: number; videoCount: number;
  status: string; mode: string; connectedAt: string; lastSyncedAt?: string | null;
  lastSyncError?: string | null; country?: string | null;
  settings?: { niche: string; language: string } | null;
};

type DashboardData = {
  channel: Channel;
  totals: {
    subscribers: number; views: number; videos: number; avgViewsPerVideo: number;
    recentUploads: number; recentViews: number; recentLikes: number; recentComments: number;
  };
  growth: { at: string; subscribers: number; views: number; videoCount: number }[];
  videos: { videoId: string; title: string; thumbnail?: string | null; publishedAt: string; views: number; likes: number; comments: number; url: string }[];
  stale: boolean; syncNote: string | null; lastSyncedAt: string | null;
};

type YtConfig = {
  oauth: { configured: boolean; source: "db" | null };
  apiKey: { configured: boolean };
  redirectUri: string;
};

// ---------------- helpers ----------------

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const MODE_BADGE: Record<string, { label: string; cls: string }> = {
  oauth: { label: "OAUTH 2.0", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  apikey: { label: "API KEY", cls: "bg-violet-500/15 text-violet-600 border-violet-500/30" },
  sandbox: { label: "SANDBOX", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
};

// ================= main view =================

export function Channels() {
  const { subscription, user, focusResource, clearFocus } = useApp();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [config, setConfig] = useState<YtConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [dashboardId, setDashboardId] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<{ channels: Channel[] }>("/api/v1/channels")
      .then((d) => setChannels(d.channels))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    api.get<YtConfig>("/api/v1/youtube/config").then(setConfig).catch(() => {});
  }, [load]);

  // notification deep link → open that channel's dashboard directly
  useEffect(() => {
    if (focusResource && !loading) {
      const id = focusResource;
      const t = setTimeout(() => {
        if (channels.some((c) => c.id === id)) setDashboardId(id);
        clearFocus();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [focusResource, loading, channels, clearFocus]);

  async function disconnect(id: string) {
    try {
      await api.del(`/api/v1/channels/${id}`);
      setChannels((l) => l.filter((c) => c.id !== id));
      toast.success("Channel disconnected — tokens destroyed");
    } catch (e) {
      toastError(e);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  if (dashboardId) {
    const ch = channels.find((c) => c.id === dashboardId);
    if (ch) {
      return (
        <ChannelDashboard
          channel={ch}
          onBack={() => {
            setDashboardId(null);
            load();
          }}
        />
      );
    }
  }

  const limit = subscription?.plan?.channelsLimit ?? 1;

  return (
    <div>
      <SectionHeader
        title="YouTube Channels"
        description="Connect your real YouTube channel via Google OAuth 2.0 and watch a live dashboard — subscribers, views, likes, comments and growth."
        actions={
          <Button onClick={() => setOpen(true)} disabled={channels.length >= limit}>
            <Plus className="mr-2 h-4 w-4" /> Connect channel
          </Button>
        }
      />

      {channels.length === 0 ? (
        <EmptyState
          icon={<Youtube className="h-6 w-6" />}
          title="No channels connected"
          description="Connect a real YouTube channel with OAuth 2.0, pull public stats with an API key, or explore in sandbox mode."
          action={<Button onClick={() => setOpen(true)}>Connect your first channel</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {channels.map((c) => {
            const badge = MODE_BADGE[c.mode] ?? MODE_BADGE.sandbox;
            return (
              <Card key={c.id} className="border-border/60">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {c.thumbnail ? (
                        <img src={c.thumbnail} alt={`${c.channelTitle} avatar`} className="h-11 w-11 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-violet-600">
                          <Youtube className="h-5 w-5 text-white" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{c.channelTitle}</h3>
                        <p className="truncate text-xs text-muted-foreground">{c.handle || c.channelId}</p>
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-card/60 px-2 py-2">
                      <div className="flex items-center justify-center gap-1 text-sm font-semibold"><Users className="h-3.5 w-3.5 text-muted-foreground" /> {fmt(c.subscribers)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Subs</div>
                    </div>
                    <div className="rounded-lg bg-card/60 px-2 py-2">
                      <div className="flex items-center justify-center gap-1 text-sm font-semibold"><Eye className="h-3.5 w-3.5 text-muted-foreground" /> {fmt(c.viewCount)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Views</div>
                    </div>
                    <div className="rounded-lg bg-card/60 px-2 py-2">
                      <div className="flex items-center justify-center gap-1 text-sm font-semibold"><Film className="h-3.5 w-3.5 text-muted-foreground" /> {fmt(c.videoCount)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Videos</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>{badge.label}</Badge>
                    <span>Synced {timeAgo(c.lastSyncedAt)}</span>
                    {c.lastSyncError && <span className="text-destructive">· sync error</span>}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <Button size="sm" onClick={() => setDashboardId(c.id)} disabled={c.mode === "sandbox"} title={c.mode === "sandbox" ? "Real-time dashboard needs an OAuth or API-key connection" : undefined}>
                      <Radio className="mr-1.5 h-3.5 w-3.5" /> Live dashboard
                    </Button>
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => disconnect(c.id)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Disconnect
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConnectDialog
        open={open}
        onOpenChange={setOpen}
        config={config}
        reloadConfig={() => api.get<YtConfig>("/api/v1/youtube/config").then(setConfig).catch(() => {})}
        isAdmin={user?.role === "ADMIN"}
        onConnected={load}
      />
    </div>
  );
}

// ================= connect dialog =================

function ConnectDialog({
  open, onOpenChange, config, reloadConfig, isAdmin, onConnected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: YtConfig | null;
  reloadConfig: () => void;
  isAdmin: boolean;
  onConnected: () => void;
}) {
  const [tab, setTab] = useState<"oauth" | "apikey" | "sandbox">("oauth");
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const oauthReady = config?.oauth.configured ?? false;
  const apiKeyReady = config?.apiKey.configured ?? false;

  function reset() {
    setTitle(""); setHandle(""); setBusy(false);
  }

  async function connectSandbox() {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/v1/channels", { channelTitle: title.trim() });
      toast.success("Sandbox channel connected");
      reset();
      onOpenChange(false);
      onConnected();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function connectApiKey() {
    if (!handle.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/v1/youtube/sync", { action: "connect-apikey", handle: handle.trim() });
      toast.success("Real channel connected — live stats enabled");
      reset();
      onOpenChange(false);
      onConnected();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    if (!clientId.trim() && !clientSecret.trim() && !apiKeyInput.trim()) return;
    setSavingConfig(true);
    try {
      const body: Record<string, string> = {};
      if (clientId.trim()) body.googleClientId = clientId.trim();
      if (clientSecret.trim()) body.googleClientSecret = clientSecret.trim();
      if (apiKeyInput.trim()) body.youtubeApiKey = apiKeyInput.trim();
      await api.post("/api/v1/youtube/config", body);
      toast.success("Credentials saved (encrypted at rest)");
      setClientId(""); setClientSecret(""); setApiKeyInput("");
      reloadConfig();
    } catch (e) {
      toastError(e);
    } finally {
      setSavingConfig(false);
    }
  }

  const tabs: { id: typeof tab; label: string; icon: typeof Youtube; ready: boolean }[] = [
    { id: "oauth", label: "OAuth 2.0", icon: Youtube, ready: oauthReady },
    { id: "apikey", label: "API key", icon: KeyRound, ready: apiKeyReady },
    { id: "sandbox", label: "Sandbox", icon: FlaskConical, ready: true },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a YouTube channel</DialogTitle>
          <DialogDescription>
            Real-time dashboards need a live connection — sign in with Google (OAuth 2.0) or pull public stats with a YouTube Data API key.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5 rounded-lg bg-muted/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
              {!t.ready && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="not configured" />}
            </button>
          ))}
        </div>

        {tab === "oauth" && (
          <div className="space-y-3">
            {oauthReady ? (
              <>
                <a href="/api/v1/youtube/auth" className="block">
                  <Button className="w-full" size="lg">
                    <Youtube className="mr-2 h-4 w-4" /> Sign in with Google
                  </Button>
                </a>
                <p className="text-center text-[11px] text-muted-foreground">
                  You&apos;ll be redirected to Google&apos;s consent screen (youtube.readonly + youtube.upload scopes) and back here.
                </p>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg bg-card/60 p-3 text-xs text-muted-foreground">
                  <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground"><Settings2 className="h-3.5 w-3.5" /> One-time setup (admin)</div>
                  <ol className="list-inside list-decimal space-y-0.5">
                    <li>Open <span className="font-mono">console.cloud.google.com</span> → APIs &amp; Services → enable <b>YouTube Data API v3</b></li>
                    <li>Create <b>OAuth client ID</b> (type: Web application)</li>
                    <li>Add this authorized redirect URI:</li>
                  </ol>
                  <code className="mt-1.5 block break-all rounded bg-muted px-2 py-1 font-mono text-[10px]">{config?.redirectUri ?? "…"}</code>
                </div>
                {isAdmin ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="gcid">Google Client ID</Label>
                      <Input id="gcid" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="gcsec">Google Client Secret</Label>
                      <Input id="gcsec" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder="GOCSP-…" />
                    </div>
                    <Button className="w-full" onClick={saveConfig} disabled={savingConfig || !clientId.trim() || !clientSecret.trim()}>
                      {savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings2 className="mr-2 h-4 w-4" />}
                      Save &amp; enable OAuth
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Ask an admin to configure the Google OAuth client for this instance.</p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "apikey" && (
          <div className="space-y-3">
            {apiKeyReady ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="chandle">Channel @handle, URL or ID</Label>
                  <Input id="chandle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@mkbhd or https://youtube.com/@mkbhd" />
                </div>
                <Button className="w-full" onClick={connectApiKey} disabled={busy || !handle.trim()}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                  Connect &amp; load live stats
                </Button>
                <p className="text-[11px] text-muted-foreground">Public stats mode: subscribers, views and recent uploads sync in real time (no uploads).</p>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-lg bg-card/60 p-3 text-xs text-muted-foreground">
                  <div className="mb-1.5 font-medium text-foreground">Setup (admin)</div>
                  Get a free YouTube Data API v3 key from Google Cloud Console, then paste it below.
                </div>
                {isAdmin ? (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="ykey">YouTube Data API v3 key</Label>
                      <Input id="ykey" type="password" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)} placeholder="AIza…" />
                    </div>
                    <Button className="w-full" onClick={saveConfig} disabled={savingConfig || !apiKeyInput.trim()}>
                      {savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Settings2 className="mr-2 h-4 w-4" />}
                      Save API key
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Ask an admin to configure a YouTube API key for this instance.</p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "sandbox" && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ctitle">Channel name</Label>
              <Input id="ctitle" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My Awesome Channel" />
            </div>
            <div className="flex gap-2 rounded-lg bg-card/60 p-3 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Sandbox mode connects a simulated channel so you can exercise the full publishing pipeline without a real YouTube connection.
            </div>
            <Button onClick={connectSandbox} disabled={busy || !title.trim()} className="w-full">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
              Connect sandbox channel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ================= real-time channel dashboard =================

function ChannelDashboard({ channel, onBack }: { channel: Channel; onBack: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tick, setTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await api.get<DashboardData>(`/api/v1/channels/${channel.id}/dashboard`);
      setData(d);
    } catch (e) {
      if (!silent) toastError(e);
    } finally {
      setLoading(false);
    }
  }, [channel.id]);

  useEffect(() => {
    void fetchDashboard();
    // real-time: poll every 60s (server auto-syncs from YouTube when data is >60s old)
    pollRef.current = setInterval(() => {
      void fetchDashboard(true);
      setTick((t) => t + 1);
    }, 60_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchDashboard]);

  async function syncNow() {
    setSyncing(true);
    try {
      await api.post("/api/v1/youtube/sync", { action: "sync", channelId: channel.id });
      await fetchDashboard(true);
      toast.success("Synced with YouTube");
    } catch (e) {
      toastError(e);
    } finally {
      setSyncing(false);
    }
  }

  if (loading && !data) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;
  if (!data) return null;

  const badge = MODE_BADGE[data.channel.mode] ?? MODE_BADGE.sandbox;
  const ch = data.channel;
  const t = data.totals;

  const kpis = [
    { label: "Subscribers", value: fmt(t.subscribers), icon: Users, hint: "live from YouTube" },
    { label: "Total views", value: fmt(t.views), icon: Eye, hint: "lifetime" },
    { label: "Videos", value: fmt(t.videos), icon: Film, hint: "on channel" },
    { label: "Avg views / video", value: fmt(t.avgViewsPerVideo), icon: TrendingUp, hint: "lifetime" },
    { label: "Likes", value: fmt(t.recentLikes), icon: ThumbsUp, hint: `last ${t.recentUploads} uploads` },
    { label: "Comments", value: fmt(t.recentComments), icon: MessageSquare, hint: `last ${t.recentUploads} uploads` },
  ];

  const chartData = data.growth.map((g) => ({
    at: new Date(g.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    subscribers: g.subscribers,
    views: g.views,
  }));

  return (
    <div>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to channels"><ArrowLeft className="h-5 w-5" /></Button>
          {ch.thumbnail ? (
            <img src={ch.thumbnail} alt={`${ch.channelTitle} avatar`} className="h-12 w-12 rounded-full object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-violet-600">
              <Youtube className="h-6 w-6 text-white" />
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold leading-tight">{ch.channelTitle}</h2>
              <Badge variant="outline" className={`text-[10px] ${badge.cls}`}>{badge.label}</Badge>
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600" title="Auto-refreshes every 60 seconds">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                LIVE
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {ch.handle || ch.channelId}{ch.country ? ` · ${ch.country}` : ""} · synced {timeAgo(data.lastSyncedAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sync now
          </Button>
          <a href={`https://www.youtube.com/channel/${ch.channelId}`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm"><ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open on YouTube</Button>
          </a>
        </div>
      </div>

      {data.stale && data.syncNote && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Showing cached stats — live sync issue: {data.syncNote}</span>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className="border-border/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <k.icon className="h-3.5 w-3.5" /> {k.label}
              </div>
              <div className="mt-1.5 text-2xl font-bold tabular-nums">{k.value}</div>
              <div className="text-[10px] text-muted-foreground">{k.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* growth chart */}
      <Card className="mt-4 border-border/60">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" /> Channel growth</h3>
            <span className="text-[11px] text-muted-foreground">captured on every sync · {chartData.length} datapoint{chartData.length === 1 ? "" : "s"}</span>
          </div>
          {chartData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No growth data yet — it builds up automatically as the dashboard syncs.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="at" tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" />
                  <YAxis yAxisId="subs" tick={{ fontSize: 11 }} tickFormatter={fmt} stroke="currentColor" className="text-muted-foreground" width={48} />
                  <YAxis yAxisId="views" orientation="right" tick={{ fontSize: 11 }} tickFormatter={fmt} stroke="currentColor" className="text-muted-foreground" width={48} />
                  <Tooltip formatter={(v: number | string) => Number(v).toLocaleString()} labelStyle={{ color: "currentColor" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="subs" type="monotone" dataKey="subscribers" name="Subscribers" stroke="#f43f5e" strokeWidth={2} dot={false} />
                  <Line yAxisId="views" type="monotone" dataKey="views" name="Views" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* recent uploads */}
      <Card className="mt-4 border-border/60">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Film className="h-4 w-4 text-primary" /> Recent uploads</h3>
            <span className="text-[11px] text-muted-foreground">{t.recentUploads} newest · auto-refreshes</span>
          </div>
          {data.videos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No uploads found on this channel{ch.mode === "oauth" ? "" : " (or not accessible in public stats mode)"}.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-smooth">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background/95 backdrop-blur">
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Video</th>
                    <th className="py-2 px-2 text-right font-medium">Views</th>
                    <th className="py-2 px-2 text-right font-medium">Likes</th>
                    <th className="py-2 pl-2 text-right font-medium">Comments</th>
                    <th className="py-2 pl-3 text-right font-medium">Published</th>
                  </tr>
                </thead>
                <tbody>
                  {data.videos.map((v) => (
                    <tr key={v.videoId} className="border-b border-border/40 transition-colors hover:bg-accent/40">
                      <td className="py-2 pr-3">
                        <a href={v.url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 group">
                          {v.thumbnail ? (
                            <img src={v.thumbnail} alt="" className="h-9 w-16 shrink-0 rounded object-cover" />
                          ) : (
                            <div className="flex h-9 w-16 shrink-0 items-center justify-center rounded bg-muted"><Youtube className="h-4 w-4 text-muted-foreground" /></div>
                          )}
                          <span className="line-clamp-2 max-w-[280px] group-hover:text-primary group-hover:underline">{v.title}</span>
                        </a>
                      </td>
                      <td className="px-2 text-right tabular-nums">{v.views.toLocaleString()}</td>
                      <td className="px-2 text-right tabular-nums text-muted-foreground">{v.likes.toLocaleString()}</td>
                      <td className="pl-2 text-right tabular-nums text-muted-foreground">{v.comments.toLocaleString()}</td>
                      <td className="pl-3 text-right text-xs text-muted-foreground">{timeAgo(v.publishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <span className="hidden">{tick}</span>
    </div>
  );
}
