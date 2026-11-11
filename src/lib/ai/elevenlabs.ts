/**
 * ElevenLabs text-to-speech (most natural voices, multilingual incl. Hindi).
 * Pure module (no project imports) so it can be unit tested with a mock fetch.
 * API key is saved by the Admin in /admin → API & Integrations → Voice,
 * or bootstrapped via the ELEVENLABS_API_KEY .env variable.
 *
 * IMPORTANT: every voice id below was verified against the free/starter
 * ElevenLabs plan. "Library" voices that need a paid plan return
 * 402 paid_plan_required — those are deliberately NOT mapped here.
 */

/** In-app voice id → ElevenLabs premade voice id (all verified 200 OK on free plans). */
export const ELEVEN_VOICES: Record<string, string> = {
  // — Classic catalog ids (Studio "Neutral" voices) speak through ElevenLabs too —
  tongtong: "EXAVITQu4vr4xnSDxMaL", // Sarah — warm female
  chuichui: "cgSgspJ2msm6clMCkdW9", // Jessica — lively female
  xiaochen: "XrExE9yKIg1WjnnlVkGX", // Matilda — calm female
  jam: "JBFqnCBsd6RMkjVDRZzb", // George — British male narrator
  kazi: "cjVigY5qzO86Huf0OWal", // Eric — clear male
  douji: "nPczCjzI2devNBz1zQrb", // Brian — smooth deep male
  luodo: "ErXwobaYiN019PkySvjV", // Antoni — expressive male
  // — Dedicated ElevenLabs premium catalog (shown in Studio as "ElevenLabs" tag) —
  "e-sarah": "EXAVITQu4vr4xnSDxMaL", // Sarah — soft, youthful American female
  "e-matilda": "XrExE9yKIg1WjnnlVkGX", // Matilda — friendly, warm American female
  "e-jessica": "cgSgspJ2msm6clMCkdW9", // Jessica — trendy, casual American female
  "e-alice": "Xb7hH8MSUJpSbSDYk0k2", // Alice — confident British female
  "e-george": "JBFqnCBsd6RMkjVDRZzb", // George — warm British male narrator
  "e-daniel": "onwK4e9ZLuTAKqWW03F9", // Daniel — authoritative British male
  "e-adam": "pNInz6obpgDQGcFmaJgB", // Adam — deep, clear American male
  "e-eric": "cjVigY5qzO86Huf0OWal", // Eric — friendly American male
  "e-brian": "nPczCjzI2devNBz1zQrb", // Brian — deep American male narration
  "e-chris": "iP95p4xoKVk53GoZ742B", // Chris — casual, husky American male
  "e-antoni": "ErXwobaYiN019PkySvjV", // Antoni — well-rounded, expressive male
  "e-will": "bIHbv24MWmeRgasZH58o", // Will — friendly everyman American male
};

/** e-* voice → classic catalog twin used when no ElevenLabs key is configured. */
export const ELEVEN_TO_CLASSIC_FALLBACK: Record<string, string> = {
  "e-sarah": "tongtong",
  "e-matilda": "xiaochen",
  "e-jessica": "chuichui",
  "e-alice": "xiaochen",
  "e-george": "jam",
  "e-daniel": "jam",
  "e-adam": "kazi",
  "e-eric": "kazi",
  "e-brian": "douji",
  "e-chris": "luodo",
  "e-antoni": "luodo",
  "e-will": "douji",
};

export function isElevenVoice(id: string): boolean {
  return id.startsWith("e-") && id in ELEVEN_VOICES;
}

export class ElevenLabsError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Returns MP3 bytes. Retries 429/5xx twice; auth/quota errors fail fast with a readable reason. */
export async function elevenLabsMp3(
  text: string,
  voiceKey: string,
  apiKey: string,
  opts: { fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}
): Promise<Buffer> {
  const fetchImpl = opts.fetchImpl ?? (fetch as FetchLike);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const key = apiKey.trim().replace(/^["']|["']$/g, "");
  const voiceId = ELEVEN_VOICES[voiceKey] ?? ELEVEN_VOICES.tongtong;

  let last: ElevenLabsError | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "xi-api-key": key, Accept: "audio/mpeg" },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2", // handles Hindi + English
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
          signal: AbortSignal.timeout(90000),
        }
      );
    } catch (e) {
      last = new ElevenLabsError(`ElevenLabs network error: ${e instanceof Error ? e.message : e}`, 0);
      if (attempt < 3) await sleep(1500 * attempt);
      continue;
    }
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new ElevenLabsError("ElevenLabs returned empty audio", 200);
      return buf;
    }
    const body = (await res.text().catch(() => "")).replaceAll(key, "***").slice(0, 250);
    last = new ElevenLabsError(`ElevenLabs ${res.status}: ${body}`, res.status);
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 3) await sleep(2500 * attempt);
      continue;
    }
    throw last; // 401 bad key, 402/403 plan/quota, 422 bad request → retry cannot help
  }
  throw last ?? new ElevenLabsError("ElevenLabs request failed", 0);
}
