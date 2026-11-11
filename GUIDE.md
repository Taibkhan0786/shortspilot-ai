# ShortsPilot AI — Complete Setup Guide & Manual

> AI-powered YouTube Shorts automation platform: **Idea → Script → Voiceover → Visuals → Rendered Video → Approval → Publish**, with a real-time YouTube channel dashboard, plan-based limits, credit metering, notifications with deep links, and a full admin console.

---

## 1. What is ShortsPilot AI?

ShortsPilot AI is a multi-tenant SaaS that automates the entire YouTube Shorts production pipeline. You give it a **topic** (or let it research trending ideas), and it:

1. **Generates content ideas** with an LLM (search-grounded, niche-aware)
2. **Writes a scene-by-scene script** — hook → body scenes → CTA, with visual prompts & captions per scene
3. **Produces a natural voiceover** with TTS (Google AI Studio voices, ElevenLabs, or free Edge voices — speed control, per-scene or full narration)
4. **Creates cinematic AI visuals** for every scene (4 styles: cinematic / cartoon / realistic / minimalist)
5. **Renders a real vertical MP4** (9:16, 1080×1920) with FFmpeg — images + audio + captions
6. **Runs a quality check**, then sends the video to your **approval queue**
7. **Publishes to YouTube** (sandbox adapter, or uploads via a connected OAuth channel) — instantly or on a schedule, with full metadata (title, description, hashtags)
8. **Tracks your real channel** with a live dashboard: subscribers, views, likes, comments, growth chart, recent uploads

Everything is metered with **credits**, gated by **plan limits**, and observable through **notifications** (click a notification to jump to the related item), **analytics**, and an **admin console**.

---

## 2. How Everything Works (the pipeline)

```
 Topic / Idea
     │
     ▼
 ┌─────────┐   ┌─────────┐   ┌──────────┐   ┌─────────┐
 │  IDEAS   │──▶│ SCRIPTS │──▶│ VOICEOVER │──▶│ VISUALS │
 │ (LLM +   │   │ (LLM,   │   │ (TTS, 7   │   │ (Image  │
 │  search) │   │  scenes)│   │  voices)  │   │  gen)   │
 └─────────┘   └─────────┘   └──────────┘   └─────────┘
                                                  │
     ┌────────────────────────────────────────────┘
     ▼
 ┌───────────────────────────────────────────────────────┐
 │ RENDER WORKER (background, async job)                 │
 │  per-scene audio+image → FFmpeg segments → concat     │
 │  progress % → QUALITY_CHECK → PENDING_APPROVAL        │
 └───────────────────────────────────────────────────────┘
     │
     ▼ (you click Approve)
 ┌─────────────────┐    ┌──────────────────────────────┐
 │  PUBLISH JOB    │───▶│ YouTube (sandbox adapter or  │
 │ upload→process  │    │ real OAuth channel)          │
 │  → DONE         │    └──────────────────────────────┘
 └─────────────────┘
     │
     ▼
 📈 LIVE CHANNEL DASHBOARD (YouTube Data API, 60s refresh)
 🔔 NOTIFICATIONS with click-to-open deep links at every step
```

### Stage details

| Stage | What happens | Credits |
|---|---|---|
| **Idea generation** | LLM + optional web research produces trending ideas for your niche/language | 1 |
| **Script generation** | Structured scene JSON: hook, 4–8 scenes (narration + visualPrompt + caption), CTA, duration estimate. Regenerate makes a new version | 2 |
| **Voiceover** | Full narration track + per-scene audio chunks via TTS. Failed calls retry with exponential backoff. The admin picks which engine speaks first (Voice provider setting) | 4 |
| **Visuals** | One AI image per scene in your chosen style. Runs as an **async VisualJob** (never blocks HTTP — avoids gateway 502s); client polls `/visuals/status` for live progress. Rate-limited calls retry with backoff | 1.5/scene |
| **Render** | Background worker: builds each scene segment (image + audio), concatenates with FFmpeg, adds captions → 9:16 MP4. Credits refunded automatically on failure | 3 |
| **Quality check** | Worker validates duration/size, then sets `PENDING_APPROVAL` | — |
| **Publish** | Resumable-upload adapter (sandbox now; OAuth channels store encrypted refresh tokens for real uploads). Metadata auto-generated | 1 |
| **Sync (YouTube)** | Live fetch of channel stats + last 25 uploads; every sync appends a growth datapoint | free |

