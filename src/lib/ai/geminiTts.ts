import { geminiGenerate, GeminiError } from "./gemini";

/** Gemini speech models (names change over time → tried in order, 404s are skipped). */
export const GEMINI_TTS_MODELS = ["gemini-2.5-flash-preview-tts", "gemini-2.5-flash-tts", "gemini-2.5-pro-preview-tts"];

/** In-app Edge voice id → Gemini prebuilt voice. */
export const GEMINI_VOICE_MAP: Record<string, string> = {
  "en-US-AriaNeural": "Kore",
  "en-US-JennyNeural": "Leda",
  "en-US-MichelleNeural": "Aoede",
  "en-GB-RyanNeural": "Charon",
  "en-US-GuyNeural": "Puck",
  "en-US-ChristopherNeural": "Orus",
  "en-US-AndrewNeural": "Fenrir",
};

/** Wrap raw 16-bit mono PCM into a WAV container. */
export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Official Gemini TTS using the same API key as the text model. Returns WAV (24 kHz mono).
 * Speech models have tight free-tier rate limits, so 429/503 are retried after a pause.
 */
export async function geminiTtsWav(
  text: string,
  voiceName: string,
  apiKey: string,
  opts: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<Buffer> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { audio } = await geminiGenerate({
        apiKey,
        models: GEMINI_TTS_MODELS,
        audio: true,
        timeoutMs: 90000,
        attemptsPerModel: 2,
        sweeps: 1,
        body: {
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        },
      });
      if (!audio) throw new Error("Gemini TTS returned no audio");
      const raw = Buffer.from(audio.data, "base64");
      const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] ?? 24000);
      return raw.subarray(0, 4).toString("latin1") === "RIFF" ? raw : pcmToWav(raw, rate);
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof GeminiError && e.transient;
      if (!retryable || attempt === 3) break;
      await sleep(15000 * attempt); // wait out the per-minute quota window
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
