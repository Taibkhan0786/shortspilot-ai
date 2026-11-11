"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Lightbulb, CheckCircle2, XCircle, Loader2, Film, UploadCloud,
  CalendarClock, AlertTriangle, FileText, Mic, ImageIcon, Clock,
} from "lucide-react";
import type { ReactNode } from "react";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info"; icon?: ReactNode }> = {
  SUGGESTED: { label: "Suggested", variant: "secondary" },
  APPROVED: { label: "Approved", variant: "success" },
  REJECTED: { label: "Rejected", variant: "destructive" },
  USED: { label: "Used", variant: "info" },
  DRAFT: { label: "Draft", variant: "secondary" },
  RENDERING: { label: "Rendering", variant: "warning", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  QUALITY_CHECK: { label: "Quality check", variant: "info", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  PENDING_APPROVAL: { label: "Needs approval", variant: "warning", icon: <Clock className="h-3 w-3" /> },
  SCHEDULED: { label: "Scheduled", variant: "info", icon: <CalendarClock className="h-3 w-3" /> },
  PUBLISHED: { label: "Published", variant: "success", icon: <CheckCircle2 className="h-3 w-3" /> },
  FAILED: { label: "Failed", variant: "destructive", icon: <AlertTriangle className="h-3 w-3" /> },
  REJECTED_VIDEO: { label: "Rejected", variant: "destructive" },
  QUEUED: { label: "Queued", variant: "secondary" },
  RUNNING: { label: "Running", variant: "warning", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  DONE: { label: "Done", variant: "success" },
  PENDING: { label: "Pending", variant: "secondary" },
  UPLOADING: { label: "Uploading", variant: "warning", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  PROCESSING: { label: "Processing", variant: "info", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  CANCELLED: { label: "Cancelled", variant: "outline" },
  CONNECTED: { label: "Connected", variant: "success" },
  ACTIVE: { label: "Active", variant: "success" },
  TRIAL: { label: "Trial", variant: "info" },
  CANCELLED_SUB: { label: "Cancelled", variant: "outline" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const cfg = STATUS_MAP[status] ?? { label: status, variant: "secondary" as const };
  return (
    <Badge
      variant={cfg.variant === "success" || cfg.variant === "warning" || cfg.variant === "info" ? "outline" : cfg.variant}
      className={cn(
        "gap-1 font-medium",
        cfg.variant === "success" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        cfg.variant === "warning" && "border-amber-500/40 bg-amber-500/10 text-amber-400",
        cfg.variant === "info" && "border-sky-500/40 bg-sky-500/10 text-sky-400",
        className
      )}
    >
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

export function EmptyState({
  icon, title, description, action, className,
}: {
  icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-14 text-center", className)}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon ?? <Film className="h-6 w-6" />}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}

export const PIPELINE_ICONS = { Lightbulb, FileText, Mic, ImageIcon, Film, UploadCloud, CheckCircle2, XCircle };

export function formatDuration(s: number) {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function timeAgo(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export function PlayButton({ onClick, className }: { onClick?: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label="Play video"
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5 fill-current"><path d="M8 5v14l11-7z" /></svg>
    </button>
  );
}