### Video status lifecycle

`DRAFT → RENDERING → QUALITY_CHECK → PENDING_APPROVAL → APPROVED → SCHEDULED → PUBLISHING → PUBLISHED` (also `FAILED`, `REJECTED`; failure auto-refunds render credits).

---

## 3. Architecture & Tech Stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16** (App Router) + **TypeScript 5** |
| UI | Tailwind CSS 4 + **shadcn/ui** (New York) + lucide-react + recharts (growth chart) |
| State | Zustand (client) — single-page app shell with view switching |
| DB | **SQLite via Prisma ORM** (`db/custom.db`, 24 models) |
| Auth | Session cookie (`sp_session`, httpOnly) + scrypt password hashing, RBAC (USER/ADMIN) |
| AI | `z-ai-web-dev-sdk` — LLM (ideas/scripts/metadata), TTS (voice), Image Gen (visuals) |
| Video | **FFmpeg** (segment concat, 1080×1920 H.264) |
| YouTube | Google **OAuth 2.0** (authorization-code, offline access) + **YouTube Data API v3** |
| Security | AES-256-GCM field encryption for OAuth tokens at rest; tokens never sent to the frontend; tenant isolation on every query |

### Key source paths

```
prisma/schema.prisma        # 24 models: users → channels → pipeline → billing → audit
src/app/api/v1/…            # ~40 REST endpoints (one handler style, zod-validated)
src/lib/ai/                 # llm.ts, tts.ts (retry/backoff), image.ts (retry), search.ts
src/lib/pipeline/           # jobs.ts (render+publish worker), visuals.ts (VisualJob),
                            # voice.ts, automation.ts (auto-pilot engine)
src/lib/youtube.ts          # OAuth 2.0 + Data API client (connect, sync, dashboard)
src/lib/usage.ts            # credit ledger: charge / grant / refund
src/components/spa/         # the entire frontend SPA (Shell + 15 views)
```

---

## 4. Quick Start (from zero)

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.1 (or Node.js 18+), FFmpeg on PATH (`ffmpeg -version` works in a **new** terminal; on Windows: `winget install Gyan.FFmpeg` then reopen the terminal).

```bash
# 1. Install dependencies
bun install

# 2. Environment
cp .env.example .env          # defaults work out of the box (SQLite + sandbox keys)

# 3. Create + push the database schema
bun run db:push

# 4. Seed plans + admin account
bun prisma/seed.ts

# 5. Run
bun run dev                   # → http://localhost:3000  (dev.log captures server logs)

# Quality checks
bun run lint                  # ESLint
bash tests/api-e2e.sh         # full E2E suite (57 assertions)
```

**Demo admin login:** `admin@shortspilot.ai` / `admin12345` (change it in Account Settings after first login).

### Environment variables

Only infrastructure settings live in `.env`. **Every API key (Gemini, Google OAuth, YouTube, Razorpay, PayPal) is configured in the admin panel — `/admin → API & Integrations` and `/admin → Payments` — stored AES-256-GCM encrypted at rest. There is no .env fallback for API keys by design.**

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | `file:../db/custom.db` (relative to `prisma/`) |
| `SP_ENCRYPTION_KEY` | optional | AES key for token encryption (sandbox default if unset) |
| `SP_SESSION_SECRET` | optional | Session signing secret |
| `DEV_HOST` / `DEV_ORIGINS` / `DEV_PORT` | optional | Dev server LAN binding overrides |

**API keys — set them all in the admin panel:**

| Key | Where in /admin | Get it free at |
|---|---|---|
| Google OAuth Client ID + Secret | API & Integrations → "Google OAuth 2.0 client" | console.cloud.google.com |
| YouTube Data API key (optional) | API & Integrations → "YouTube Data API key" | console.cloud.google.com |
| Gemini API key | API & Integrations → "AI provider" (has **Verify & save** + **Test** buttons) | aistudio.google.com/apikey |
| Razorpay Key Id + Secret | Payments → Razorpay | dashboard.razorpay.com/app/keys |
| PayPal Client ID/Secret + mode | Payments → PayPal | developer.paypal.com |

