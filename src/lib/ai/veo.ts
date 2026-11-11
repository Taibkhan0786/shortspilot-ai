import { getGeminiKey, getAiSetting } from "./config";

/**
 * Google Veo — image-to-video ("cinematic photo motion") via the Gemini API.
 *
 * When enabled in Admin -> API & Integrations ("Veo cinematic motion"), each
 * scene's still image is animated into a short realistic clip by Veo before
 * rendering (Google Flow-style movement instead of FFmpeg zoom-pan).
 *
 * Requirements: a Gemini API key with billing enabled (Veo is paid-only).
 * Every failure falls back gracefully to the built-in cinematic zoom-pan.
 */

const VEO_MODELS = [
  "veo-3.0-fast-generate-preview", // fastest, preferred
  "veo-3.0-generate-preview",
  "veo-2.0-generate-001", // older fallback (5–8s, 9:16)
];

export async function isVeoEnabled(): Promise<boolean> {
  return (await getAiSetting("veo_enabled").catch(() => null)) === "true";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type VeoClipOptions = {
  /** JPEG/PNG bytes of the source scene image */
  image: Buffer;
  mimeType: string;
  /** Motion description for the scene (the visualPrompt + motion direction) */
  prompt: string;
  /** Desired clip length in seconds (Veo supports 4–8; clamped) */
  seconds?: number;
  /** Polling budget in ms (default 4 minutes) */
  maxWaitMs?: number;
  log?: (msg: string) => void;
};

export type VeoClipResult = { video: Buffer; model: string };

/** Generate one short image-to-video clip. Throws on failure (caller falls back). */
export async function generateVeoClip(opts: VeoClipOptions): Promise<VeoClipResult> {
  const { image, mimeType, prompt, seconds = 8, maxWaitMs = 4 * 60_000, log = (m) => console.error(m) } = opts;
  const apiKey = (await getGeminiKey().catch(() => null))?.trim().replace(/^["']|["']$/g, "");
  if (!apiKey) throw new Error("Veo requires a Gemini API key (Admin → API & Integrations)");

  const durationSeconds = Math.min(8, Math.max(4, Math.round(seconds)));
  const base64 = image.toString("base64");

  let lastError: Error | null = null;
  for (const model of VEO_MODELS) {
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
        continue;
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
    }
  }
  throw lastError ?? new Error("Veo generation failed for all models");
}
