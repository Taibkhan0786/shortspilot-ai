import { getAiSetting } from "./config";

/**
 * Gemini API key POOL — combine multiple Google accounts so their AI quotas
 * add up (e.g. 10 accounts x 50 credits each = 500 pooled credits).
 *
 * Admin -> API & Integrations stores:
 *   - gemini_api_key  (primary key, AES-256-GCM encrypted)
 *   - gemini_api_keys (JSON string[] of extra account keys, encrypted)
 *
 * Rotation strategy:
 *   - round-robin start position so usage spreads evenly across accounts,
 *   - a key that answers with a quota error (429 / RESOURCE_EXHAUSTED) is put
 *     on a 10-minute cooldown and skipped until it cools down,
 *   - a key with a fatal error (invalid key / 400) is skipped for this call
 *     but rejoins the pool later (the admin may have fixed billing),
 *   - after every success the cursor advances so the next request starts at
 *     the next account.
 */

const COOLDOWN_MS = 10 * 60_000;

let rrIndex = 0;
const cooldownUntil = new Map<string, number>();

function cleanKey(k: string): string {
  return k.trim().replace(/^["']|["']$/g, "");
}

/** All configured keys: primary + pool, deduped, order-preserving. */
export async function getGeminiKeyPool(): Promise<string[]> {
  const [primary, poolRaw] = await Promise.all([
    getAiSetting("gemini_api_key", true).catch(() => null),
    getAiSetting("gemini_api_keys", true).catch(() => null),
  ]);
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const k = raw ? cleanKey(raw) : "";
    if (k && k.length >= 20 && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };
  push(primary);
  if (poolRaw) {
    try {
      const arr = JSON.parse(poolRaw) as unknown;
      if (Array.isArray(arr)) for (const k of arr) push(String(k));
    } catch {
      /* corrupt pool entry — ignore, primary still works */
    }
  }
  return keys;
}

/** Keys ordered for this request: non-cooling first, rotated by the cursor. */
export async function getOrderedKeys(): Promise<string[]> {
  const pool = await getGeminiKeyPool();
  if (pool.length <= 1) return pool;
  const now = Date.now();
  const hot = pool.filter((k) => (cooldownUntil.get(k) ?? 0) <= now);
  const cold = pool.filter((k) => (cooldownUntil.get(k) ?? 0) > now);
  const ordered = hot.length > 0 ? [...hot, ...cold] : pool;
  const start = ((rrIndex % ordered.length) + ordered.length) % ordered.length;
  return [...ordered.slice(start), ...ordered.slice(0, start)];
}

export function rotateKey(): void {
  rrIndex++;
}

/** Put a quota-exhausted key on cooldown so the pool skips it for a while. */
export function cooldownKey(key: string, ms = COOLDOWN_MS): void {
  cooldownUntil.set(key, Date.now() + ms);
}

export function isKeyCooling(key: string): boolean {
  return (cooldownUntil.get(key) ?? 0) > Date.now();
}

export function maskKey(key: string): string {
  return key.length > 14 ? `${key.slice(0, 8)}…${key.slice(-4)}` : "***";
}

export type KeyVerdict = "next" | "abort";

/**
 * Run `fn(key)` across the pool until one key succeeds.
 * `classify(err)` returns "next" (try another account) or "abort" (fail fast).
 * Keys classified as quota errors are automatically cooled down.
 */
export async function withKeyPool<T>(
  fn: (apiKey: string) => Promise<T>,
  opts: {
    classify?: (e: unknown) => KeyVerdict;
    log?: (msg: string) => void;
  } = {}
): Promise<{ result: T; key: string }> {
  const { classify, log = (m) => console.error(m) } = opts;
  const keys = await getOrderedKeys();
  if (keys.length === 0) {
    throw new Error("No Gemini API key configured (Admin → API & Integrations)");
  }
  let lastErr: unknown = null;
  for (const key of keys) {
    try {
      const result = await fn(key);
      rotateKey(); // even out usage across accounts
      return { result, key };
    } catch (e) {
      lastErr = e;
      const verdict = classify ? classify(e) : "next";
      const msg = e instanceof Error ? e.message.slice(0, 140) : String(e);
      log(`[keypool] ${maskKey(key)} → ${msg}${verdict === "abort" ? " (fatal — stopping)" : " → trying next account"}`);
      if (/429|resource.?exhausted|quota/i.test(msg)) cooldownKey(key);
      if (verdict === "abort") throw e;
    }
  }
  throw lastErr ?? new Error("All Gemini accounts in the pool failed");
}