> Without any Google credentials the app still works 100% — channels connect in **sandbox mode** and the full pipeline runs end-to-end.

---

## 5. Real YouTube Setup (OAuth 2.0 & API key)

### Option A — Google OAuth 2.0 (recommended: real login, owned channel, uploads)

1. Open <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → Library** → search **“YouTube Data API v3”** → **Enable**.
3. **APIs & Services → OAuth consent screen** → External → fill app name/email → add scopes:
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/youtube.upload`
   - Add yourself as a **test user** (while in “Testing” publishing status).
4. **Credentials → Create credentials → OAuth client ID** → type **Web application**.
5. Add **Authorized redirect URIs** — add BOTH to the same OAuth client:
   - `<your-origin>/api/v1/youtube/callback` (channel connect — exact value shown in `YouTube Channels → Connect channel → OAuth 2.0 tab`)
   - `<your-origin>/api/v1/auth/google/callback` (login — exact value shown in **Admin → Integrations**)
   e.g. `http://localhost:3000/api/v1/youtube/callback` and `http://localhost:3000/api/v1/auth/google/callback`.
6. Copy the **Client ID** + **Client Secret** into the admin panel (**/admin → API & Integrations → Google OAuth 2.0 client**) → **Save credentials** (stored AES-256-GCM encrypted in DB).
7. Click **“Sign in with Google”** → consent → you land back on the Channels page with a success toast. The channel now shows **OAUTH 2.0** badge and its **Live dashboard** button is enabled.

**Flow internals:** `GET /api/v1/youtube/auth` (302 to Google, `access_type=offline`, `prompt=consent`, CSRF `state` cookie) → `GET /api/v1/youtube/callback` (verifies state, exchanges code, fetches `channels?mine=true`, upserts channel + encrypted tokens, first sync) → redirects to `/?yt=connected`.

### Option B — YouTube Data API key (public stats, no login)

1. Same Cloud Console project → **Credentials → Create credentials → API key**.
2. Paste it in the admin panel (**/admin → API & Integrations → YouTube Data API key**) — all API keys are configured there only (no `.env` needed).
3. Enter any `@handle` (or channel URL / `UC…` id) → **Connect & load live stats**.
   You get real subscribers/views/videos + recent uploads synced in real time (no upload capability — that needs OAuth).

### Real-time dashboard (both modes)

