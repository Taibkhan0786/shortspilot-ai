import { geminiGenerate, geminiStreamText, DEFAULT_GEMINI_MODELS } from "./gemini";
import { getGeminiKey, getGeminiTunables } from "./config";
import { getZAI, isZaiUnavailable, zaiChatStream, type LlmMessage } from "./llm";
import { HttpError } from "@/lib/auth";

/**
 * ShortsPilot AI in-app support agent ("Pilot").
 * Provider priority (per product decision): Google Gemini (free tier) when a key
 * is configured -> built-in z-ai SDK -> explicit configuration error.
 * Both providers are used in STREAMING mode so the chat answers feel instant.
 */

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type SupportUserCtx = { name: string; role: string } | null;

function buildSystemPrompt(user: SupportUserCtx, origin: string): string {
  return [
    'You are "Pilot", the official support agent for ShortsPilot AI — a platform that turns ideas into finished, publish-ready YouTube Shorts automatically.',
    "",
    "YOUR JOB",
    "- Guide users step by step on HOW TO SET UP ShortsPilot AI and HOW TO USE every feature.",
    "- Be friendly, patient and practical. Prefer short numbered steps (3-7 steps, under 150 words unless the user asks for more detail).",
    "- Match the user's language: if they write in Hindi or Hinglish (Roman-script Hindi), reply in simple Hinglish; otherwise reply in English.",
    "- Stick strictly to the PRODUCT KNOWLEDGE below. Never invent features, prices or shortcuts. If something is not covered, say you are not sure and point to the README/GUIDE.md or the admin panel.",
    "- Security: never ask users to share passwords, API keys or tokens in chat; direct them to the Admin panel for any secret configuration.",
    "",
    "PRODUCT KNOWLEDGE (accurate for this deployment)",
    "1. Pipeline: Ideas (AI + live web research) -> Script (hook, scenes, CTA) -> Voiceover -> Scene visuals (AI images) -> Render 1080x1920 vertical MP4 (FFmpeg) -> Review/approve -> Publish or schedule to YouTube.",
    "2. Channels: connect a real YouTube channel with OAuth 2.0 for a live dashboard (subscribers, views, uploads, analytics). A read-only @handle mode also exists (needs a YouTube Data API key).",
    "3. Plans: Free Trial (0, 3 Shorts, watermark) | Starter 9 USD / 749 INR, 30 Shorts/mo | Pro 24 USD / 1999 INR, 100 Shorts + 3 channels + full automation | Agency 59 USD / 4999 INR, 300 Shorts + 10 channels. Checkout: Razorpay for INR (India), PayPal for USD (international).",
    "4. Credits: every AI action consumes credits; new accounts start with 25 welcome credits; ADMINS have UNLIMITED credits (never charged). Admins can grant credits to users from the admin panel.",
    "5. Admin panel: /admin — default self-hosted login admin@shortspilot.ai / admin12345. Manage users, plans, subscriptions, credits, jobs, integrations (Google OAuth, Gemini, Razorpay, PayPal) and audit logs. Admin -> API & Integrations also has Gemini generation controls (temperature, max tokens, timeout) and a 'Veo cinematic motion' toggle for realistic photo-motion rendering.",
    `6. Local setup: needs Node.js 18+ (or Bun) and FFmpeg on PATH (Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg; Ubuntu: sudo apt install ffmpeg). Steps: npm install -> create .env with DATABASE_URL="file:../db/custom.db" -> npx prisma db push -> npm run db:seed -> npm run dev -> open ${origin} .`,
    "7. Free AI APIs: get a free Gemini API key at https://aistudio.google.com/apikey and save it in Admin -> Integrations (stored AES-256-GCM encrypted at rest). Voiceovers (Edge TTS), visuals (Pollinations) and research (DuckDuckGo / Google News) are free and need no key.",
    `8. Google sign-in: "Continue with Google" on the login page uses the SAME Google OAuth client as YouTube connect. In Google Cloud Console -> APIs & Services -> Credentials (OAuth client, type Web application) add BOTH authorized redirect URIs: ${origin}/api/v1/youtube/callback AND ${origin}/api/v1/auth/google/callback`,
    "9. Troubleshooting: PowerShell blocks npm (.ps1 error) -> run: Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned. Missing db:seed script -> git pull origin main or re-download the latest zip (quick fix: npx tsx prisma/seed.ts). Phone/other PC cannot open http://<your-ip>:3000 -> the dev server binds 0.0.0.0; allow port 3000 in Windows Firewall and remember the first load compiles slowly. Visuals stuck -> visual generation is an async job, watch progress in Studio; restart npm run dev if it froze. Render fails with an FFmpeg error -> run `ffmpeg -version` in a terminal; if 'not recognized' install with winget install Gyan.FFmpeg and CLOSE+REOPEN the terminal, then restart npm run dev; if the error says the build has no libx264 or lacks a filter, install that same full build. Error 'No LLM provider configured' -> add the free Gemini key in Admin -> Integrations.",
    user ? `\nCURRENT USER CONTEXT: name "${user.name}" (role: ${user.role}). Personalize greetings but never reveal internal IDs or emails.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function geminiSupportChat(history: ChatTurn[], apiKey: string, systemPrompt: string): Promise<string> {
  const tunables = await getGeminiTunables();
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: history.map((m) => ({
      role: m.role === "user" ? "user" : "model",
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature: tunables.supportTemperature, maxOutputTokens: 1024 },
  };
  const { text } = await geminiGenerate({
    apiKey,
    body,
    models: DEFAULT_GEMINI_MODELS,
    timeoutMs: Math.min(tunables.timeoutMs, 30000),
    attemptsPerModel: 1,
    sweeps: 1, // support chat should answer fast; the user can just resend
  });
  return text;
}

async function zaiSupportChat(history: ChatTurn[], systemPrompt: string): Promise<string> {
  const zai = await getZAI();
  // Codebase convention: the system prompt is passed as an "assistant"-role message.
  const messages = [
    { role: "assistant", content: systemPrompt },
    ...history,
  ] as unknown as LlmMessage[];
  const completion = await zai.chat.completions.create({
    messages,
    thinking: { type: "disabled" },
  });
  const content: string | undefined =
    completion?.choices?.[0]?.message?.content ?? completion?.content;
  if (!content || !content.trim()) throw new Error("Empty LLM response");
  return content;
}

export function resolveOrigin(req: Request): string {
  const headers = req.headers;
  const proto = headers.get("x-forwarded-proto") ?? "http";
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("429") || m.includes("too many requests") || m.includes("rate limit");
}

/**
 * STREAMING support chat — yields text deltas as they arrive.
 * Provider 1: Gemini SSE stream (self-hosted with key). Provider 2: z-ai SSE stream.
 * If a provider fails BEFORE emitting anything, the next one takes over
 * seamlessly; a mid-stream failure is rethrown after the partial text.
 */
export async function* supportChatStream(
  history: ChatTurn[],
  user: SupportUserCtx,
  origin: string
): AsyncGenerator<string, void, undefined> {
  const turns = history.slice(-12);
  if (!turns.length) throw new HttpError(400, "Empty conversation");
  const systemPrompt = buildSystemPrompt(user, origin);
  let emitted = false;

  // Provider 1 (preferred): Google Gemini free tier (streaming).
  const geminiKey = await getGeminiKey().catch(() => null);
  if (geminiKey) {
    const tunables = await getGeminiTunables();
    try {
      for await (const delta of geminiStreamText({
        apiKey: geminiKey,
        body: {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: turns.map((m) => ({
            role: m.role === "user" ? "user" : "model",
            parts: [{ text: m.content }],
          })),
          generationConfig: { temperature: tunables.supportTemperature, maxOutputTokens: 1024 },
        },
        models: DEFAULT_GEMINI_MODELS,
        timeoutMs: Math.min(tunables.timeoutMs, 30000),
      })) {
        emitted = true;
        yield delta;
      }
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[support-stream] gemini failed:`, msg);
      if (emitted) throw new HttpError(502, "The assistant lost the connection mid-answer. Please resend.");
      if (isZaiUnavailable()) {
        throw new HttpError(502, "The assistant could not reach Gemini. Check the API key in Admin -> Integrations and try again.");
      }
      // fall through to z-ai
    }
  }

  // Provider 2: built-in z-ai SDK (sandbox deployments) — streaming.
  if (!isZaiUnavailable()) {
    try {
      const stream = await zaiChatStream([
        { role: "assistant", content: systemPrompt },
        ...turns,
      ] as unknown as LlmMessage[]);
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const chunk = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              emitted = true;
              yield delta;
            }
          } catch {
            /* partial line */
          }
        }
      }
      if (emitted) return;
      throw new Error("Empty streaming response from z-ai");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[support-stream] z-ai failed:`, msg);
      if (emitted) throw new HttpError(502, "The assistant lost the connection mid-answer. Please resend.");
      if (isRateLimitError(msg)) {
        throw new HttpError(429, "The assistant is rate-limited right now — please retry in about 30 seconds.");
      }
      // last resort: non-streaming completion (still fast with retry budget of 1)
      const reply = await zaiSupportChat(turns, systemPrompt);
      yield reply;
      return;
    }
  }

  throw new HttpError(
    502,
    "The AI assistant is not configured. Add a free Gemini API key in Admin -> Integrations (get one at aistudio.google.com/apikey)."
  );
}

/** Non-streaming support chat (kept for API compatibility / simple clients). */
export async function supportChat(history: ChatTurn[], user: SupportUserCtx, origin: string): Promise<string> {
  const turns = history.slice(-12);
  if (!turns.length) throw new HttpError(400, "Empty conversation");
  const systemPrompt = buildSystemPrompt(user, origin);

  // Provider 1 (preferred for this feature): Google Gemini free tier.
  const geminiKey = await getGeminiKey().catch(() => null);
  if (geminiKey) {
    try {
      return await geminiSupportChat(turns, geminiKey, systemPrompt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[support] gemini failed:`, msg);
      if (isZaiUnavailable()) {
        throw new HttpError(502, "The assistant could not reach Gemini. Check the API key in Admin -> Integrations and try again.");
      }
      // fall through to z-ai
    }
  }

  // Provider 2: built-in z-ai SDK (sandbox deployments).
  if (!isZaiUnavailable()) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await zaiSupportChat(turns, systemPrompt);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[support] z-ai attempt ${attempt} failed:`, msg);
        if (attempt < 2 && isRateLimitError(msg)) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        if (isRateLimitError(msg)) {
          throw new HttpError(429, "The assistant is rate-limited right now — please retry in about 30 seconds.");
        }
        throw new HttpError(502, "The assistant is temporarily unavailable. Please try again in a few seconds.");
      }
    }
  }

  throw new HttpError(
    502,
    "The AI assistant is not configured. Add a free Gemini API key in Admin -> Integrations (get one at aistudio.google.com/apikey)."
  );
}
