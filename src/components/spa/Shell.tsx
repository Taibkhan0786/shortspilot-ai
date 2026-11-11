"use client";

import { useEffect, useState } from "react";
import { useApp, ViewId } from "./store";
import { api, toastError } from "./api";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Rocket, LayoutDashboard, Wand2, Lightbulb, FileText, Mic, ImageIcon, Film,
  CalendarDays, Bot, Youtube, BarChart3, CreditCard, Gauge, Settings as SettingsIcon, ShieldCheck,
  Bell, LogOut, Menu, CheckCheck, Sparkles, ChevronRight, AlertTriangle, CloudUpload, Clock3,
} from "lucide-react";
import { Dashboard } from "./Dashboard";
import { Studio } from "./Studio";
import { Ideas } from "./Ideas";
import { Scripts } from "./Scripts";
import { VoiceLibrary } from "./VoiceLibrary";
import { MediaLibrary } from "./MediaLibrary";
import { VideoLibrary } from "./VideoLibrary";
import { Calendar } from "./CalendarView";
import { Automation } from "./Automation";
import { Channels } from "./Channels";
import { Analytics } from "./Analytics";
import { Billing } from "./Billing";
import { UsageView } from "./UsageView";
import { Settings } from "./Settings";
import { Admin } from "./Admin";

const NAV: { id: ViewId; label: string; icon: typeof LayoutDashboard; group: string; adminOnly?: boolean }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, group: "Overview" },
  { id: "studio", label: "AI Studio", icon: Wand2, group: "Create" },
  { id: "ideas", label: "Content Ideas", icon: Lightbulb, group: "Create" },
  { id: "scripts", label: "Scripts", icon: FileText, group: "Create" },
  { id: "voice", label: "Voice Library", icon: Mic, group: "Create" },
  { id: "media", label: "Media Library", icon: ImageIcon, group: "Create" },
  { id: "videos", label: "Video Library", icon: Film, group: "Manage" },
  { id: "calendar", label: "Content Calendar", icon: CalendarDays, group: "Manage" },
  { id: "automation", label: "Automation", icon: Bot, group: "Manage" },
  { id: "channels", label: "YouTube Channels", icon: Youtube, group: "Manage" },
  { id: "analytics", label: "Analytics", icon: BarChart3, group: "Grow" },
  { id: "billing", label: "Billing", icon: CreditCard, group: "Grow" },
  { id: "usage", label: "Usage & Credits", icon: Gauge, group: "Grow" },
  { id: "settings", label: "Account Settings", icon: SettingsIcon, group: "Grow" },
  { id: "admin", label: "Admin Console", icon: ShieldCheck, group: "Grow", adminOnly: true },
];

const GROUPS = ["Overview", "Create", "Manage", "Grow"];

const NOTIF_ICON: Record<string, typeof FileText> = {
  script_ready: FileText,
  render_started: Film,
  video_ready: Film,
  upload_started: CloudUpload,
  upload_success: CloudUpload,
  generation_failed: AlertTriangle,
  usage_limit: Gauge,
  oauth_expired: Youtube,
  scheduled_published: Clock3,
  info: Bell,
};

