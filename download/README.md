Here are all the generated files.

## Latest package
`shortspilot-ai-pro-v3.zip` (project root) — full updated source, ready to unzip and run.

### What's new in v3 (professional upgrade)
1. **Long video generation** — scripts now scale up to 5 minutes (40 scenes); long scripts are planned via outline + written in parallel chapters; voice + visuals render with bounded concurrency so big videos stay fast.
2. **My Own Script mode** — paste any script in AI Studio; it is split into scenes with your exact wording, visual prompts and motion directions, then flows through the normal voice → visuals → render pipeline.
3. **Flow-AI style video engine** — Admin → API & Integrations → "Video engine mode":
   - `Veo 3 — Flow AI cinematic` (realistic human motion, filmic camera, parallax, micro-expressions)
   - `Omni Flash — fast mode` (fastest clips)
   - Realistic-motion prompt engine + per-scene "motion direction" fields.
4. **Google voices** — 8 real Google Gemini voices (Kore, Puck, Charon, Leda, Zephyr, Fenrir, Aoede, Orus) spoken by Gemini TTS; classic free voices still available.
5. **Gemini account pool (10 accounts)** — Admin → API & Integrations → "Gemini account pool": paste one API key per line; every call (scripts, Google voices, Veo) rotates keys automatically, cooling down quota-hit keys for 10 minutes. 10 accounts x 50 credits = 500 pooled credits.
6. **Image → Professional Ad Video** — AI Studio → "Image → Ad Video": upload one photo, pick a template (UGC Ad, Product Showcase, Cinematic Reel, Testimonial, Fashion, Food, Tech), get AI ad copy + Google voice + animated scenes + 1080x1920 render in one click.
7. **Per-scene image upload** — in Studio → Visuals, replace any generated scene image with your own photo.
8. Admin accounts remain unlimited (no credits/caps).

Run: `bun install && bun run db:push && bunx tsx prisma/seed.ts && bun run dev`
