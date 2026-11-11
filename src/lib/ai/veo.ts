import { getGeminiKey, getAiSetting } from "./config";
import { withKeyPool, maskKey } from "./keyPool";

/**
 * Google Veo — image-to-video ("cinematic photo motion") via the Gemini API.
 *
 * Two admin-selectable engines (Admin → API & Integrations → Video engine):
 *   - "veo3"  : Flow-AI style cinematic quality (Veo 3 first, best realism)
 *   - "omni"  : Omni Flash fast mode (fastest model first, shorter clips)
 *
 * When enabled, each scene's still image is animated into a short realistic
 * clip by Veo before rendering (Google Flow-style movement instead of the
 * FFmpeg zoom-pan). All configured Gemini accounts are pooled: when one
 * account's quota runs out the next key takes over automatically.
 *
 * Requirements: a Gemini API key with billing enabled (Veo is paid-only).
 * Every failure falls back gracefully to the built-in cinematic zoom-pan.
 */

export type VeoEngine = "veo3" | "omni";

const VEO_MODEL_CHAINS: Record<VeoEngine, string[]> = {
  veo3: [
    "veo-3.0-generate-preview", // Flow-AI quality
    "veo-3.0-fast-generate-preview", // same family, quicker
    "veo-2.0-generate-001", // older fallback (5–8s, 9:16)
  ],
  omni: [
    "veo-3.0-fast-generate-preview", // Omni Flash — speed first
    "veo-2.0-generate-001",
  ],
};

export async function isVeoEnabled(): Promise<boolean> {
  return (await getAiSetting("veo_enabled").catch(() => null)) === "true";
}

