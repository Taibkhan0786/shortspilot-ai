import { saveBuffer } from "@/lib/storage";

export const IMAGE_SIZES = [
  "1024x1024",
  "768x1344",
  "864x1152",
  "1344x768",
  "1152x864",
  "1440x720",
  "720x1440",
] as const;

/** Parse "WxH" into width/height ints (safe fallbacks). */
function parseSize(size: string): { width: number; height: number } {
  const m = size.match(/^(\d{2,5})x(\d{2,5})$/);
  const width = m ? Math.min(2048, Math.max(256, parseInt(m[1], 10))) : 768;
  const height = m ? Math.min(2048, Math.max(256, parseInt(m[2], 10))) : 1344;
  return { width, height };
}

/**
 * Pollinations.ai fallback — REAL image generation, completely free, no API key.
 * https://image.pollinations.ai — Flux-based endpoint that returns image bytes.
 */
async function pollinationsImage(prompt: string, size: string): Promise<Buffer> {
  const { width, height } = parseSize(size);
  const seed = Math.floor(Math.random() * 1_000_000);
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}` +
    `?width=${width}&height=${height}&seed=${seed}&nologo=true&model=flux&safe=false`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(180000),
    headers: { "User-Agent": "ShortsPilotAI/1.0" },
  });
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error("Pollinations returned tiny/empty image");
  return buf;
}

/** Generate an image: primary provider first, free Pollinations fallback second. */
export async function generateImageBuffer(
  prompt: string,
  size: string = "768x1344"
): Promise<Buffer> {
  // Provider 1: z-ai SDK (works on configured deployments)
  try {
    const { getZAI } = await import("./llm");
    const zai = await getZAI();
    const response = await zai.images.generations.create({ prompt, size: size as (typeof IMAGE_SIZES)[number] });
    const base64 = response?.data?.[0]?.base64;
    if (base64) return Buffer.from(base64, "base64");
    throw new Error("Image generation returned no data");
  } catch (primaryErr) {
    console.error(
      `[image] primary provider unavailable (${primaryErr instanceof Error ? primaryErr.message.slice(0, 120) : primaryErr}) — using Pollinations fallback`
    );
  }
  // Provider 2: Pollinations (free, no key) — a few attempts since the free queue can be slow
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await pollinationsImage(prompt, size);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.error(`[image] pollinations attempt ${attempt} failed: ${lastError.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError ?? new Error("All image providers failed");
}

export async function generateImageFile(
  prompt: string,
  opts: { size?: string; dir?: string; prefix?: string; retries?: number } = {}
): Promise<{ url: string; bytes: number; filename: string }> {
  const { size = "768x1344", dir = "images", prefix = "img", retries = 2 } = opts;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const buffer = await generateImageBuffer(prompt, size);
      const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
      const { url } = await saveBuffer(dir, filename, buffer);
      return { url, bytes: buffer.length, filename };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.error(`[image] attempt ${attempt} failed: ${lastError.message}`);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastError ?? new Error("Image generation failed");
}
