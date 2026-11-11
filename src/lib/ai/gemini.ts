/**
 * Resilient Gemini REST client (no SDK, no project imports → easy to unit test).
 *
 * Why this exists: Google answers 503 "model is currently experiencing high
 * demand" in bursts. The old code threw on the very first 503 and never tried
 * another model. This client:
 *   - retries TRANSIENT errors (500/502/503/504, network error, timeout) on the
 *     same model with short backoff,
 *   - then FALLS OVER to the next model in the chain (each model has its own
 *     capacity pool, so a busy "flash" is often fine on "flash-lite"),
 *   - treats 429 (quota) as "try the next model" without waiting on the same one,
 *   - skips models that are gone for this key (404 / deprecated),
 *   - fails fast on errors that no retry can fix (invalid key, 400, 403).
 *
 * SPEED PROFILE (v2): tuned for snappy responses — 1 attempt per model and a
 * single sweep by default (the chain itself is the retry), short backoffs and
 * a tight default timeout. Streaming (`streamGenerateContent?alt=sse`) is
 * supported for chat experiences where perceived latency matters.
 */

export const DEFAULT_GEMINI_MODELS = [
  "gemini-flash-latest", // rolling alias → newest flash
  "gemini-2.5-flash",
  "gemini-flash-lite-latest", // lighter model, usually has spare capacity during spikes
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash", // legacy fallback for older keys
];

export class GeminiError extends Error {
  status: number;
  transient: boolean;
  constructor(message: string, status: number, transient: boolean) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.transient = transient;
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type GeminiOptions = {
  apiKey: string;
  body: Record<string, unknown>;
  models: string[];
  /** per-request timeout (ms) */
  timeoutMs?: number;
  /** attempts per model for transient errors (default 1 — the chain is the retry) */
  attemptsPerModel?: number;
  /** sweeps over the whole chain when everything was busy (default 1) */
  sweeps?: number;
  /** return inline audio (TTS models) instead of text */
  audio?: boolean;
  /** called after a model succeeds (e.g. to remember it) */
  onModelUsed?: (model: string) => void;
  /** test hooks */
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
};

const TRANSIENT = new Set([500, 502, 503, 504]);

function isModelGone(status: number, text: string): boolean {
  const t = text.toLowerCase();
  return (
    status === 404 ||
    t.includes("no longer available") ||
    t.includes("is deprecated") ||
    (t.includes("not found") && t.includes("model"))
  );
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function geminiGenerate(
  opts: GeminiOptions
): Promise<{ text: string; model: string; audio?: { data: string; mimeType: string } }> {
  const {
    apiKey,
    body,
    models,
    timeoutMs = 45000,
    attemptsPerModel = 1,
    sweeps = 1,
    fetchImpl = fetch as FetchLike,
    sleep = defaultSleep,
    log = (m) => console.error(m),
  } = opts;

  // stored keys can carry stray spaces/newlines/quotes from copy-paste
  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, "");

  if (models.length === 0) throw new GeminiError("No Gemini model configured", 500, false);

  let lastErr: GeminiError | null = null;

  for (let sweep = 1; sweep <= sweeps; sweep++) {
    let sawTransient = false;

    for (const model of models) {
      for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
        let res: Response;
        try {
          res = await fetchImpl(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(timeoutMs),
            }
          );
        } catch (e) {
          // network failure / timeout → transient
          const msg = (e instanceof Error ? e.message : String(e)).replaceAll(cleanKey, "***");
          lastErr = new GeminiError(`Gemini network error (${model}): ${msg}`, 0, true);
          sawTransient = true;
          log(`[gemini] ${model} attempt ${attempt}: ${msg}`);
          if (attempt < attemptsPerModel) await sleep(backoff(attempt));
          continue;
        }

        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            candidates?: { content?: { parts?: { text?: string; inlineData?: { data?: string; mimeType?: string } }[] } }[];
          };
          if (opts.audio) {
            const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
            if (part?.inlineData?.data) {
              opts.onModelUsed?.(model);
              return { text: "", model, audio: { data: part.inlineData.data, mimeType: part.inlineData.mimeType ?? "" } };
            }
            lastErr = new GeminiError(`Gemini returned no audio (${model})`, 200, true);
            log(`[gemini] ${model}: no audio in response → next model`);
            break;
          }
          const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
          if (!text.trim()) {
            // empty / safety-blocked answer: another model may answer fine
            lastErr = new GeminiError(`Gemini returned an empty response (${model})`, 200, true);
            log(`[gemini] ${model}: empty response → next model`);
            break;
          }
          opts.onModelUsed?.(model);
          return { text, model };
        }

