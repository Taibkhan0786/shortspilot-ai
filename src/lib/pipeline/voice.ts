import { ttsBuffer } from "@/lib/ai/tts";
import { saveBuffer, uploadPath } from "@/lib/storage";
import { audioDuration, run } from "@/lib/pipeline/render";
import { checkFfmpegReady, ffmpegStatusError } from "@/lib/pipeline/ffmpegCheck";
import fs from "fs/promises";
import path from "path";

export type SceneAudio = { sceneNumber: number; url: string; duration: number };

/**
 * Generate per-scene voiceover audio + concatenated full narration track (PRD §6.7).
 * Scene WAVs are kept on disk (needed later for scene-accurate rendering).
 * Returns stored URLs and real durations measured with ffprobe.
 */
export async function generateVoiceoverForScenes(opts: {
  narrations: string[];
  voice: string;
  speed: number;
  onProgress?: (pct: number, stage: string) => void;
}): Promise<{ fullAudioUrl: string; duration: number; sceneAudio: SceneAudio[] }> {
  const { narrations, voice, speed, onProgress } = opts;
  if (narrations.length === 0) throw new Error("No narration text provided");

  // Voiceover needs ffprobe (durations) + ffmpeg (WAV concat) — fail fast with
  // an install hint instead of a raw ENOENT deep inside the pipeline.
  const ff = await checkFfmpegReady();
  if (!ff.ok) throw ffmpegStatusError(ff);

  const workId = `vo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sceneAudio: SceneAudio[] = [];
  const wavFiles: string[] = [];

  for (let i = 0; i < narrations.length; i++) {
    const text = narrations[i].trim();
    if (!text) {
      sceneAudio.push({ sceneNumber: i + 1, url: "", duration: 0 });
      continue;
    }
    const buffer = await ttsBuffer(text, voice, speed);
    const filename = `${workId}_scene_${i + 1}.wav`;
    const { abs, url } = await saveBuffer("audio", filename, buffer);
    const dur = await audioDuration(abs);
    sceneAudio.push({ sceneNumber: i + 1, url, duration: dur });
    wavFiles.push(abs);
    onProgress?.(Math.round(((i + 1) / narrations.length) * 80), `Generating voice ${i + 1}/${narrations.length}`);
  }

  // concatenate scene audios into one narration track
  // (backslashes → forward slashes so the concat list is Windows-safe)
  const listFile = uploadPath("tmp", `${workId}_list.txt`);
  await fs.writeFile(
    listFile,
    wavFiles.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"),
    "utf8"
  );
  const fullFile = uploadPath("audio", `${workId}_full.wav`);
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", fullFile], 120000, { label: "joining voice tracks" });
  const duration = await audioDuration(fullFile);
  await fs.rm(listFile, { force: true }).catch(() => {});

  onProgress?.(100, "Voiceover ready");
  return {
    fullAudioUrl: `/uploads/audio/${path.basename(fullFile)}`,
    duration,
    sceneAudio,
  };
}
