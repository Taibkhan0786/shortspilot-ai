# ShortsPilot AI 🎬

**AI-powered YouTube Shorts automation platform** — from idea to published Short, on autopilot.

ShortsPilot AI generates trending content ideas, writes viral scripts, produces natural voiceovers, creates cinematic scene visuals, assembles vertical videos, and schedules/publishes them to YouTube — with plan-based limits, credit metering, approvals, and full admin oversight.

> 📖 **Full setup guide + user manual:** [GUIDE.md](./GUIDE.md) — how everything works, YouTube OAuth 2.0 setup, section-by-section usage, API reference, troubleshooting.

## 🆕 What's new in this update (v1.4.1)

| Area | Change |
|---|---|
| ⚡ **Speed** | Script generation & the support assistant are dramatically faster: tight retry budget (no more minute-long retry stacks), 45 s default Gemini timeout, shorter backoffs, cached key/model lookups, and **token-by-token streaming** for the "Pilot" assistant (SSE). |
| 🎛️ **Gemini API controls** | New card in **Admin → API & Integrations → "Gemini API controls"**: sliders for script/idea **temperature**, support-chat temperature, **max output tokens** and **request timeout** — saved live, no restart. The Gemini key "Verify & save" / "Test" route (`/api/v1/admin/ai/test`) is now shipped (it was missing before). |
| 🎬 **Realistic photo motion** | Renders now use **eased cinematic Ken-Burns** (alternating zoom-in/out with directional drift + gentle color grade) and **smooth crossfades (xfade)** between scenes — Flow-style. Optional **Veo cinematic motion** toggle (beta) animates each scene still with **Google Veo** image-to-video (needs a billing-enabled Gemini key; auto-falls back to zoom-pan per scene). |
| ♾️ **Admin = unlimited** | ADMIN accounts are **never charged credits** and bypass the monthly cap and plan Shorts/month limit — unlimited usage of every AI action. |
| 🧹 **Footer** | The "Download project (.zip)" footer link has been removed from the landing page and the app shell. |

## ✨ Features

| Section | What it does |
|---|---|
| 🔐 **Auth** | Register / login with DB-backed sessions (30d), roles (USER/ADMIN), suspension |
| 🚀 **Onboarding** | Niche, audience, language, script style, voice, visual style, schedule |
| 💡 **Ideas** | AI trend-researched content ideas with hooks, angles, scoring, approve/reject |
| 📝 **Scripts** | Scene-by-scene scripts (hook → body → CTA), regenerate with different tones |
| 🎙️ **Voice** | 7 TTS voices, per-scene voiceover + full narration track, previews |
| 🖼️ **Visuals** | AI vertical images per scene (cinematic / cartoon / realistic / minimalist) |
| 🎬 **Videos** | Assemble video from script + voice + visuals, AI metadata (title/desc/tags/hashtags) |
| ⚙️ **Render worker** | Background pipeline: scenes → quality check → PENDING_APPROVAL (progress %) |
| 📅 **Calendar** | Publishing schedule view across connected channels |
| 📺 **Channels** | Connect **real YouTube channels via Google OAuth 2.0** (or a Data API key for public stats), plan-limit enforced |
| 📈 **Live channel dashboard** | Real-time subscribers / views / videos / likes / comments, growth chart, recent uploads — auto-refreshes every 60s |
| 🔔 **Notifications** | Pipeline events, unread badge, mark-all-read, **click-to-open deep links** (jump straight to the related video/script/channel) |
| 🤖 **Automation** | Auto-pilot rules: schedule days/time, daily/weekly limits, run-now |
| 💳 **Billing** | Plans (Free Trial / Starter / Pro / Agency), sandbox checkout, invoices, cancel |
| 📊 **Analytics** | Overview metrics + AI growth recommendations |
| 💰 **Usage & credits** | Credit ledger (grants/charges/refunds), usage by provider |
| 🛡️ **Admin** | Platform overview, user management, job monitor |

## 🧱 Tech Stack

- **Next.js 16** (App Router) + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (New York) + Lucide icons + Framer Motion
- **Prisma ORM** + **SQLite** (zero-config, file-based)
- **z-ai-web-dev-sdk** for LLM (ideas/scripts/metadata), TTS (voiceovers), Image Gen (visuals)
- **FFmpeg** for audio concat + vertical video rendering
- Background worker loop for render + publishing jobs

