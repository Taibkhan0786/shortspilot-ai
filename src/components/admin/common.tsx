"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

export { Spinner, timeAgo, StatusBadge, EmptyState } from "@/components/spa/common";

export function fmtMoney(n: number) {
  return `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function fmtN(n: number) {
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function AdminKpi({
  label, value, icon, sub, accent = "text-foreground",
}: {
  label: string; value: ReactNode; icon?: ReactNode; sub?: ReactNode; accent?: string;
}) {
  return (
    <Card className="border-border/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground/80">{icon}</span>}
      </div>
      <div className={cn("mt-1.5 text-2xl font-bold tabular-nums", accent)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

export function Pagination({
  page, total, limit, onPage,
}: {
  page: number; total: number; limit: number; onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <p className="text-xs text-muted-foreground">
        Page {page} of {pages} · {total.toLocaleString()} record{total === 1 ? "" : "s"}
      </p>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
