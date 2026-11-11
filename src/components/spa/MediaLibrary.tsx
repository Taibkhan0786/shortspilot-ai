"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, SectionHeader, Spinner, timeAgo } from "./common";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { ImageIcon, RefreshCw, Repeat, Loader2 } from "lucide-react";

type Asset = {
  id: string; type: string; sceneNumber: number | null; assetUrl: string;
  prompt?: string | null; source: string; provider: string; createdAt: string;
  scriptId?: string | null;
};

export function MediaLibrary() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [regen, setRegen] = useState<Asset | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<{ assets: Asset[] }>("/api/v1/assets?limit=60")
      .then((d) => setAssets(d.assets))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  async function regenerate() {
    if (!regen) return;
    setBusy(true);
    try {
      await api.patch(`/api/v1/assets/${regen.id}`, prompt ? { prompt } : {});
      toast.success("Asset regenerated");
      setRegen(null);
      setPrompt("");
      load();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-primary" /></div>;

  return (
    <div>
      <SectionHeader title="Media Library" description="Every AI-generated scene visual, with provenance and license info." />
      {assets.length === 0 ? (
        <EmptyState
          icon={<ImageIcon className="h-6 w-6" />}
          title="No media yet"
          description="Scene visuals generated in the AI Studio are stored here with their prompts and license records."
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {assets.map((a) => (
            <Card key={a.id} className="group overflow-hidden border-border/60">
              <CardContent className="p-0">
                <div className="relative aspect-[768/1344] overflow-hidden bg-muted">
                  { }
                  <img src={a.assetUrl} alt={a.prompt?.slice(0, 60) || "Generated asset"} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  {a.sceneNumber && (
                    <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      S{a.sceneNumber}
                    </span>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground" title={a.prompt ?? ""}>
                    {a.prompt || "—"}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/70">{timeAgo(a.createdAt)} · {a.source}</span>
                    <Button
                      size="sm" variant="ghost" className="h-7 w-7 p-0"
                      aria-label="Regenerate asset"
                      onClick={() => {
                        setRegen(a);
                        setPrompt(a.prompt ?? "");
                      }}
                    >
                      <Repeat className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(regen)} onOpenChange={(o) => !o && setRegen(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Regenerate asset {regen?.sceneNumber ? `(scene ${regen.sceneNumber})` : ""}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {regen && (
              <div className="mx-auto w-32 overflow-hidden rounded-lg border border-border/60">
                { }
                <img src={regen.assetUrl} alt="Current asset" className="w-full" />
              </div>
            )}
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Visual prompt" className="min-h-24" />
            <Button onClick={regenerate} disabled={busy || !prompt} className="w-full">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Regenerate (1.5 credits)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