        const errText = (await res.text().catch(() => "")).replaceAll(cleanKey, "***").slice(0, 300);
        const status = res.status;

        if (TRANSIENT.has(status)) {
          lastErr = new GeminiError(`Gemini API ${status} (${model}): ${errText}`, status, true);
          sawTransient = true;
          log(`[gemini] ${model} attempt ${attempt}/${attemptsPerModel} → ${status} (busy)`);
          if (attempt < attemptsPerModel) {
            await sleep(backoff(attempt, res.headers.get("retry-after")));
            continue;
          }
          break; // give up on this model → next model
        }

        if (status === 429) {
          lastErr = new GeminiError(`Gemini API 429 (${model}): ${errText}`, 429, true);
          sawTransient = true;
          log(`[gemini] ${model} → 429 (quota) → next model`);
          break;
        }

        if (isModelGone(status, errText)) {
          lastErr = new GeminiError(`Gemini API ${status} (${model}): ${errText}`, status, false);
          log(`[gemini] ${model} not available for this key → next model`);
          break;
        }

        // 400 / 401 / 403 …: bad key, bad request, geo-block — retrying cannot help
        throw new GeminiError(`Gemini API ${status} (${model}): ${errText}`, status, false);
      }
    }

    // whole chain failed; only worth another sweep if the failures were load-related
    if (!sawTransient) break;
    if (sweep < sweeps) {
      log(`[gemini] all models busy — pausing before sweep ${sweep + 1}`);
      await sleep(2000 + Math.floor(Math.random() * 600));
    }
  }

  throw lastErr ?? new GeminiError("No Gemini model available for this key", 503, true);
}

/**
 * STREAMING Gemini text generation (`:streamGenerateContent?alt=sse`).
 * Yields incremental text deltas. The model chain is walked on the FIRST
 * failing model only (transient/429/gone → next model); once a model starts
 * streaming, a mid-stream failure rethrows (caller falls back as needed).
 */
export async function* geminiStreamText(opts: {
  apiKey: string;
  body: Record<string, unknown>;
  models: string[];
  timeoutMs?: number;
  onModelUsed?: (model: string) => void;
  log?: (msg: string) => void;
}): AsyncGenerator<string, void, undefined> {
  const { apiKey, body, models, timeoutMs = 45000, onModelUsed, log = (m) => console.error(m) } = opts;
  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, "");
  if (models.length === 0) throw new GeminiError("No Gemini model configured", 500, false);

  let lastErr: GeminiError | null = null;

  for (const model of models) {
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cleanKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        }
      );
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).replaceAll(cleanKey, "***");
      lastErr = new GeminiError(`Gemini network error (${model}): ${msg}`, 0, true);
      log(`[gemini-stream] ${model}: ${msg} → next model`);
      continue;
    }

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => "");
      const status = res.status;
      if (TRANSIENT.has(status) || status === 429 || isModelGone(status, errText)) {
        lastErr = new GeminiError(`Gemini API ${status} (${model}): ${errText.slice(0, 200)}`, status, true);
        log(`[gemini-stream] ${model} → ${status} → next model`);
        continue;
      }
      throw new GeminiError(`Gemini API ${status} (${model}): ${errText.slice(0, 200)}`, status, false);
    }

    onModelUsed?.(model);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emitted = false;
    try {
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
              candidates?: { content?: { parts?: { text?: string }[] } }[];
            };
            const delta = chunk.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
            if (delta) {
              emitted = true;
              yield delta;
            }
          } catch {
            /* partial JSON line — ignore */
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
    if (emitted) return;
    lastErr = new GeminiError(`Gemini stream was empty (${model})`, 200, true);
    log(`[gemini-stream] ${model}: empty stream → next model`);
  }

  throw lastErr ?? new GeminiError("No Gemini model available for this key", 503, true);
}

function backoff(attempt: number, retryAfter?: string | null): number {
  const ra = retryAfter ? Number(retryAfter) * 1000 : NaN;
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra, 5000);
  return 500 * attempt + Math.floor(Math.random() * 250);
}
