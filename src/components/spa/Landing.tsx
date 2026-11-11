"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useApp } from "./store";
import { PLAN_FALLBACK } from "./landing-data";
import { Rocket, Sparkles, Mic, ImageIcon, Film, CalendarClock, BarChart3, ShieldCheck, Check, Zap, Youtube, Clock, Layers } from "lucide-react";
import Image from "next/image";
import { useState, useEffect } from "react";
import { api } from "./api";

export function Landing() {
  const { setAuthMode } = useApp();
  const [plans, setPlans] = useState(PLAN_FALLBACK);

  useEffect(() => {
    api.get<{ plans: typeof PLAN_FALLBACK }>("/api/v1/billing/plans")
      .then((d) => setPlans(d.plans))
      .catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-violet-600">
              <Rocket className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">ShortsPilot<span className="text-primary"> AI</span></span>
          </div>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Main">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAuthMode("login")}>Sign in</Button>
            <Button size="sm" onClick={() => setAuthMode("register")}>Start free</Button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(244,63,94,0.13),transparent),radial-gradient(40%_40%_at_80%_20%,rgba(139,92,246,0.12),transparent)]" />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center">
            <div>
              <Badge variant="outline" className="mb-5 gap-1.5 border-primary/40 bg-primary/10 text-primary">
                <Sparkles className="h-3 w-3" /> AI-powered Shorts automation
              </Badge>
              <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                Turn a topic into a finished{" "}
                <span className="bg-gradient-to-r from-rose-500 to-violet-500 bg-clip-text text-transparent">YouTube Short</span>{" "}
                — on autopilot.
              </h1>
              <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
                ShortsPilot AI researches ideas, writes scripts, generates voiceovers and visuals, renders
                vertical videos with captions, checks quality, and uploads to YouTube on your schedule.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" className="gap-2" onClick={() => setAuthMode("register")}>
                  <Zap className="h-4 w-4" /> Start creating free
                </Button>
                <Button size="lg" variant="outline" onClick={() => setAuthMode("login")}>
                  Sign in
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Free trial: 3 Shorts · No credit card required</p>
            </div>
            <div className="relative">
              <div className="overflow-hidden rounded-2xl border border-border/60 shadow-2xl shadow-rose-500/5">
                <Image
                  src="/hero.png"
                  alt="ShortsPilot AI dashboard preview"
                  width={1344}
                  height={768}
                  className="h-auto w-full"
                  priority
                />
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="border-t border-border/60 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-2xl font-bold sm:text-3xl">Everything between idea and upload</h2>
              <p className="mt-3 text-muted-foreground">One platform for the entire short-form pipeline.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { icon: Sparkles, title: "AI idea engine", desc: "Trend-aware ideas with hooks and angles, grounded in web research with source tracking." },
                { icon: Layers, title: "Structured scripts", desc: "Scene-level scripts with narration, visual prompts, captions and CTAs — fully editable." },
                { icon: Mic, title: "AI voiceovers", desc: "7 voice personas with speed control. Preview, generate, and regenerate per scene." },
                { icon: ImageIcon, title: "Scene visuals", desc: "Vertical AI-generated visuals per scene in cinematic, cartoon, realistic or minimal styles." },
                { icon: Film, title: "Real MP4 rendering", desc: "1080×1920 H.264 with synced audio, caption overlays, zoom motion and quality checks." },
                { icon: CalendarClock, title: "Scheduling & automation", desc: "Approval or fully automatic publishing on your days, times and timezone." },
                { icon: BarChart3, title: "Analytics & optimizer", desc: "Track views, likes and watch time; get evidence-based AI recommendations." },
                { icon: Youtube, title: "YouTube ready", desc: "Official API adapter for uploads with idempotency, retries and sandbox mode." },
                { icon: ShieldCheck, title: "Secure multi-tenant SaaS", desc: "Isolated tenant data, encrypted tokens, audit logs and credit governance." },
              ].map((f) => (
                <Card key={f.title} className="border-border/60 bg-card/60 transition-colors hover:border-primary/30">
                  <CardContent className="p-5">
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <f.icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-border/60 bg-card/30 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-2xl font-bold sm:text-3xl">From brief to published in minutes</h2>
              <p className="mt-3 text-muted-foreground">The automated journey, step by step.</p>
            </div>
            <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { n: "01", title: "Configure", desc: "Pick your niche, audience, language, voice, visual style and schedule." },
                { n: "02", title: "Generate", desc: "AI researches the topic, writes the script, records the voice and paints every scene." },
                { n: "03", title: "Review", desc: "Preview the rendered Short with captions. Approve, tweak, or regenerate any part." },
                { n: "04", title: "Publish", desc: "Upload instantly or schedule. Automation can run the whole loop for you." },
              ].map((s) => (
                <li key={s.n} className="relative rounded-xl border border-border/60 bg-background p-5">
                  <span className="text-sm font-bold text-primary">{s.n}</span>
                  <h3 className="mt-2 font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="border-t border-border/60 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="mx-auto mb-12 max-w-2xl text-center">
              <h2 className="text-2xl font-bold sm:text-3xl">Simple, scalable pricing</h2>
              <p className="mt-3 text-muted-foreground">Start free. Upgrade when your channels grow.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {plans.map((p) => (
                <Card key={p.id} className={`flex flex-col border-border/60 ${p.id === "pro" ? "border-primary/60 shadow-lg shadow-primary/10" : ""}`}>
                  <CardContent className="flex flex-1 flex-col p-6">
                    {p.id === "pro" && <Badge className="mb-3 w-fit bg-primary text-primary-foreground">Most popular</Badge>}
                    <h3 className="font-semibold">{p.name}</h3>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-3xl font-bold">${p.price}</span>
                      <span className="text-sm text-muted-foreground">/month</span>
                    </div>
                    <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                      {(p.features as string[]).map((f) => (
                        <li key={f} className="flex items-start gap-2 text-muted-foreground">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Button className="mt-6 w-full" variant={p.id === "pro" ? "default" : "outline"} onClick={() => setAuthMode("register")}>
                      Get started
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* Sticky footer (natural push on overflow) */}
      <footer className="mt-auto border-t border-border/60 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" /> ShortsPilot AI — secure, multi-tenant SaaS
          </div>
          <div className="flex items-center gap-5">
            <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Sandboxed YouTube adapter active</span>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