export function Shell() {
  const { user, view, setView, unread, setUnread, subscription, profile, setSession, setAuthMode, openLink } = useApp();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; type: string; title: string; body?: string; link?: string | null; readAt?: string | null; createdAt: string }[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = () =>
      api
        .get<{ notifications: typeof notifications; unread: number }>("/api/v1/notifications?limit=15")
        .then((d) => {
          if (!alive) return;
          setNotifications(d.notifications);
          setUnread(d.unread);
        })
        .catch(() => {});
    poll();
    const t = setInterval(poll, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [setUnread]);

  /** Click a notification → mark read + open the linked view/resource. */
  async function openNotification(n: (typeof notifications)[number]) {
    if (!n.readAt) {
      // optimistic update
      setNotifications((ns) => ns.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnread(Math.max(0, unread - 1));
      api.post(`/api/v1/notifications/${n.id}/read`).then((d: unknown) => {
        const unreadCount = (d as { unread?: number })?.unread;
        if (typeof unreadCount === "number") setUnread(unreadCount);
      }).catch(() => {});
    }
    setNotifOpen(false);
    if (n.link) openLink(n.link);
  }

  async function markAllRead() {
    try {
      await api.post("/api/v1/notifications/read-all");
      setUnread(0);
      setNotifications((ns) => ns.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    } catch (e) {
      toastError(e);
    }
  }

  async function logout() {
    try {
      await api.post("/api/v1/auth/logout");
      setSession({ user: null });
      setView("dashboard");
      setAuthMode("login");
      useApp.setState({ authOpen: false });
      toast.success("Signed out");
    } catch (e) {
      toastError(e);
    }
  }

  const nav = NAV.filter((n) => !n.adminOnly || user?.role === "ADMIN");

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-border/60 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-violet-600">
          <Rocket className="h-4 w-4 text-white" />
        </div>
        <span className="font-bold tracking-tight">ShortsPilot<span className="text-primary"> AI</span></span>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="App sections">
        {GROUPS.map((g) => {
          const items = nav.filter((n) => n.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">{g}</div>
              <div className="space-y-0.5">
                {items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => {
                      setView(n.id);
                      setMobileOpen(false);
                    }}
                    aria-current={view === n.id ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      view === n.id
                        ? "bg-primary/15 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <n.icon className="h-4 w-4 shrink-0" />
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-border/60 p-4">
        <div className="rounded-lg bg-card/60 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {subscription?.plan?.name ?? "Free Trial"} plan
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {subscription?.plan?.shortsLimit ?? 3} Shorts/month · {profile?.approvalMode ?? "approval"} mode
          </p>
          <Button size="sm" variant="outline" className="mt-2.5 w-full h-8" onClick={() => setView("billing")}>
            Manage plan
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border/60 bg-card/30 lg:block">
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open menu"><Menu className="h-5 w-5" /></Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">{sidebar}</SheetContent>
            </Sheet>
            <div className="flex items-center gap-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-rose-500 to-violet-600">
                <Rocket className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="font-bold">ShortsPilot</span>
            </div>
          </div>
          <div className="hidden lg:block" />

          <div className="flex items-center gap-2">
            <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unread} unread)`}>
                  <Bell className="h-5 w-5" />
                  {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-96 max-w-[92vw]">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-semibold">Notifications</span>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={markAllRead}>
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </Button>
                </div>
                <DropdownMenuSeparator />
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 && (
                    <p className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications yet</p>
                  )}
                  {notifications.map((n) => {
                    const Icon = NOTIF_ICON[n.type] ?? Bell;
                    return (
                      <DropdownMenuItem
                        key={n.id}
                        onClick={() => void openNotification(n)}
                        className={cn(
                          "group flex cursor-pointer flex-col items-start gap-0.5 px-3 py-2.5 focus:bg-accent/50"
                        )}
                        aria-label={`${n.title}${n.link ? " — click to open" : ""}`}
                      >
                        <div className="flex w-full items-center gap-2">
                          {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                          <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", n.readAt ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary")}>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="line-clamp-1 flex-1 text-sm font-medium">{n.title}</span>
                          {n.link && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />}
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {n.body && <p className="line-clamp-2 pl-8 text-xs text-muted-foreground">{n.body}</p>}
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-violet-600 text-sm font-bold text-white" aria-label="Account menu">
                  {user?.name?.charAt(0).toUpperCase() ?? "U"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{user?.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">{user?.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setView("settings")}>
                  <SettingsIcon className="mr-2 h-4 w-4" /> Account settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setView("usage")}>
                  <Gauge className="mr-2 h-4 w-4" /> Usage & credits
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Main */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            {view === "dashboard" && <Dashboard />}
            {view === "studio" && <Studio />}
            {view === "ideas" && <Ideas />}
            {view === "scripts" && <Scripts />}
            {view === "voice" && <VoiceLibrary />}
            {view === "media" && <MediaLibrary />}
            {view === "videos" && <VideoLibrary />}
            {view === "calendar" && <Calendar />}
            {view === "automation" && <Automation />}
            {view === "channels" && <Channels />}
            {view === "analytics" && <Analytics />}
            {view === "billing" && <Billing />}
            {view === "usage" && <UsageView />}
            {view === "settings" && <Settings />}
            {view === "admin" && <Admin />}
          </div>
        </main>

        {/* Sticky footer */}
        <footer className="mt-auto border-t border-border/60 py-4">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
            <span>© {new Date().getFullYear()} ShortsPilot AI — multi-tenant SaaS. YouTube OAuth 2.0 · Data API · sandbox adapter.</span>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> All systems operational
              </Badge>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
