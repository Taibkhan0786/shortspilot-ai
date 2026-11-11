import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { saveBuffer } from "@/lib/storage";
import { getElevenLabsKey, getVoiceProvider } from "./config";
import { geminiTtsWav, GEMINI_VOICE_MAP } from "./geminiTts";
import { elevenLabsMp3, ELEVEN_VOICES, ELEVEN_TO_CLASSIC_FALLBACK, isElevenVoice } from "./elevenlabs";
import { detectLang } from "./lang";
import { getOrderedKeys, withKeyPool } from "./keyPool";

/** Voice catalog mapped to available TTS voices (PRD §6.7).
 * "g-*" ids are REAL Google voices spoken by Gemini TTS (pooled accounts). */
export const VOICES = [
  // — Google Gemini voices (natural, best quality, uses your Gemini accounts) —
  { id: "g-kore", name: "Google Kore", description: "Firm & confident — Gemini voice", accent: "Google", gender: "Female" },
  { id: "g-puck", name: "Google Puck", description: "Upbeat & energetic — Gemini voice", accent: "Google", gender: "Male" },
  { id: "g-charon", name: "Google Charon", description: "Informative & deep — Gemini voice", accent: "Google", gender: "Male" },
  { id: "g-leda", name: "Google Leda", description: "Youthful & warm — Gemini voice", accent: "Google", gender: "Female" },
  { id: "g-zephyr", name: "Google Zephyr", description: "Bright & airy — Gemini voice", accent: "Google", gender: "Female" },
  { id: "g-fenrir", name: "Google Fenrir", description: "Excitable & bold — Gemini voice", accent: "Google", gender: "Male" },
  { id: "g-aoede", name: "Google Aoede", description: "Breezy & light — Gemini voice", accent: "Google", gender: "Female" },
  { id: "g-orus", name: "Google Orus", description: "Authoritative & steady — Gemini voice", accent: "Google", gender: "Male" },
  // — Classic catalog (free, no key needed) —
  { id: "tongtong", name: "Tongtong", description: "Warm & friendly", accent: "Neutral", gender: "Female" },
  { id: "chuichui", name: "Chuichui", description: "Lively & cute", accent: "Neutral", gender: "Female" },
  { id: "xiaochen", name: "Xiaochen", description: "Calm & professional", accent: "Neutral", gender: "Female" },
  { id: "jam", name: "Jam", description: "British gentleman", accent: "British", gender: "Male" },
  { id: "kazi", name: "Kazi", description: "Clear & standard", accent: "Neutral", gender: "Male" },
  { id: "douji", name: "Douji", description: "Natural & smooth", accent: "Neutral", gender: "Male" },
  { id: "luodo", name: "Luodo", description: "Expressive & engaging", accent: "Neutral", gender: "Male" },
  // — ElevenLabs premium voices (most natural, Hindi supported, needs ElevenLabs key) —
  { id: "e-sarah", name: "ElevenLabs Sarah", description: "Soft & youthful — studio quality", accent: "ElevenLabs", gender: "Female" },
  { id: "e-matilda", name: "ElevenLabs Matilda", description: "Friendly & warm — studio quality", accent: "ElevenLabs", gender: "Female" },
  { id: "e-jessica", name: "ElevenLabs Jessica", description: "Trendy & casual — studio quality", accent: "ElevenLabs", gender: "Female" },
  { id: "e-alice", name: "ElevenLabs Alice", description: "Confident British — studio quality", accent: "ElevenLabs", gender: "Female" },
  { id: "e-george", name: "ElevenLabs George", description: "Warm British narrator — studio quality", accent: "ElevenLabs", gender: "Male" },
  { id: "e-daniel", name: "ElevenLabs Daniel", description: "Authoritative British — studio quality", accent: "ElevenLabs", gender: "Male" },
  { id: "e-adam", name: "ElevenLabs Adam", description: "Deep & clear — studio quality", accent: "ElevenLabs", gender: "Male" },
  { id: "e-eric", name: "ElevenLabs Eric", description: "Friendly narrator — studio quality", accent: "ElevenLabs", gender: "Male" },
  { id: "e-brian", name: "ElevenLabs Brian", description: "Deep narration — studio quality", accent: "ElevenLabs", gender: "Male" },
  { id: "e-chris", name: "ElevenLabs Chris", description: "Casual & husky — studio quality", accent: "ElevenLabs", gender: "Male" },
  { id: "e-antoni", name: "ElevenLabs Antoni", description: "Expressive & engaging — studio quality", accent: "ElevenLabs", gender: "Male" },
  { id: "e-will", name: "ElevenLabs Will", description: "Friendly everyman — studio quality", accent: "ElevenLabs", gender: "Male" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];

export function isValidVoice(id: string): boolean {
  return VOICES.some((v) => v.id === id);
}

/** In-app Google voice id → Gemini prebuilt voice name. */
export const GOOGLE_VOICE_MAP: Record<string, string> = {
  "g-kore": "Kore",
  "g-puck": "Puck",
  "g-charon": "Charon",
  "g-leda": "Leda",
  "g-zephyr": "Zephyr",
  "g-fenrir": "Fenrir",
  "g-aoede": "Aoede",
  "g-orus": "Orus",
};

export function isGoogleVoice(id: string): boolean {
  return id in GOOGLE_VOICE_MAP;
}

export function isElevenLabsVoice(id: string): boolean {
  return isElevenVoice(id);
}

/** e-* voice → classic twin used when no ElevenLabs key is available. */
function classicFallbackFor(voice: string): string {
  return ELEVEN_TO_CLASSIC_FALLBACK[voice] ?? "tongtong";
}

export function splitTextIntoChunks(text: string, maxLength = 950): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return [clean];
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) || [clean];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length <= maxLength) {
      current += s;
    } else {
      if (current.trim()) chunks.push(current.trim());
      if (s.length > maxLength) {
        // hard-split very long sentence
        for (let i = 0; i < s.length; i += maxLength) {
          chunks.push(s.slice(i, i + maxLength).trim());
        }
      } else {
        current = s;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** Sleep helper. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("429") || msg.toLowerCase().includes("too many requests");
}

/**
 * Map the in-app voice catalog to Microsoft Edge neural voices (free, no key).
 * These are real HD neural voices served by Microsoft's Edge read-aloud service.
 */
const EDGE_VOICE_MAP: Record<string, string> = {
  tongtong: "en-US-AriaNeural", // warm & friendly female
  chuichui: "en-US-JennyNeural", // lively female
  xiaochen: "en-US-MichelleNeural", // calm professional female
  jam: "en-GB-RyanNeural", // British gentleman
  kazi: "en-US-GuyNeural", // clear standard male
  douji: "en-US-ChristopherNeural", // natural smooth male
  luodo: "en-US-AndrewNeural", // expressive engaging male
};

const FEMALE_VOICES = new Set(["tongtong", "chuichui", "xiaochen"]);

function edgeVoiceFor(voice: string, lang: "hi" | "en" = "en"): string {
  if (lang === "hi") return FEMALE_VOICES.has(voice) || !voice ? "hi-IN-SwaraNeural" : "hi-IN-MadhurNeural";
  return EDGE_VOICE_MAP[voice] ?? "en-US-AriaNeural";
}

/** Convert an audio buffer to a proper WAV (PCM 16-bit mono) using ffmpeg. */
function toWavViaFfmpeg(input: Buffer, ext = "mp3", tempo = 1): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const inPath = path.join(os.tmpdir(), `tts_in_${id}.${ext}`);
    const outPath = path.join(os.tmpdir(), `tts_out_${id}.wav`);
    try {
      fs.writeFileSync(inPath, input);
      const child = spawn("ffmpeg", ["-y", "-i", inPath, ...(tempo !== 1 ? ["-af", `atempo=${tempo}`] : []), "-ar", "24000", "-ac", "1", "-sample_fmt", "s16", outPath], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (d: Buffer) => (stderr += d.toString().slice(0, 2000)));
      child.on("error", (e: Error) => reject(e));
      child.on("close", (code: number | null) => {
        try {
          if (code !== 0) throw new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`);
          const out = fs.readFileSync(outPath);
          if (out.length < 44) throw new Error("ffmpeg produced empty wav");
          resolve(out);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          try { fs.unlinkSync(inPath); } catch { /* ignore */ }
          try { fs.unlinkSync(outPath); } catch { /* ignore */ }
        }
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** One Edge TTS attempt with a fresh connection. Throws a descriptive error on failure. */
async function edgeTtsOnce(text: string, voice: string, speed: number, lang: "hi" | "en"): Promise<Buffer> {
  const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(edgeVoiceFor(voice, lang), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const pct = Math.round((speed - 1) * 100);
    const { audioStream } = tts.toStream(text, {
      rate: `${pct >= 0 ? "+" : ""}${pct}%`,
      pitch: "+0Hz",
      volume: "+0%",
    });
    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
    const mp3 = Buffer.concat(chunks);
    if (mp3.length < 100) throw new Error("Edge TTS returned empty audio");
    return mp3;
  } finally {
    try { (tts as unknown as { close?: () => void }).close?.(); } catch { /* ignore */ }
  }
}

/** Last resort: Google Translate TTS (free, unofficial, ~190 chars per request, speed via ffmpeg). */
async function googleTranslateTts(text: string, lang: "hi" | "en"): Promise<Buffer> {
  const parts: string[] = [];
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > 180) { if (cur) parts.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) parts.push(cur);
  const bufs: Buffer[] = [];
  for (const q of parts) {
    const res = await fetch(
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) }
    );
    if (!res.ok) throw new Error(`Google Translate TTS ${res.status}`);
    bufs.push(Buffer.from(await res.arrayBuffer()));
  }
  const mp3 = Buffer.concat(bufs);
  if (mp3.length < 100) throw new Error("Google Translate TTS returned empty audio");
  return mp3;
}

/** Edge TTS gets blocked often; once it fails twice, skip it for a while instead of waiting every scene. */
let edgeDownUntil = 0;

/**
 * Gemini TTS via the account pool — shared helper so any voice (classic or
 * Google) can be spoken by the Google AI Studio voices when "google" provider
 * is selected or a g-* voice is requested.
 */
async function geminiTtsForVoice(text: string, voice: string, speed: number): Promise<Buffer | null> {
  const keys = await getOrderedKeys().catch(() => [] as string[]);
  if (keys.length === 0) return null;
  const gVoice =
    GOOGLE_VOICE_MAP[voice] ??
    GEMINI_VOICE_MAP[EDGE_VOICE_MAP[voice] ?? "en-US-AriaNeural"] ??
    "Kore";
  const { result: wav } = await withKeyPool((key) => geminiTtsWav(text, gVoice, key), { classify: () => "next" });
  console.error(`[tts] provider: Google AI Studio (Gemini TTS) voice ${gVoice}`);
  return speed !== 1 ? await toWavViaFfmpeg(wav, "wav", speed) : wav;
}

/**
 * ElevenLabs TTS — works for every catalog voice (classic ids map directly;
 * Google g-* ids fall back to the closest natural ElevenLabs voice).
 */
async function elevenLabsForVoice(text: string, voice: string, speed: number): Promise<Buffer> {
  const elKey = await getElevenLabsKey().catch(() => null);
  if (!elKey) throw new Error("no ElevenLabs key configured");
  const elVoice = isGoogleVoice(voice)
    ? (ELEVEN_VOICES[GOOGLE_ELEVEN_FALLBACK[voice] ?? "tongtong"] ?? ELEVEN_VOICES.tongtong)
    : (ELEVEN_VOICES[voice] ?? ELEVEN_VOICES.tongtong);
  const mp3 = await elevenLabsMp3(text, voice, elKey);
  console.error("[tts] provider: ElevenLabs");
  const tempo = speed !== 1 ? Math.min(2, Math.max(0.5, speed)) : 1;
  return await toWavViaFfmpeg(mp3, "mp3", tempo);
}

/** Google voice id → the ElevenLabs voice used when ElevenLabs is forced. */
const GOOGLE_ELEVEN_FALLBACK: Record<string, string> = {
  "g-kore": "tongtong",
  "g-leda": "chuichui",
  "g-aoede": "xiaochen",
  "g-charon": "jam",
  "g-puck": "kazi",
  "g-orus": "douji",
  "g-fenrir": "luodo",
  "g-zephyr": "chuichui",
};

/**
 * Provider chain (best quality first), used when the built-in z-ai provider is unavailable:
 *   1. ElevenLabs   (if an API key is saved in Admin)  — most natural, Hindi supported
 *   2. Gemini TTS   (uses your saved Gemini key)       — natural, Hindi supported
 *   3. Edge neural  (free, but often blocked)
 *   4. Google Translate TTS (free, robotic — last resort)
 * The admin voice_provider preference reorders/skips this chain.
 * Language is auto-detected (Hindi/Devanagari vs English) so the right voice is used.
 * Every failure is logged with its real reason.
 */
async function edgeTtsBuffer(text: string, voice: string, speed: number): Promise<Buffer> {
  const errors: string[] = [];
  const lang = detectLang(text);
  const tempo = speed !== 1 ? Math.min(2, Math.max(0.5, speed)) : 1;
  const provider = await getVoiceProvider().catch(() => "auto" as const);

  // ——— Admin forced "edge": free neural voices only, no provider chain ———
  if (provider === "edge") {
    console.error("[tts] provider: Edge TTS (forced by admin voice provider = edge)");
    const mp3 = await edgeTtsOnce(text, voice, speed, lang);
    try {
      return await toWavViaFfmpeg(mp3);
    } catch {
      return mp3;
    }
  }

  // ——— Admin forced "elevenlabs": ElevenLabs first for EVERY voice ———
  if (provider === "elevenlabs") {
    try {
      return await elevenLabsForVoice(text, voice, speed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`elevenlabs: ${msg.slice(0, 140)}`);
      console.error(`[tts] ElevenLabs (forced) failed: ${msg} — continuing down the chain`);
    }
  }

  // ——— Admin forced "google": Google AI Studio voices first for EVERY voice ———
  if (provider === "google") {
    try {
      const wav = await geminiTtsForVoice(text, voice, speed);
      if (wav) return wav;
      errors.push("google: no Gemini key configured in the account pool");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`google: ${msg.slice(0, 140)}`);
      console.error(`[tts] Google TTS (forced) failed: ${msg} — continuing down the chain`);
    }
  }

  // 1) ElevenLabs (auto mode only — forced mode already tried it above)
  if (provider === "auto") {
    const elKey = await getElevenLabsKey().catch(() => null);
    if (elKey) {
      try {
        const mp3 = await elevenLabsMp3(text, voice, elKey);
        console.error("[tts] provider: ElevenLabs");
        return await toWavViaFfmpeg(mp3, "mp3", tempo);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`elevenlabs: ${msg.slice(0, 140)}`);
        console.error(`[tts] ElevenLabs failed: ${msg}`);
      }
    }
  }

  // 2) Gemini TTS (pooled: every configured Google account is tried) — auto mode only
  if (provider === "auto") {
    try {
      const gVoice = GEMINI_VOICE_MAP[EDGE_VOICE_MAP[voice] ?? "en-US-AriaNeural"] ?? "Kore";
      const keys = await getOrderedKeys().catch(() => [] as string[]);
      if (keys.length > 0) {
        const { result: wav } = await withKeyPool(
          (key) => geminiTtsWav(text, gVoice, key),
          { classify: () => "next" }
        );
        console.error("[tts] provider: Gemini TTS");
        return tempo !== 1 ? await toWavViaFfmpeg(wav, "wav", tempo) : wav;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`gemini: ${msg.slice(0, 140)}`);
      console.error(`[tts] Gemini TTS failed: ${msg}`);
    }
  }

  // 3) Edge (skipped while it is known to be blocked)
  if (Date.now() >= edgeDownUntil) {
    let edgeFailed = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const mp3 = await edgeTtsOnce(text, voice, speed, lang);
        console.error("[tts] provider: Edge TTS");
        try {
          return await toWavViaFfmpeg(mp3);
        } catch (e) {
          console.error(`[tts] wav conversion failed, returning mp3 (${e instanceof Error ? e.message.slice(0, 120) : e})`);
          return mp3;
        }
      } catch (e) {
        edgeFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`edge: ${msg}`);
        console.error(`[tts] Edge TTS attempt ${attempt} failed: ${msg}`);
        if (attempt < 2) await sleep(1500);
      }
    }
    if (edgeFailed >= 2) edgeDownUntil = Date.now() + 10 * 60 * 1000;
  }

  // 4) Google Translate TTS (robotic)
  try {
    const mp3 = await googleTranslateTts(text, lang);
    console.error("[tts] provider: Google Translate TTS (robotic fallback — add an ElevenLabs or Gemini key for natural voices)");
    return await toWavViaFfmpeg(mp3, "mp3", tempo);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`google: ${msg}`);
    console.error(`[tts] Google Translate TTS failed: ${msg}`);
  }

  throw new Error(
    `Voice generation failed — no TTS provider worked (${errors.join(" | ").slice(0, 300)}). ` +
      "Check your internet/VPN/firewall and the keys in Admin → API & Integrations, then try again."
  );
}

/**
 * Generate speech audio (wav) for a text segment. Max 1024 chars per request —
 * longer inputs are chunked and concatenated by the caller.
 * Retries with exponential backoff when the TTS provider rate-limits (429).
 * Providers:
 *   Google voices (g-*): Gemini TTS (pooled accounts) → Edge → Google Translate.
 *   Classic voices:      z-ai SDK → ElevenLabs → Gemini TTS (pooled) → Edge → Google Translate.
 * The admin voice_provider preference (auto/elevenlabs/google/edge) reorders
 * or replaces this chain — see edgeTtsBuffer for the forced modes.
 */
export async function ttsBuffer(
  text: string,
  voice: string = "tongtong",
  speed: number = 1.0
): Promise<Buffer> {
  const clampedSpeed = Math.min(2.0, Math.max(0.5, speed));
  const provider = await getVoiceProvider().catch(() => "auto" as const);

  // ——— Dedicated ElevenLabs voices (e-*): ElevenLabs always speaks them first ———
  if (isElevenVoice(voice)) {
    const elKey = await getElevenLabsKey().catch(() => null);
    if (elKey) {
      try {
        const mp3 = await elevenLabsMp3(text, voice, elKey);
        console.error(`[tts] provider: ElevenLabs (${voice})`);
        return await toWavViaFfmpeg(mp3, "mp3", clampedSpeed);
      } catch (e) {
        console.error(
          `[tts] ElevenLabs voice ${voice} failed (${e instanceof Error ? e.message.slice(0, 140) : e}) — falling back to the classic catalog`
        );
      }
    } else {
      console.error("[tts] ElevenLabs voice selected but no key configured — using free fallback");
    }
    // degrade gracefully to the classic twin (same gender/vibe) and continue down the chain
    voice = classicFallbackFor(voice);
  }

  // ——— Admin forced "elevenlabs": skip z-ai entirely, ElevenLabs speaks every voice ———
  if (provider === "elevenlabs") {
    return edgeTtsBuffer(text, voice, clampedSpeed);
  }

  // ——— Admin forced "edge": free neural voices only ———
  if (provider === "edge") {
    return edgeTtsBuffer(text, voice, clampedSpeed);
  }

  // ——— Google voice selected: go straight to Gemini TTS with the account pool ———
  if (isGoogleVoice(voice)) {
    // forced "google" mode: if the pool fails, try ElevenLabs before Edge
    const geminiName = GOOGLE_VOICE_MAP[voice] ?? "Kore";
    const keys = await getOrderedKeys().catch(() => [] as string[]);
    if (keys.length > 0) {
      try {
        const { result: wav } = await withKeyPool(
          (key) => geminiTtsWav(text, geminiName, key),
          { classify: () => "next" }
        );
        console.error(`[tts] provider: Google AI Studio (Gemini TTS) voice ${geminiName}`);
        if (clampedSpeed !== 1) return await toWavViaFfmpeg(wav, "wav", clampedSpeed);
        return wav;
      } catch (e) {
        console.error(
          `[tts] Google Gemini TTS unavailable (${e instanceof Error ? e.message.slice(0, 140) : e}) — falling back`
        );
      }
    } else {
      console.error("[tts] Google voice selected but no Gemini key configured — using fallback");
    }
    if (provider === "google") {
      try {
        return await elevenLabsForVoice(text, voice, clampedSpeed);
      } catch (e) {
        console.error(`[tts] ElevenLabs fallback failed (${e instanceof Error ? e.message.slice(0, 120) : e})`);
      }
    }
    return edgeTtsBuffer(text, "tongtong", clampedSpeed);
  }

  // ——— Admin forced "google": Google AI Studio voices speak classic voices too ———
  if (provider === "google") {
    return edgeTtsBuffer(text, voice, clampedSpeed);
  }

  const backoffs = [4000, 12000, 30000]; // ~46s max total wait
  let lastErr: unknown;
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      const { getZAI } = await import("./llm");
      const zai = await getZAI();
      const response = await zai.audio.tts.create({
        input: text,
        voice,
        speed: clampedSpeed,
        response_format: "wav",
        stream: false,
      });
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(new Uint8Array(arrayBuffer));
      if (!buffer || buffer.length < 100) throw new Error("TTS returned empty audio");
      return buffer;
    } catch (e) {
      lastErr = e;
      if (isRateLimitError(e) && attempt < backoffs.length) {
        await sleep(backoffs[attempt]);
        continue;
      }
      // fall through to Edge TTS fallback
      console.error(
        `[tts] primary provider unavailable (${e instanceof Error ? e.message.slice(0, 120) : e}) — using Edge TTS fallback`
      );
      break;
    }
  }
  // Fallback: free Edge neural TTS
  return edgeTtsBuffer(text, voice, clampedSpeed);
}

export async function ttsPreview(
  text: string,
  voice: string,
  speed: number
): Promise<{ url: string; bytes: number }> {
  const buffer = await ttsBuffer(text.slice(0, 1000), voice, speed);
  const filename = `preview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`;
  const { url } = await saveBuffer("audio", filename, buffer);
  return { url, bytes: buffer.length };
}
