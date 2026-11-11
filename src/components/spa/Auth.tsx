"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApp } from "./store";
import { api, toastError } from "./api";
import { toast } from "sonner";
import { Rocket, Loader2 } from "lucide-react";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function Auth() {
  const { authMode, setAuthMode, setSession, setView } = useApp();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isRegister = authMode === "register";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (isRegister) {
        await api.post("/api/v1/auth/register", { name, email, password });
        toast.success("Account created — welcome credits added!");
      } else {
        await api.post("/api/v1/auth/login", { email, password });
        toast.success("Welcome back!");
      }
      const me = await api.get<{ user: null | { id: string; email: string; name: string; role: string }; profile?: unknown; subscription?: unknown; unreadNotifications?: number }>("/api/v1/auth/me");
      setSession({ user: me.user, profile: me.profile as never, subscription: me.subscription as never, unreadNotifications: me.unreadNotifications });
      useApp.setState({ authOpen: false });
      if (me.profile && !(me.profile as { onboarded?: boolean }).onboarded) setView("onboarding");
      else setView("dashboard");
    } catch (err) {
      toastError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-violet-600">
            <Rocket className="h-4 w-4 text-white" />
          </div>
          <span className="text-xl font-bold">ShortsPilot<span className="text-primary"> AI</span></span>
        </div>
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle>{isRegister ? "Create your account" : "Sign in"}</CardTitle>
            <CardDescription>
              {isRegister ? "Start with 3 free Shorts and 25 credits." : "Welcome back — your channels are waiting."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <button
              type="button"
              onClick={() => {
                setGoogleLoading(true);
                window.location.href = "/api/v1/auth/google";
              }}
              disabled={googleLoading}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-border/60 bg-background px-4 text-sm font-medium transition-colors hover:bg-accent/50 disabled:opacity-60"
            >
              {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
              {googleLoading ? "Redirecting to Google…" : "Continue with Google"}
            </button>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wide">
                <span className="bg-card px-2 text-muted-foreground">or use email</span>
              </div>
            </div>
            <form onSubmit={submit} className="space-y-4">
              {isRegister && (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} placeholder="Alex Carter" autoComplete="name" />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@channel.com" autoComplete="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  required minLength={isRegister ? 8 : 1} placeholder={isRegister ? "At least 8 characters" : "Your password"}
                  autoComplete={isRegister ? "new-password" : "current-password"}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isRegister ? "Create account" : "Sign in"}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              {isRegister ? "Already have an account?" : "New to ShortsPilot?"}{" "}
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={() => setAuthMode(isRegister ? "login" : "register")}
              >
                {isRegister ? "Sign in" : "Create one free"}
              </button>
            </p>
            {isRegister && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                By creating an account you agree to publish only content you have rights to and to label AI-generated media where required.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
