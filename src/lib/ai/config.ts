import { db } from "@/lib/db";
import { decryptField } from "@/lib/password";

/**
 * AI provider settings resolver — ADMIN PANEL ONLY.
 * All provider keys are configured by an Admin in /admin -> API & Integrations
 * and stored in the AppSetting table (AES-256-GCM encrypted at rest).
 * There is deliberately NO .env fallback: the admin panel is the single source
 * of truth for every API credential in this deployment.
 *
 * PERFORMANCE: every value is cached in memory with a short TTL so hot paths
 * (every LLM/TTS/image call) do not pay a SQLite round-trip + AES decrypt.
 * Admin saves invalidate the cache instantly via invalidateAiConfigCache().
 */

const CACHE_TTL_MS = 15_000;

const cache = new Map<string, { value: string | null; expires: number }>();

async function cached(dbKey: string, encrypted: boolean): Promise<string | null> {
  const hit = cache.get(`${dbKey}:${encrypted ? "enc" : "plain"}`);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value: string | null = null;
  try {
    const row = await db.appSetting.findUnique({ where: { key: dbKey } });
    if (row?.value) value = encrypted ? decryptField(row.value) : row.value;
  } catch {
    value = null;
  }
  cache.set(`${dbKey}:${encrypted ? "enc" : "plain"}`, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Drop all cached AI settings (call after any admin settings write). */
export function invalidateAiConfigCache(): void {
  cache.clear();
}

export async function getAiSetting(dbKey: string, encrypted = false): Promise<string | null> {
  return cached(dbKey, encrypted);
}

/** Google Gemini API key (free tier available at aistudio.google.com/apikey).
 * Configured exclusively via /admin -> API & Integrations. */
export async function getGeminiKey(): Promise<string | null> {
  return cached("gemini_api_key", true);
}

/** ElevenLabs API key (optional, best-quality voices).
 * Configured via /admin -> API & Integrations (encrypted in the DB).
 * Bootstrap fallback: the ELEVENLABS_API_KEY .env variable is used when no
 * admin key is saved yet, so a fresh install works out of the box. */
export async function getElevenLabsKey(): Promise<string | null> {
  const fromDb = await cached("elevenlabs_api_key", true);
  if (fromDb) return fromDb;
  const env = process.env.ELEVENLABS_API_KEY?.trim();
  return env ? env : null;
}

/** Where the ElevenLabs key comes from — used by the admin status endpoint. */
export async function getElevenLabsKeySource(): Promise<"db" | "env" | null> {
  const fromDb = await cached("elevenlabs_api_key", true);
  if (fromDb) return "db";
  return process.env.ELEVENLABS_API_KEY?.trim() ? "env" : null;
}

/* ------------------------------------------------------------------ */
/*  Voice provider preference (Admin -> API & Integrations -> Voice)   */
/* ------------------------------------------------------------------ */

export type VoiceProvider = "auto" | "elevenlabs" | "google" | "edge";

/** Which TTS provider is tried FIRST for voiceovers (admin choice, cached):
 *  - "auto"        : smart chain (ElevenLabs → Gemini TTS → Edge → Translate)
 *  - "elevenlabs"  : force ElevenLabs first for every voice (most natural)
 *  - "google"      : force Google AI Studio voices (Gemini TTS) first
 *  - "edge"        : free Edge neural voices only (no keys needed)
 */
export async function getVoiceProvider(): Promise<VoiceProvider> {
  const v = (await cached("voice_provider", false))?.trim();
  return v === "elevenlabs" || v === "google" || v === "edge" ? v : "auto";
}

export function setAiSettingDirect(value: string | null): void {
  // reserved for future sync use
  void value;
}

/* ------------------------------------------------------------------ */
/*  Gemini generation tunables (Admin -> API & Integrations sliders)  */
/* ------------------------------------------------------------------ */

export type GeminiTunables = {
  /** creative temperature for scripts/ideas (0–2, default 0.8) */
  temperature: number;
  /** support chat temperature (0–1, default 0.5) */
  supportTemperature: number;
  /** max output tokens (default 4096) */
  maxTokens: number;
  /** per-request timeout in ms (default 45000 — tuned for speed) */
  timeoutMs: number;
};

const DEFAULT_TUNABLES: GeminiTunables = {
  temperature: 0.8,
  supportTemperature: 0.5,
  maxTokens: 4096,
  timeoutMs: 45_000,
};

function num(raw: string | null, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Effective Gemini generation settings (admin sliders + defaults), cached.
 * Note: gemini_timeout is stored in SECONDS (admin slider unit). */
export async function getGeminiTunables(): Promise<GeminiTunables> {
  const [t, st, mt, to] = await Promise.all([
    cached("gemini_temperature", false),
    cached("gemini_support_temperature", false),
    cached("gemini_max_tokens", false),
    cached("gemini_timeout", false),
  ]);
  return {
    temperature: num(t, DEFAULT_TUNABLES.temperature, 0, 2),
    supportTemperature: num(st, DEFAULT_TUNABLES.supportTemperature, 0, 1),
    maxTokens: Math.round(num(mt, DEFAULT_TUNABLES.maxTokens, 256, 16384)),
    timeoutMs: Math.round(num(to, DEFAULT_TUNABLES.timeoutMs / 1000, 10, 120) * 1000),
  };
}

export const GEMINI_TUNABLE_DEFAULTS = DEFAULT_TUNABLES;