## 🚀 Getting Started

### From the project ZIP (fastest — database included)

The zip ships a pre-configured SQLite database (`db/custom.db` — admin account, plans, and any API keys already saved in the admin panel). No `db:push` / `db:seed` needed:

```powershell
cd shortspilot-ai
Copy-Item .env.example .env   # only DATABASE_URL — already correct for the zip's database
npm install
npm run dev                   # → http://localhost:3000
```

> Stale-install gotcha: if you previously extracted an older zip into the same folder, **extract this one into a fresh folder** (or delete the old `.next` folder first) so no old files linger, then restart the dev server.

### From git clone (create the database yourself)

```bash
# 1. Install dependencies
bun install

# 2. Configure environment (DATABASE_URL only — API keys live in /admin)
echo 'DATABASE_URL="file:../db/custom.db"' > .env

# 3. Push schema + seed demo data (plans, admin user, demo channel)
bun run db:push
bun run db:seed

# 4. Start dev server (http://localhost:3000)
bun run dev
```

### With npm / Node.js (Windows friendly)

> PowerShell blocking `npm.ps1`? Fix once with:
> `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`

```powershell
git clone https://github.com/Taibkhan0786/shortspilot-ai.git
cd shortspilot-ai
Copy-Item .env.example .env
npm install
npx prisma db push
npm run db:seed
npm run dev        # cross-platform launcher, logs to dev.log
```

> Note: `DATABASE_URL="file:../db/custom.db"` is resolved relative to the `prisma/` folder (where `schema.prisma` lives), so the database file lands at `<project>/db/custom.db` for both the Prisma CLI and the runtime app.

> FFmpeg is required for voiceover concatenation and video rendering (`ffmpeg` + `ffprobe` on PATH — on Windows: `winget install Gyan.FFmpeg`, then **close and reopen** the terminal before restarting the dev server). Local render failing? Run the self-test: `npx tsx scripts/render-test.ts` — it pinpoints the exact problem (missing install, build without libx264, corrupt scene files) with fix instructions.

> 🔑 **All API keys** (Gemini, Google OAuth, YouTube, Razorpay, PayPal) are configured in **/admin → API & Integrations / Payments** — no `.env` keys needed. Sign in as the admin above and paste your keys there (stored AES-256-GCM encrypted).

### Demo accounts (after seeding)

| Role | Email | Password |
|---|---|---|
| Admin | `admin@shortspilot.ai` | `admin12345` |

Or register a fresh account — new users start on the **Free Trial** plan (3 Shorts, 1 channel).

## 📱 Open from your phone / LAN (http://YOUR-IP:3000)

The dev server binds to `0.0.0.0` (all interfaces) and auto-allowlists your machine's LAN IPs, so any device on the same Wi-Fi can open `http://<your-ip>:3000`.

- Find your PC's IP: Windows → `ipconfig` (IPv4 Address) · macOS/Linux → `hostname -I`.
- Page stuck "buffering" from another device?
  1. **Windows Firewall** — allow inbound port 3000 once (run PowerShell as Administrator):
     ```powershell
     netsh advfirewall firewall add rule name="ShortsPilot Dev 3000" dir=in action=allow protocol=TCP localport=3000
     ```
     (Or simply allow Node.js when Windows shows the firewall prompt.)
  2. First visit compiles on demand — it can take 5–15 s. Refresh once; later loads are instant.
  3. Different subnet / corporate VPN? Add your IP explicitly: `DEV_ORIGINS=10.23.61.226 npm run dev`.
- Restrict to localhost only: `DEV_HOST=localhost npm run dev`.

## 💳 Real payments — Razorpay (₹ INR, India) + PayPal ($ USD, international)

Checkout is wired to **real gateways**; a plan activates only after server-side verification (Razorpay HMAC signature check / PayPal capture). Configure keys in **/admin → Payments** (stored AES-256-GCM encrypted — the admin panel is the **only** place keys are configured, no `.env` needed):

