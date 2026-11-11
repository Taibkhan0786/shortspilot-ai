"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, toastError } from "@/components/spa/api";
import { Clapperboard, Loader2, Lock, ShieldCheck } from "lucide-react";

const DEMO = { email: "admin@shortspilot.ai", password: "admin12345" };

export function LoginPanel({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/login", { email, password });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
            <Clapperboard className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight">ShortsPilot AI</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-400" /> Admin Console — sign in required
          </p>
        </div>

        <Card className="border-border/60">
          <CardContent className="p-6">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin-email">Admin email</Label>
                <Input
                  id="admin-email"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@shortspilot.ai"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-password">Password</Label>
                <Input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Lock className="mr-1 h-4 w-4" />}
                Sign in to console
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-4 rounded-xl border border-dashed border-border/60 bg-card/40 p-3.5 text-center text-xs text-muted-foreground">
          <p className="font-medium text-foreground/80">Instance credentials</p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed">
            {DEMO.email}<br />{DEMO.password}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1.5 h-7 text-xs"
            onClick={() => {
              setEmail(DEMO.email);
              setPassword(DEMO.password);
            }}
          >
            Fill demo credentials
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Only accounts with the <span className="font-mono text-[11px] text-foreground/80">ADMIN</span> role can open this console.
        </p>
      </div>
    </div>
  );
}
