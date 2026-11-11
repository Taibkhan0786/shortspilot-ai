"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pagination, Spinner, timeAgo } from "./common";
import { api } from "@/components/spa/api";
import { Search, RefreshCw } from "lucide-react";

type AuditRow = {
  id: string; action: string; resourceType: string | null; resourceId: string | null;
  meta: string | null; createdAt: string;
  user: { email: string; name: string } | null;
};

const PAGE_SIZE = 40;

export function AuditPanel() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get<{ logs: AuditRow[]; total: number }>(`/api/v1/admin/audit?q=${encodeURIComponent(q)}&page=${page}&limit=${PAGE_SIZE}`)
      .then((d) => {
        setLogs(d.logs);
        setTotal(d.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [q, page]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  function onSearch(v: string) {
    setSearchText(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setQ(v);
      setPage(1);
    }, 350);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={searchText} onChange={(e) => onSearch(e.target.value)} placeholder="Search action, resource, user email…" className="pl-8" aria-label="Search audit log" />
        </div>
        <Button variant="outline" size="sm" onClick={load} className="shrink-0">
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>
      ) : (
        <>
          <Card className="border-border/60">
            <CardContent className="p-0">
              <table className="hidden w-full text-sm md:table">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-3 py-3 font-medium">Actor</th>
                    <th className="px-3 py-3 font-medium">Action</th>
                    <th className="px-3 py-3 font-medium">Resource</th>
                    <th className="px-4 py-3 font-medium">Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((a) => (
                    <tr key={a.id} className="border-b border-border/40 last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</td>
                      <td className="max-w-44 truncate px-3 py-2.5 font-medium">{a.user?.email ?? "system"}</td>
                      <td className="px-3 py-2.5"><span className="font-mono text-xs">{a.action}</span></td>
                      <td className="max-w-40 truncate px-3 py-2.5 text-xs text-muted-foreground">
                        {a.resourceType ?? "—"}{a.resourceId ? `:${a.resourceId}` : ""}
                      </td>
                      <td className="max-w-56 truncate px-4 py-2.5 text-xs text-muted-foreground" title={a.meta ?? undefined}>
                        {a.meta ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-2 p-3 md:hidden">
                {logs.map((a) => (
                  <div key={a.id} className="rounded-lg border border-border/50 p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs font-medium">{a.action}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.user?.email ?? "system"} · {a.resourceType ?? "—"}</p>
                  </div>
                ))}
              </div>
              {logs.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No audit entries match this search.</p>}
            </CardContent>
          </Card>
          <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />
        </>
      )}
    </div>
  );
}