export async function getVeoEngine(): Promise<VeoEngine> {
  const v = (await getAiSetting("veo_engine").catch(() => null))?.trim();
  return v === "omni" ? "omni" : "veo3";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type VeoClipOptions = {
  /** JPEG/PNG bytes of the source scene image */
  image: Buffer;
  mimeType: string;
  /** Motion description for the scene (the motionPrompt + narration) */
  prompt: string;
  /** Desired clip length in seconds (Veo supports 4–8; clamped) */
  seconds?: number;
  /** Polling budget in ms (default 4 min; Omni Flash defaults to 3 min) */
  maxWaitMs?: number;
  /** Explicit API key — when omitted the whole Gemini account pool is used */
  apiKey?: string;
  engine?: VeoEngine;
  log?: (msg: string) => void;
};

export type VeoClipResult = { video: Buffer; model: string; key: string };

/**
 * Flow-AI style motion directive — appended to every Veo motion prompt so the
 * result moves like a real cinematic shot instead of a static zoom:
 * realistic human movement, parallax, filmic camera work.
 */
export function cinematicMotionDirective(engine: VeoEngine = "veo3"): string {
  return [
    "Animate this still image as an ultra-realistic cinematic video shot.",
    "CHARACTER LOCK: keep the main character's face, hairstyle, outfit and body EXACTLY identical to the input image for the whole shot — the same person, no identity drift.",
    "Real human subjects move naturally: subtle breathing, micro facial expressions, natural hand gestures, eyes blink; hair and clothing react to ambient wind.",
    "Subject and background move with gentle parallax depth; the environment stays alive (soft light shifts, floating particles, ambient motion).",
    engine === "omni"
      ? "Camera: one smooth, subtle move (slow push-in or gentle drift). Keep it stable and fast to render."
      : "Camera: slow cinematic push-in with soft drift, shallow depth of field, filmic motion blur, 35mm anamorphic look.",
    "Photoreal skin texture and consistent lighting throughout; no morphing, no distortion, no flicker.",
    "No text, no captions, no watermark, no glitch effects.",
  ].join(" ");
}

/** Build the full motion prompt for a scene (used by the render job). */
export function buildMotionPrompt(opts: { caption?: string | null; narration?: string | null; extra?: string | null; engine?: VeoEngine }): string {
  const { caption, narration, extra, engine } = opts;
  return [
    caption ? `Scene about: ${caption}` : "",
    narration ? `Narration context: ${narration.slice(0, 300)}` : "",
    extra ? extra.slice(0, 400) : "",
    cinematicMotionDirective(engine),
  ].filter(Boolean).join(". ");
}

function isFatalKeyError(status: number, text: string): boolean {
  const t = text.toLowerCase();
  // invalid/missing key, permission denied, bad request body — another account may still work,
  // but a truly malformed key repeats on every account only if ALL are broken; treat auth errors as per-key fatal
  return status === 401 || status === 403 || (status === 400 && (t.includes("api key") || t.includes("api_key")));
}

/** Generate one short image-to-video clip. Throws on failure (caller falls back). */
export async function generateVeoClip(opts: VeoClipOptions): Promise<VeoClipResult> {
  const { image, mimeType, prompt, seconds, maxWaitMs, apiKey, engine: engineOpt, log = (m) => console.error(m) } = opts;
  const engine = engineOpt ?? (await getVeoEngine());
  const durationSeconds = Math.min(8, Math.max(4, Math.round(seconds ?? (engine === "omni" ? 6 : 8))));
  const waitMs = maxWaitMs ?? (engine === "omni" ? 3 * 60_000 : 4 * 60_000);
  const base64 = image.toString("base64");

  const runWithKey = (apiKey: string): Promise<{ video: Buffer; model: string }> =>
    generateVeoClipWithKey({ apiKey, base64, mimeType, prompt, durationSeconds, maxWaitMs: waitMs, engine, log });

  if (apiKey) {
    const { video, model } = await runWithKey(apiKey.trim().replace(/^["']|["']$/g, ""));
    return { video, model, key: maskKey(apiKey) };
  }

  const { result, key } = await withKeyPool(runWithKey, {
    classify: () => "next", // any per-key failure → try the next account
    log,
  });
  return { ...result, key: maskKey(key) };
}

async function generateVeoClipWithKey(args: {
  apiKey: string;
  base64: string;
  mimeType: string;
  prompt: string;
  durationSeconds: number;
  maxWaitMs: number;
  engine: VeoEngine;
  log: (msg: string) => void;
}): Promise<{ video: Buffer; model: string }> {
  const { apiKey, base64, mimeType, prompt, durationSeconds, maxWaitMs, engine, log } = args;
  const models = VEO_MODEL_CHAINS[engine];
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      // 1) queue the long-running generation
      const startRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            instances: [
              {
                prompt: prompt.slice(0, 1500),
                image: { bytesBase64Encoded: base64, mimeType },
              },
            ],
            parameters: { aspectRatio: "9:16", durationSeconds, generateAudio: false },
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );
      if (!startRes.ok) {
        const errText = (await startRes.text().catch(() => "")).slice(0, 300);
        lastError = new Error(`Veo ${model} rejected: ${errText}`);
        log(`[veo] ${model} → ${startRes.status}: ${errText}`);
        if (isFatalKeyError(startRes.status, errText)) throw lastError; // this account is broken → next account
        continue; // model unavailable on this key → next model
      }
      const op = (await startRes.json()) as { name?: string };
      if (!op.name) {
        lastError = new Error(`Veo ${model}: no operation name returned`);
        continue;
      }

      // 2) poll the operation until done
      const deadline = Date.now() + maxWaitMs;
      let videoUri: string | null = null;
      while (Date.now() < deadline) {
        await sleep(8000);
        const pollRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${op.name}`, {
          headers: { "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(20_000),
        });
        if (!pollRes.ok) continue; // transient poll failure — keep waiting
        const opData = (await pollRes.json()) as {
          done?: boolean;
          error?: { message?: string };
          response?: {
            generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] };
            generatedVideos?: { video?: { uri?: string } }[];
            videos?: { uri?: string }[];
          };
        };
        if (opData.error) {
          lastError = new Error(`Veo ${model} failed: ${opData.error.message?.slice(0, 200)}`);
          break;
        }
        if (!opData.done) continue;
        videoUri =
          opData.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ??
          opData.response?.generatedVideos?.[0]?.video?.uri ??
          opData.response?.videos?.[0]?.uri ??
          null;
        break;
      }
      if (!videoUri) {
        if (!lastError) lastError = new Error(`Veo ${model} timed out after ${Math.round(maxWaitMs / 1000)}s`);
        continue;
      }

      // 3) download the mp4 (uri requires the key appended)
      const sep = videoUri.includes("?") ? "&" : "?";
      const dl = await fetch(`${videoUri}${sep}key=${encodeURIComponent(apiKey)}`, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!dl.ok) {
        lastError = new Error(`Veo download failed (${dl.status})`);
        continue;
      }
      const buf = Buffer.from(await dl.arrayBuffer());
      if (buf.length < 10_000) {
        lastError = new Error("Veo returned a tiny/empty clip");
        continue;
      }
      log(`[veo] ${model}: clip ready (${Math.round(buf.length / 1024)} KB)`);
      return { video: buf, model };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      log(`[veo] ${model}: ${lastError.message} → next model`);
      if (isFatalKeyError(400, lastError.message) && /api key/i.test(lastError.message)) throw lastError;
    }
  }
  throw lastError ?? new Error("Veo generation failed for all models");
}