| Gateway | Currency | Free test keys | Where to paste |
|---|---|---|---|
| Razorpay | INR | Instant, no KYC: [dashboard.razorpay.com/app/keys](https://dashboard.razorpay.com/app/keys) | /admin → Payments → Razorpay |
| PayPal | USD | Sandbox: [developer.paypal.com](https://developer.paypal.com/dashboard/applications) | /admin → Payments → PayPal (mode test\|live) |

Flow: user clicks a paid plan → gateway dialog (₹ via Razorpay Checkout.js popup, $ via PayPal approval redirect) → server verifies/captures → subscription ACTIVE + credits granted + invoice PAID. Go live by switching PayPal mode to `live` and enabling Razorpay webhooks after business verification.

## 🤖 Free AI providers (self-hosted friendly)

All AI features work **without paid APIs**:

| Feature | Provider | Key needed? |
|---|---|---|
| Ideas / scripts / research summaries | z-ai SDK → **Google Gemini 2.0 Flash** fallback | Gemini: free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Voiceovers | **Microsoft Edge neural TTS** | ❌ none |
| Scene visuals / thumbnails | **Pollinations.ai (Flux)** | ❌ none |
| Trend research | z-ai → **DuckDuckGo HTML + Google News RSS** | ❌ none |

Paste the Gemini key in **/admin → API & Integrations → AI provider** (AES-256-GCM encrypted at rest — the admin panel is the **only** place API keys are configured, no `.env` needed). Voice/visual/search fallbacks are automatic and keyless — they kick in whenever the built-in z-ai provider is unavailable.

> Local runs fail on idea/script generation with *"No LLM provider configured"*? That means no Gemini key is saved in the admin panel — add one (it's free) and everything works.

## 🧪 Testing

Full end-to-end API suite covering every section (auth, ideas, scripts, TTS, visuals, videos, render pipeline, channels, publishing, billing, analytics, automation, usage, notifications, admin RBAC):

```bash
bash tests/api-e2e.sh          # against http://localhost:3000
bash tests/api-e2e.sh http://other-host:port
```

Render pipeline self-test (verifies ffmpeg/ffprobe + captions + output — handy when local rendering fails):

```bash
npm run render-test     # or: npx tsx scripts/render-test.ts
```

Lint:

```bash
bun run lint
```

## 📁 Project Structure

```
src/
├── app/
│   ├── page.tsx              # SPA entry
│   └── api/v1/               # REST API (auth, ideas, scripts, videos, billing, admin…)
├── components/spa/           # 21 views: Landing, Studio, VideoLibrary, Billing, Admin…
├── lib/
│   ├── ai/                   # LLM / TTS / image SDK wrappers (with retry/backoff)
│   ├── engine/               # content generation logic
│   ├── pipeline/             # voice / visuals / render pipelines
│   ├── auth.ts               # sessions, requireUser/requireAdmin
│   ├── usage.ts              # credit ledger + plan limits
│   └── worker.ts             # background render/publish worker
prisma/schema.prisma          # 18 models: users→channels→pipeline→billing→audit
tests/api-e2e.sh              # E2E API test suite (51 checks)
```

## 🔑 API Overview

All routes under `/api/v1`, cookie-session auth (`sp_session`), JSON errors.

```
POST /auth/register|login|logout   GET /auth/me
GET  /dashboard                    PATCH /onboarding, /users/me
POST /ideas/generate               GET|PATCH|DELETE /ideas[/:id]
POST /scripts/generate             POST /scripts/:id/regenerate
POST /voice/generate|preview       GET  /voices, /voiceovers
POST /visuals/generate             GET  /assets, DELETE /assets/:id
GET|POST /videos                   POST /videos/:id/render, GET /videos/:id/download
GET|POST /channels                 GET  /publishing/jobs[/:id], POST .../retry
GET  /youtube/config               GET  /youtube/auth → Google OAuth consent → /youtube/callback
POST /youtube/sync                 sync | connect-apikey      GET /channels/:id/dashboard (live stats)
GET  /billing/plans|subscription|invoices   POST /billing/checkout|cancel
GET  /analytics/overview|recommendations
GET|PATCH /automation              POST /automation/run-now
GET  /usage, /usage/ledger         GET|POST /notifications, /notifications/read-all
GET  /admin/overview|users|jobs    (ADMIN only)
```

## 📄 License

MIT — build your Shorts empire responsibly.
