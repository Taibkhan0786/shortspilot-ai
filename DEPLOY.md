# Deploying ShortsPilot AI

## Important: why not Vercel / Netlify?
This app is a **long-running server**: a background worker (render / publish / automation),
FFmpeg for video rendering, and generated files + SQLite on disk. Vercel/Netlify run short-lived
serverless functions with no persistent disk and no FFmpeg, so voice/visual/render jobs would be
killed mid-way and files would vanish. Use a host that runs Docker with a persistent disk.

## Option A — Render.com (easiest, ~₹600/mo; persistent disk needs a paid instance)
1. Push this folder to a GitHub repo (`.env` and `db/` are already git-ignored).
2. Render → **New → Blueprint** → select the repo. `render.yaml` does the rest
   (Docker build with FFmpeg, 10 GB disk at `/data`, auto-generated `SP_ENCRYPTION_KEY`).
3. First boot **creates the database automatically** (`prisma db push`) and seeds plans + admin.
4. Open the URL → `/admin` → login `admin@shortspilot.ai` / `admin12345` → **change the password**.
5. `/admin → API & Integrations` → save your Gemini key. For Google login/YouTube add
   `https://<your-app>.onrender.com/api/v1/youtube/callback` and `.../api/v1/auth/google/callback`
   as redirect URIs in Google Cloud Console.

## Option B — any VPS (Oracle Free Tier, Hetzner, DigitalOcean…)
```bash
echo "SP_ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env   # keep this value forever
docker compose up -d --build                              # app on :3000, data in a Docker volume
```
Put Caddy/Nginx in front for HTTPS.

## Notes
- Never change `SP_ENCRYPTION_KEY` after saving keys in /admin (they would become unreadable).
- Backups: the `/data` volume holds `db/app.db` and `uploads/`.
- Local dev is unchanged: `npm install`, `npx prisma db push`, `npm run db:seed`, `npm run dev`.
- Gemini 503 ("high demand") is now handled automatically: retry with backoff, then fallback to the
  next model. Test it: `npm run test:gemini`.
