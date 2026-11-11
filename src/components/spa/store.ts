"use client";

import { create } from "zustand";

export type ViewId =
  | "dashboard" | "studio" | "ideas" | "scripts" | "voice" | "media"
  | "videos" | "calendar" | "automation" | "channels" | "analytics"
  | "billing" | "usage" | "settings" | "admin" | "onboarding";

export type SessionUser = { id: string; email: string; name: string; role: string };
export type Profile = {
  niche: string; audience: string; language: string; scriptStyle: string;
  voiceId: string; voiceSpeed: number; visualStyle: string; duration: number;
  videosPerWeek: number; publishDays: string; publishTime: string;
  approvalMode: string; monthlyLimit: number; onboarded: boolean; timezone: string;
  displayName?: string | null;
};
export type Subscription = {
  plan: { id: string; name: string; price: number; shortsLimit: number; channelsLimit: number; watermark: boolean };
  status: string; periodEnd: string; cancelAtPeriodEnd: boolean;
};

type AppState = {
  booted: boolean;
  user: SessionUser | null;
  profile: Profile | null;
  subscription: Subscription | null;
  unread: number;
  view: ViewId;
  /** resource to scroll/highlight after navigating (from notification deep links) */
  focusResource: string | null;
  authMode: "login" | "register";
  authOpen: boolean;
  setBooted: (v: boolean) => void;
  setSession: (s: { user: SessionUser | null; profile?: Profile | null; subscription?: Subscription | null; unreadNotifications?: number }) => void;
  setUnread: (n: number) => void;
  setView: (v: ViewId) => void;
  setAuthMode: (m: "login" | "register") => void;
  setAuthOpen: (v: boolean) => void;
  setProfile: (p: Profile) => void;
  /** Parse a notification link ("view" or "view:resourceId") and navigate. */
  openLink: (link: string) => void;
  clearFocus: () => void;
};

const VALID_VIEWS: ViewId[] = [
  "dashboard", "studio", "ideas", "scripts", "voice", "media",
  "videos", "calendar", "automation", "channels", "analytics",
  "billing", "usage", "settings", "admin",
];

export const useApp = create<AppState>((set) => ({
  booted: false,
  user: null,
  profile: null,
  subscription: null,
  unread: 0,
  view: "dashboard",
  focusResource: null,
  authMode: "login",
  authOpen: false,
  setBooted: (v) => set({ booted: v }),
  setSession: (s) =>
    set({
      user: s.user,
      profile: s.profile ?? null,
      subscription: s.subscription ?? null,
      unread: s.unreadNotifications ?? 0,
    }),
  setUnread: (n) => set({ unread: n }),
  setView: (v) => set({ view: v, focusResource: null }),
  setAuthMode: (m) => set({ authMode: m, authOpen: true }),
  setAuthOpen: (v) => set({ authOpen: v }),
  setProfile: (p) => set({ profile: p }),
  openLink: (link) => {
    const [viewPart, resourceId] = link.split(":");
    const view = (VALID_VIEWS as string[]).includes(viewPart) ? (viewPart as ViewId) : "dashboard";
    set({ view, focusResource: resourceId ?? null });
  },
  clearFocus: () => set({ focusResource: null }),
}));
