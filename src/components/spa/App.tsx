"use client";

import { useEffect } from "react";
import { useApp } from "./store";
import { api } from "./api";
import { Landing } from "./Landing";
import { Auth } from "./Auth";
import { Onboarding } from "./Onboarding";
import { Shell } from "./Shell";
import { SupportChat } from "./SupportChat";
import { Spinner } from "./common";
import { toast } from "sonner";

export function App() {
  const { booted, user, profile, view, setSession, setBooted, setView } = useApp();

  useEffect(() => {
    api
      .get<{
        user: null | { id: string; email: string; name: string; role: string };
        profile?: unknown;
        subscription?: unknown;
        unreadNotifications?: number;
      }>("/api/v1/auth/me")
      .then((me) => {
        setSession({
          user: me.user,
          profile: (me.profile ?? null) as never,
          subscription: (me.subscription ?? null) as never,
          unreadNotifications: me.unreadNotifications ?? 0,
        });

        // OAuth round-trips: Google sign-in (?auth=google&status=...) and
        // YouTube channel connect (?yt=connected|error)
        const params = new URLSearchParams(window.location.search);
        const yt = params.get("yt");
        const authProvider = params.get("auth"); // "google"
        const authStatus = params.get("status"); // "ok" | "error"
        const authMsg = params.get("msg");

        if (authProvider === "google" && authStatus === "ok") {
          toast.success("Signed in with Google — welcome!");
        } else if (authProvider === "google" && authStatus === "error") {
          toast.error(`Google sign-in failed: ${authMsg || "unknown error"}`);
        }

        if (yt && me.user) {
          if (yt === "connected") {
            toast.success("YouTube channel connected — real-time dashboard ready!");
            setView("channels");
          } else if (yt === "error") {
            toast.error(`YouTube connect failed: ${params.get("msg") || "unknown error"}`);
            setView("channels");
          }
        }

        if (yt || authProvider) window.history.replaceState(null, "", window.location.pathname);
      })
      .catch(() => setSession({ user: null }))
      .finally(() => setBooted(true));
  }, [setSession, setBooted, setView]);

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  let page: React.ReactNode;
  if (!user) {
    const { view, authOpen } = useApp.getState();
    page = view === "dashboard" && !authOpen ? <Landing /> : <Auth />;
  } else if (profile && !profile.onboarded && view !== "onboarding" && view !== "settings") {
    page = <Onboarding />;
  } else if (view === "onboarding") {
    page = <Onboarding />;
  } else {
    page = <Shell />;
  }

  return (
    <>
      {page}
      <SupportChat />
    </>
  );
}
