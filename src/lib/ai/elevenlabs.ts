/**
 * ElevenLabs text-to-speech (most natural voices, multilingual incl. Hindi).
 * Pure module (no project imports) so it can be unit tested with a mock fetch.
 * API key is saved by the Admin in /admin → API & Integrations → Voice.
 */

/** In-app voice id → ElevenLabs premade voice id. */
export const ELEVEN_VOICES: Record<string, string> = {
  tongtong: "21m00Tcm4TlvDq8ikWAM", // Rachel — warm female
  chuichui: "EXAVITQu4vr4xnSDxMaL", // Sarah — lively female
  xiaochen: "XB0fDUnXU5powFXDhCwa", // Charlotte — calm female
  jam: "JBFqnCBsd6RMkjVDRZzb", // George — British male
  kazi: "pNInz6obpgDQGcFmaJgB", // Adam — clear male
  douji: "TxGEqnHWrfWFTfGW9XjX", // Josh — smooth male
  luodo: "ErXwobaYiN019PkySvjV", // Antoni — expressive male
};

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