- Polls `GET /api/v1/channels/:id/dashboard` **every 60 s**; the server re-syncs from YouTube whenever data is older than 60 s (cached fallback keeps the page usable if YouTube is down — you'll see a stale banner).
- **Sync now** forces an immediate refresh. Every sync appends a **ChannelStat** datapoint that feeds the growth chart.
- KPIs: Subscribers, Total views, Videos, Avg views/video, Likes & Comments across the last 25 uploads. Recent uploads table links each row to YouTube.

### Sign in with Google (account login)

The login screen has a **“Continue with Google”** button. It uses the **same Google OAuth client** as channel connect (one client, two redirect URIs — see Option A step 5).

- Flow: `GET /api/v1/auth/google` (302 to Google, CSRF `state` cookie) → `GET /api/v1/auth/google/callback` (state check → code exchange → userinfo) → session cookie → `/?auth=google&status=ok`.
- **Existing email matches link automatically** (Google emails are verified). Brand-new accounts get the same provisioning as normal sign-up: profile, 14-day trial, 25 welcome credits, automation rule. Google users sign in via Google only (no password).
- Not configured yet? The button redirects back with a clear toast telling you to add the client in **Admin → Integrations**.

---

## 6. Using the App — section by section

| Section | What you do there |
|---|---|
| **Dashboard** | Pipeline overview: connected channels, generated/published/failed counts, recent videos, upcoming schedule |
| **AI Studio** | The one-screen creator flow: pick an idea → generate script → approve it → generate voice + visuals → assemble video. Live progress on visuals (scene counter) and render (% + stage) |
| **Content Ideas** | Generate trending ideas (LLM + research) for your niche; save / use an idea |
| **Scripts** | Every script version; inline editor for hook/scenes/captions; approve; regenerate (new version); delete. *Notification deep-link opens the exact script expanded* |
| **Voice Library** | Google AI Studio voices (Kore, Puck, Charon…) + classic voices with previews; voiceover jobs and their audio tracks |
| **Media Library** | All generated scene images; regenerate individual scenes |
| **Video Library** | All Shorts: preview player, approve/reject, upload, retry render, edit metadata (title/description/hashtags), download MP4, delete. Auto-polling while rendering. *Deep-link scrolls + highlights the video* |
| **Content Calendar** | Scheduled publishing across channels |
| **Automation** | Auto-pilot: mode (manual / approval / automatic), schedule days + time + timezone, daily/weekly limits, budget guard. **Run now** triggers the whole pipeline unattended |
| **YouTube Channels** | Connect (OAuth / API key / sandbox), plan-limit enforced (e.g. Free Trial = 1 channel), **Live dashboard**, disconnect (tokens destroyed) |
| **Analytics** | Usage metrics + AI growth recommendations |
| **Billing** | Plans, sandbox checkout, invoices, cancel (sandbox billing — wire Stripe for production) |
| **Usage & Credits** | Credit balance, full ledger (grants/charges/**refunds**), spend by provider |
| **Account Settings** | Profile, default voice/style/duration, approval mode, monthly credit cap, password |
| **Admin Console** *(ADMIN)* | Platform overview, user management, job monitor |
| **🔔 Notifications** | Bell dropdown; **click any notification to open the related page** (unread badge, mark-all-read, per-type icons) |

### Recommended first run (5 minutes)

1. Sign in → complete onboarding (niche, language, voice, style, approval mode).
2. **AI Studio** → generate ideas → pick one → **Generate script** → read it → **Approve**.
3. **Generate voiceover** → **Generate visuals** (watch the async job counter fill up) → **Assemble video**.
4. Watch it move `RENDERING → QUALITY_CHECK → PENDING_APPROVAL` in Video Library → **Preview** → **Approve** → **Upload** (sandbox publish) — you'll get notifications at every step; click them!
5. **Connect your real channel** (OAuth or API key) → open the **Live dashboard** → hit **Sync now**.

### AI Support Assistant (bottom-left chat)

A floating **chat button (bottom-left)** is available on the landing page, login screen and everywhere inside the app.

- **“Pilot” is a tuned support agent** — it knows the setup steps, every feature, plans/pricing, free-API configuration and the common fixes (npm/PowerShell, FFmpeg, LAN access, db:seed, 502 visuals…). It replies in English or Hinglish depending on how you ask.
- API: **Google Gemini (free tier)** — save the key once in **/admin → API & Integrations → AI provider** (the only place keys are configured); falls back to the built-in provider in sandbox deployments.
- Endpoint: `POST /api/v1/support/chat` — works signed-in or signed-out, per-IP rate limited (20 msgs/min), conversation capped to the last 16 messages.
- Quick-question chips cover the most common topics; use the header button to start a new conversation.

---

## 7. Plans, Payments & Credits

| Plan | USD (PayPal) | INR (Razorpay) | Shorts/mo | Channels | Monthly credits |
|---|---|---|---|---|---|
| Free Trial | $0 | ₹0 | 3 | 1 | 25 |
| Starter | $9 | ₹749 | 30 | 1 | 120 |
| Pro | $24 | ₹1,999 | 100 | 3 | 400 |
| Agency | $59 | ₹4,999 | 300 | 10 | 1200 |

**Real payment gateways** — configure in **/admin → Payments** (secrets stored AES-256-GCM encrypted; the admin panel is the only place gateway keys are set):

- **Razorpay (₹ INR, India)** — free test keys instantly at [dashboard.razorpay.com/app/keys](https://dashboard.razorpay.com/app/keys). Paste **Key Id** + **Key Secret** in /admin → Payments → Razorpay. Checkout.js popup → server verifies the HMAC-SHA256 signature → plan activates.
- **PayPal ($ USD, international)** — free sandbox keys at [developer.paypal.com](https://developer.paypal.com/dashboard/applications). Paste **Client ID** + **Client Secret** and pick **test/live** mode in /admin → Payments → PayPal. Approval redirect → server captures the money → plan activates.
- Free plans activate instantly without a gateway. Paid plans become ACTIVE **only after server-side verification/capture** — nothing is trusted from the browser.
- Go live: complete KYC/business verification, switch PayPal to `live`, then enable Razorpay webhooks.

Credit costs: idea 1 · script 2 · metadata 0.5 · voiceover 4 · visuals 1.5/scene · render 3 (refunded on failure) · publish 1. Plan limits enforced server-side (402 on breach); failed jobs auto-refund via the credit ledger.

---

## 8. API Reference (v1)

```
POST /auth/register|login|logout          GET /auth/me
GET  /auth/google                          → Google consent → /auth/google/callback
                                          ("Continue with Google" login)
GET  /onboarding                           PATCH /onboarding            (profile)
POST /ideas/generate                       GET|PATCH|DELETE /ideas[/:id]
POST /scripts/generate                     POST /scripts/:id/regenerate
POST /voice/generate|preview               GET  /voices, /voiceovers
POST /visuals/generate                     GET  /visuals/status, /assets
GET|POST /videos                           PATCH|DELETE /videos/:id
POST /videos/:id/render|download           GET|POST /videos/:id/assemble
GET|POST /channels                         DELETE /channels/:id
GET  /channels/:id/dashboard               (live stats, 60s cache)
GET  /youtube/config                       POST|DELETE /youtube/config (admin)
GET  /youtube/auth                         → Google consent → /youtube/callback
POST /youtube/sync                         sync | connect-apikey
GET|POST /publishing/jobs                  POST /publishing/upload, .../retry
GET  /billing/plans|subscription|invoices|gateways
POST /billing/checkout|cancel              POST /billing/razorpay/verify
GET  /billing/paypal/return                (PayPal approval redirect)
GET|POST|DELETE /admin/payments/config     (ADMIN — Razorpay/PayPal keys)
GET|POST|DELETE /admin/ai/config           (ADMIN — Gemini key / AI status)
GET  /analytics/overview|recommendations
GET|PATCH /automation                      POST /automation/run-now
GET  /usage, /usage/ledger                 GET|POST /notifications
POST /notifications/read-all               POST /notifications/:id/read
GET  /admin/overview|users|jobs            (ADMIN only)
POST /support/chat                        (AI support assistant, rate-limited)
GET  /health
```

All endpoints: cookie session auth, zod validation, tenant isolation, consistent `{ error }` on failure. Curl examples: see `tests/api-e2e.sh` (it exercises every endpoint).

---

## 9. Testing

```bash
bun run lint            # ESLint (Next.js rules)
bash tests/api-e2e.sh   # 57 E2E assertions across every module
```

The E2E suite registers a fresh user, runs the whole pipeline (ideas → scripts → voice → visuals → render → publish), checks plan limits (402), RBAC (403), billing, automation, notifications, admin console, and cleans up after itself. Provider-rate-limited assertions are skipped gracefully (SKIP, not FAIL).

---

## 10. Troubleshooting / FAQ

### Voices — which engine speaks?

| Setting (Admin → API & Integrations → Voice) | What happens |
|---|---|
| **Auto (recommended)** | ElevenLabs (if key) → Google AI Studio (Gemini TTS, if pool keys) → free Edge → Google Translate |
| **ElevenLabs first** | Every voice is spoken by ElevenLabs (most natural, Hindi supported). Falls back down the chain only if ElevenLabs fails |
| **Google AI Studio first** | Every voice is spoken by the original Google voices (Gemini TTS) through your pooled Gemini keys |
| **Free Edge only** | Zero cost, no keys — neural but "assistant-like" voices |

- Google original voices (Kore, Puck, Charon, Leda, Zephyr, Fenrir, Aoede, Orus) are the **g-\*** entries in the Voice Library — they always use Gemini TTS via the account pool.
- No key at all → the app falls back to free Edge neural voices (the "browser-like" voices).

### Veo cinematic motion (Flow-style) — why is my video zoom-pan?

Veo is a **paid-only** Google API: it needs a Gemini API key from a project with **billing enabled** (free-tier keys cannot call Veo). Without a working Veo key the renderer automatically falls back to cinematic zoom-pan. To verify your setup:

1. Admin → API & Integrations → paste your billing-enabled key(s) into the **Gemini account pool**
2. Toggle **Veo cinematic motion** ON, pick an engine (Veo 3 = best quality, Omni Flash = fastest)
3. Click **Test Veo** — it generates one short real clip and shows the exact result:
   - `Veo works — veo-3.0-…` → renders will use real Flow-style AI motion
   - `billing is not enabled…` → enable billing on the key's Google project, then retest
   - `No Gemini API keys in the account pool…` → add a key first

A successful test consumes one short (~4 s) Veo clip.

| Symptom | Cause & fix |
|---|---|
| **Prisma error `Unknown argument 'motionPrompt'` (or any other field) on render/automation** | Your local DB + generated client are older than the code. Fix in 1 minute: stop the dev server, then run `npx prisma db push` and `npx prisma generate`, and delete the `.next` folder (`rmdir /s /q .next` on Windows), then `npm run dev`. Newer builds auto-run this on `npm install` (postinstall) — if you extracted a new version **over** an old folder, always run these two commands once |
| **LAN/phone shows endless buffering on :3000** | Dev assets are origin-restricted — the app auto-allowlists your LAN IPs (`next.config.ts`). Still stuck? Allow port 3000 in Windows Firewall: `netsh advfirewall firewall add rule name="ShortsPilot Dev 3000" dir=in action=allow protocol=TCP localport=3000`, or force it with `DEV_ORIGINS=<your-ip> npm run dev` |
| **“No LLM provider configured” when generating ideas/scripts** | You haven't added a Gemini key yet — get a free one at aistudio.google.com/apikey (must start with `AIza`) and save it via **Verify & save** in /admin → API & Integrations. Voice (Edge TTS), visuals (Pollinations) and search (DuckDuckGo/Google News) already run key-free |
| **Checkout says a gateway is “not configured”** | Admin must save keys in /admin → Payments (Razorpay for ₹, PayPal for $) |
| **Visuals stuck / 502** | Image generation is async (VisualJob) — watch `/visuals/status`. 429s from the provider retry automatically with backoff |
| **Voice generation 429** | Same — exponential backoff built in; heavy bursts may still need a retry |
| **“Google OAuth is not configured”** | No client credentials saved yet — add the Client ID + Secret in /admin → API & Integrations → Google OAuth 2.0 client, then retry |
| **OAuth `redirect_uri_mismatch`** | The redirect URI in Google Cloud Console must **exactly** match the one shown in the app setup box (scheme + host + `/api/v1/youtube/callback`) |
| **OAuth `access_blocked`** | Consent screen is in Testing — add your Google account as a test user |
| **Channel dashboard “stale” banner** | Live sync failed (YouTube down / token revoked) — cached data shown; hit **Sync now**; if the token was revoked reconnect the channel |
| **402 Plan limit reached** | Upgrade in Billing (shorts or channels limit hit) |
| **Insufficient credits** | Wait for monthly reset, raise the cap in Settings, or upgrade |
| **FFmpeg errors on render** | Open a **new** terminal and run `ffmpeg -version`. "Not recognized" → `winget install Gyan.FFmpeg`, reopen the terminal, restart `npm run dev`. Error mentions no libx264 / missing filter → install that same full build. Still failing → run `npx tsx scripts/render-test.ts` for an exact diagnosis; the video card now shows the real ffmpeg reason + fix hint |
| **DB reset** | `bun run db:reset` (or delete `db/custom.db` + `bun run db:push` + seed) |

---

## 11. Production notes

- **Deploy**: any Node host (`bun run build` → `bun run start` standalone) or Vercel. SQLite is file-based — for multi-instance production swap `DATABASE_URL` to Postgres and adjust the Prisma provider.
- **Billing**: real **Razorpay (INR)** + **PayPal (USD)** checkout is wired with server-side signature verification/capture. To accept real money: finish gateway KYC, switch PayPal mode to `live` in /admin → Payments, enable Razorpay webhooks, and set real `SP_ENCRYPTION_KEY` + `SP_SESSION_SECRET`.
- **Uploads**: publishing currently uses the sandbox adapter; the OAuth plumbing (encrypted refresh tokens, youtube.upload scope) is already stored per channel — implement the resumable `videos.insert` call in `src/lib/pipeline/jobs.ts` to go live.
- **Secrets**: set real `SP_ENCRYPTION_KEY` + `SP_SESSION_SECRET` in production; never commit `.env` (already git-ignored).

---

*ShortsPilot AI — MIT licensed. Build your Shorts empire responsibly.* 🚀
