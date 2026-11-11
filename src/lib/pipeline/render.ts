import { execFile } from "child_process";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import { uploadPath, urlToAbs } from "@/lib/storage";
import { DEVANAGARI_RE } from "@/lib/ai/lang";
import {
  checkFfmpegReady,
  describeFfmpegFailure,
  ffmpegStatusError,
} from "@/lib/pipeline/ffmpegCheck";

export const OUT_W = 1080;
export const OUT_H = 1920;
export const FPS = 30;

/** Crossfade length between scenes (seconds) — gives the Flow-style smooth blend. */
const CROSSFADE_S = 0.3;

/**
 * Resolve a usable text font across operating systems (Windows / macOS / Linux).
 * Returns null when no known font exists — rendering then continues without
 * text overlays instead of failing the whole job.
 */
function resolveSystemFont(): string | null {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Windows\\Fonts\\arialbd.ttf",
          "C:\\Windows\\Fonts\\segoeuib.ttf",
          "C:\\Windows\\Fonts\\arial.ttf",
          "C:\\Windows\\Fonts\\calibrib.ttf",
        ]
      : process.platform === "darwin"
        ? [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
          ]
        : [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
          ];
  for (const c of candidates) {
    try {
      if (fsSync.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const SYSTEM_FONT = resolveSystemFont();

/**
 * Font for Hindi / Devanagari captions. Latin fonts (Arial, DejaVu) have no
 * Devanagari glyphs → captions render as empty boxes (□□□). Override with
 * CAPTION_FONT_DEVANAGARI=<path to .ttf> if your system uses another font.
 */
function resolveDevanagariFont(): string | null {
  const candidates = [
    process.env.CAPTION_FONT_DEVANAGARI ?? "",
    ...(process.platform === "win32"
      ? [
          "C:\\Windows\\Fonts\\NirmalaB.ttf", // Nirmala UI Bold (Windows 10/11)
          "C:\\Windows\\Fonts\\Nirmala.ttf",
          "C:\\Windows\\Fonts\\mangalb.ttf", // Mangal
          "C:\\Windows\\Fonts\\mangal.ttf",
          "C:\\Windows\\Fonts\\Aparajb.ttf",
        ]
      : process.platform === "darwin"
        ? ["/System/Library/Fonts/Kohinoor.ttc", "/System/Library/Fonts/Supplemental/DevanagariMT.ttc"]
        : [
            "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansDevanagari-Bold.ttf",
            "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
            "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf",
            "/usr/share/fonts/truetype/samyak-fonts/Samyak-Devanagari.ttf",
          ]),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fsSync.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

const DEVANAGARI_FONT = resolveDevanagariFont();

export function run(
  cmd: string,
  args: string[],
  timeoutMs = 300000,
  opts: { cwd?: string; label?: string } = {}
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024, cwd: opts.cwd, windowsHide: true, encoding: "utf8" },
      (err: import("child_process").ExecFileException | null, stdout: string, stderr: string) => {
        if (err) {
          const label = opts.label ?? cmd;
          // Spawn-level failure (not installed / not on PATH) has a string errno code.
          if (typeof err.code === "string") {
            const what = cmd === "ffprobe" ? "ffprobe" : "FFmpeg";
            console.error(`[ffmpeg] ${label}: spawn ${cmd} failed (${err.code})`);
            reject(new Error(
              `Cannot render: ${what} is not installed or not on PATH. Windows fix: winget install Gyan.FFmpeg, then CLOSE and REOPEN the terminal and restart the dev server.`.slice(0, 380)
            ));
            return;
          }
          // Real ffmpeg failure — surface the actual stderr reason FIRST so the
          // job-error truncation (400 chars) never hides it behind the command line.
          const { reason, hint } = describeFfmpegFailure(stderr, Boolean(err.killed));
          console.error(
            `[ffmpeg] ${label} failed\n  cmd: ${cmd} ${args.join(" ").slice(0, 500)}\n  stderr: ${stderr.slice(-1200)}`
          );
          const msg = `FFmpeg failed while ${label}: ${reason}${hint ? ` ${hint}` : ""} (full log in the dev-server console)`;
          reject(new Error(msg.slice(0, 380)));
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });
}

/**
 * Detect the real container/codec of a file via magic bytes. Returns null when
 * the content is not a known media format (e.g. an HTML error page saved as
 * .png by a failed image provider) — this catches corrupt inputs BEFORE ffmpeg
 * runs and turns cryptic errors into actionable ones.
 */
async function sniffMediaType(file: string, kind: "image" | "audio" | "video"): Promise<string | null> {
  let fh: fsSync.promises.FileHandle;
  try {
    fh = await fs.open(file, "r");
  } catch {
    return null; // missing → caller already reported a clearer error
  }
  try {
    const buf = Buffer.alloc(12);
    await fh.read(buf, 0, 12, 0);
    const s = (a: number, b: number) => buf.subarray(a, b).toString("latin1");
    if (kind === "image") {
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
      if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
      if (s(0, 4) === "RIFF" && s(8, 12) === "WEBP") return "webp";
      if (s(0, 3) === "GIF") return "gif";
      if (buf[0] === 0x42 && buf[1] === 0x4d) return "bmp";
      return null;
    }
    if (kind === "video") {
      if (s(4, 8) === "ftyp") return "mp4";
      if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
      return null;
    }
    if (s(0, 4) === "RIFF" && s(8, 12) === "WAVE") return "wav";
    if (s(0, 3) === "ID3") return "mp3";
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3"; // MPEG/ADTS frame sync
    if (s(0, 4) === "OggS") return "ogg";
    if (s(0, 4) === "fLaC") return "flac";
    if (s(4, 8) === "ftyp") return "m4a";
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
    return null;
  } catch {
    return null;
  } finally {
    await fh.close().catch(() => {});
  }
}

export async function probeMedia(file: string) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format", "-show_streams",
    file,
  ], 30000, { label: `probing ${path.basename(file)}` });
  return JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: {
      codec_type?: string;
      width?: number;
      height?: number;
      duration?: string;
      codec_name?: string;
    }[];
  };
}

export async function audioDuration(file: string): Promise<number> {
  const info = await probeMedia(file);
  const s = info.streams?.find((x) => x.codec_type === "audio");
  return parseFloat(s?.duration || info.format?.duration || "0");
}

export async function videoDuration(file: string): Promise<number> {
  const info = await probeMedia(file);
  return parseFloat(info.format?.duration || "0");
}

/** Detect unintentionally silent audio via RMS level (PRD §6.9 quality checks). */
export async function detectSilence(file: string): Promise<{ silent: boolean; rmsDb: number }> {
  try {
    const { stderr } = await run("ffmpeg", [
      "-i", file, "-af", "astats=metadata=1:reset=0", "-f", "null", "-",
    ], 60000, { label: "audio silence check" });
    const m = stderr.match(/RMS level dB:\s*(-?[\d.]+)/);
    const rmsDb = m ? parseFloat(m[1]) : -99;
    return { silent: rmsDb < -55, rmsDb };
  } catch {
    return { silent: false, rmsDb: -99 };
  }
}

/** Wrap caption text into short lines for drawtext. */
function wrapCaption(text: string, maxChars = 16, maxLines = 3): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if ((current + " " + w).trim().length <= maxChars) {
      current = (current + " " + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.join("\n");
}

/** rename() fails across drives/volumes (EXDEV) — fall back to copy + delete. */
async function moveFile(from: string, to: string) {
  try {
    await fs.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await fs.copyFile(from, to);
    await fs.rm(from, { force: true });
  }
}

export type SceneInput = {
  sceneNumber: number;
  assetUrl: string; // public path /uploads/images/x.png
  audioUrl: string; // public path /uploads/audio/x.wav
  caption?: string | null;
  /** optional AI motion clip (Veo) for this scene — absolute path to an mp4 */
  motionClip?: string | null;
};

export type RenderResult = {
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
  width: number;
  height: number;
  warnings: string[];
};

/**
 * Cinematic motion presets cycled per scene (Flow-style variety):
 * eased (cosine) zoom in/out with subtle directional drifts. The zoompan filter
 * clamps x/y into the valid window, so pans can never reveal black edges.
 */
function kenBurnsChain(variant: number, frames: number): string[] {
  const N = Math.max(frames, 1);
  // smooth 0→1 ease-in-out across the clip
  const ease = `(0.5-0.5*cos(PI*on/${N}))`;
  const cx = "iw/2-(iw/zoom/2)";
  const cy = "ih/2-(ih/zoom/2)";
  const panAmp = 0.5; // fraction of the available pan window actually used
  const zoomAmp = 0.13;
  let z: string;
  let x: string;
  let y: string;
  switch (variant % 4) {
    case 1: // zoom OUT, centered (start tight, settle wide)
      z = `max(1.001,${(1 + zoomAmp).toFixed(3)}-${zoomAmp}*${ease})`;
      x = cx;
      y = cy;
      break;
    case 2: // zoom IN + drift right
      z = `1+${zoomAmp}*${ease}`;
      x = `${cx}+(iw-iw/zoom)*${panAmp}*${ease}`;
      y = cy;
      break;
    case 3: // zoom IN + drift up
      z = `1+${zoomAmp}*${ease}`;
      x = cx;
      y = `${cy}-(ih-ih/zoom)*${panAmp}*${ease}`;
      break;
    default: // classic slow zoom IN, centered
      z = `1+${zoomAmp}*${ease}`;
      x = cx;
      y = cy;
  }
  return [
    `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase`,
    `crop=${OUT_W}:${OUT_H}`,
    // light cinematic grade (cheap, no extra pass)
    `eq=contrast=1.05:saturation=1.07`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${OUT_W}x${OUT_H}:fps=${FPS}`,
  ];
}

/**
 * Render a vertical 1080x1920 MP4 from scene images + per-scene narration audio,
 * with caption overlay, cinematic eased photo-motion (or optional Veo AI motion
 * clips), smooth crossfades between scenes, and optional watermark (PRD §6.9).
 *
 * Cross-platform notes (Windows / macOS / Linux):
 *  - ffmpeg filtergraph options cannot contain raw Windows paths (the drive
 *    colon and backslashes break filter parsing). Therefore the font and the
 *    caption text files are staged INSIDE the work dir and referenced by
 *    plain relative filenames, with the ffmpeg process cwd set to workDir.
 *  - Scene image/audio inputs are passed as direct arguments (no filter
 *    parsing involved), so absolute OS-native paths are safe there.
 */
export async function renderShort(
  scenes: SceneInput[],
  opts: { watermark?: boolean; onProgress?: (p: number, stage: string) => Promise<void> | void } = {}
): Promise<RenderResult> {
  const { watermark = false, onProgress } = opts;
  if (scenes.length === 0) throw new Error("No scenes to render");

  // Preflight: fail fast with an actionable message when FFmpeg/ffprobe are
  // missing or the installed build cannot produce MP4s (libx264) or lacks
  // required filters (zoompan/drawtext) — common on fresh Windows machines.
  const ff = await checkFfmpegReady();
  if (!ff.ok) throw ffmpegStatusError(ff);

  const workDir = uploadPath("tmp", `render_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(workDir, { recursive: true });
  const warnings: string[] = [];

  // Stage the font inside workDir under a fixed relative name so drawtext
  // never sees an OS-specific absolute path.
  let fontFile: string | null = null;
  if (SYSTEM_FONT) {
    try {
      fontFile = "sp_font.ttf";
      await fs.copyFile(SYSTEM_FONT, path.join(workDir, fontFile));
    } catch {
      fontFile = null;
    }
  }

  // Devanagari-capable font staged next to the Latin one (relative name, same Windows-safe approach)
  let devFontFile: string | null = null;
  if (DEVANAGARI_FONT) {
    try {
      devFontFile = "sp_font_dev.ttf";
      await fs.copyFile(DEVANAGARI_FONT, path.join(workDir, devFontFile));
    } catch {
      devFontFile = null;
    }
  }
  if (scenes.some((sc) => sc.caption && DEVANAGARI_RE.test(sc.caption)) && !devFontFile) {
    warnings.push(
      "Hindi captions need a Devanagari font (Windows: Nirmala UI; Linux: fonts-noto-core). None found, so captions may show as boxes — set CAPTION_FONT_DEVANAGARI=<font path>."
    );
  }

  try {
    const clipFiles: string[] = [];
    const clipDurations: number[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const img = urlToAbs(scene.assetUrl);
      const aud = urlToAbs(scene.audioUrl);
      try {
        await fs.access(img);
      } catch {
        throw new Error(`Scene ${i + 1} image is missing on disk (${scene.assetUrl}) — regenerate the visuals for this video and try again.`);
      }
      try {
        await fs.access(aud);
      } catch {
        throw new Error(`Scene ${i + 1} audio is missing on disk (${scene.audioUrl}) — regenerate the voiceover for this video and try again.`);
      }

      // Content sanity: a 0-byte file or an HTML error page saved as .png makes
      // ffmpeg die with a cryptic message — catch it here with a clear one.
      const imgStat = await fs.stat(img);
      if (imgStat.size === 0) {
        throw new Error(`Scene ${i + 1} image file is empty (0 bytes) — regenerate the visuals for this video and try again.`);
      }
      if ((await sniffMediaType(img, "image")) === null) {
        throw new Error(`Scene ${i + 1} image file is corrupt or not a real image — regenerate the visuals for this video and try again.`);
      }
      const audStat = await fs.stat(aud);
      if (audStat.size === 0) {
        throw new Error(`Scene ${i + 1} audio file is empty (0 bytes) — regenerate the voiceover for this video and try again.`);
      }
      if ((await sniffMediaType(aud, "audio")) === null) {
        throw new Error(`Scene ${i + 1} audio file is corrupt or not real audio — regenerate the voiceover for this video and try again.`);
      }

      const audioDur = Math.max(1.2, await audioDuration(aud));
      const clipDur = audioDur + 0.35; // small breathing pad between scenes
      const clipFile = path.join(workDir, `scene_${i}.mp4`);

      // caption text file for safe escaping (staged in workDir, relative name)
      let textFile: string | null = null;
      const isHindi = Boolean(scene.caption && DEVANAGARI_RE.test(scene.caption));
      const capFont = isHindi ? (devFontFile ?? fontFile) : fontFile;
      const captionText = scene.caption && capFont ? wrapCaption(scene.caption) : "";
      if (captionText) {
        textFile = `cap_${i}.txt`;
        await fs.writeFile(path.join(workDir, textFile), captionText, "utf8");
      }

      const overlays: string[] = [];
      if (textFile && capFont) {
        overlays.push(
          `drawtext=fontfile=${capFont}:textfile=${textFile}:fontsize=58:fontcolor=white:borderw=3:bordercolor=black@0.9:box=1:boxcolor=black@0.45:boxborderw=18:line_spacing=10:x=(w-text_w)/2:y=h*0.70`
        );
      }
      if (watermark && fontFile) {
        overlays.push(
          `drawtext=fontfile=${fontFile}:text='ShortsPilot AI':fontsize=34:fontcolor=white@0.55:borderw=2:bordercolor=black@0.4:x=w-text_w-40:y=120`
        );
      }

      // Optional Veo motion clip for this scene — real AI video movement.
      let usedMotionClip = false;
      if (scene.motionClip) {
        try {
          await fs.access(scene.motionClip);
          const clipDurVeo = await videoDuration(scene.motionClip);
          if (clipDurVeo > 0.5) {
            // stretch to fill: mild slow-mo (≤2x) then hold the last frame
            const factor = Math.min(2, Math.max(1, clipDur / clipDurVeo));
            const tpad = Math.max(0.2, clipDur - clipDurVeo * factor + 0.25);
            const vf = [
              `fps=${FPS}`,
              `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=increase`,
              `crop=${OUT_W}:${OUT_H}`,
              `eq=contrast=1.04:saturation=1.06`,
              `setpts=PTS*${factor.toFixed(4)}`,
              `tpad=stop_mode=clone:stop_duration=${tpad.toFixed(3)}`,
              ...overlays,
            ];
            const args = [
              "-y",
              "-i", scene.motionClip,
              "-i", aud,
              "-filter_complex", `[0:v]${vf.join(",")}[v]`,
              "-map", "[v]",
              "-map", "1:a",
              "-af", "apad",
              "-t", clipDur.toFixed(3),
              "-c:v", "libx264",
              "-preset", "veryfast",
              "-crf", "21",
              "-pix_fmt", "yuv420p",
              "-r", String(FPS),
              "-c:a", "aac",
              "-b:a", "160k",
              "-ar", "44100",
              "-ac", "2",
              clipFile,
            ];
            await run("ffmpeg", args, 240000, { cwd: workDir, label: `rendering scene ${i + 1} (Veo motion)` });
            usedMotionClip = true;
          }
        } catch (e) {
          console.error(`[render] scene ${i + 1}: motion clip unusable (${e instanceof Error ? e.message : e}) — cinematic zoom-pan fallback`);
          warnings.push(`Scene ${i + 1}: AI motion clip unusable — used cinematic zoom instead.`);
        }
      }

      if (!usedMotionClip) {
        const frames = Math.ceil(clipDur * FPS);
        const vfChain = [...kenBurnsChain(i, frames), ...overlays];
        const args = [
          "-y",
          "-loop", "1",
          "-framerate", String(FPS),
          "-i", img,
          "-i", aud,
          "-filter_complex", `[0:v]${vfChain.join(",")}[v]`,
          "-map", "[v]",
          "-map", "1:a",
          "-af", "apad",
          "-t", clipDur.toFixed(3),
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "21",
          "-pix_fmt", "yuv420p",
          "-r", String(FPS),
          "-c:a", "aac",
          "-b:a", "160k",
          "-ar", "44100",
          "-ac", "2",
          "-shortest",
          clipFile,
        ];
        await run("ffmpeg", args, 240000, { cwd: workDir, label: `rendering scene ${i + 1}` });
      }
      clipFiles.push(clipFile);
      clipDurations.push(clipDur);

      const sceneProgress = 8 + Math.round(((i + 1) / scenes.length) * 47); // 8→55%
      await onProgress?.(sceneProgress, `Rendering scene ${i + 1}/${scenes.length}`);
    }

    // ---- assemble: smooth crossfades (xfade) with concat fallback ----
    let assembled = false;
    if (clipFiles.length > 1) {
      await onProgress?.(60, "Blending scenes (crossfade)");
      try {
        const inputs: string[] = [];
        for (const f of clipFiles) inputs.push("-i", f);
        const transitions = ["fade", "smoothleft", "smoothright", "smoothup"];
        let vPrev = "0:v";
        let aPrev = "0:a";
        const fc: string[] = [];
        let offset = 0;
        for (let k = 1; k < clipFiles.length; k++) {
          const t = transitions[(k - 1) % transitions.length];
          const dur = Math.min(CROSSFADE_S, Math.max(0.1, clipDurations[k - 1] - 0.1));
          offset += clipDurations[k - 1] - dur;
          const vOut = k === clipFiles.length - 1 ? "vout" : `vx${k}`;
          const aOut = k === clipFiles.length - 1 ? "aout" : `ax${k}`;
          fc.push(`[${vPrev}][${k}:v]xfade=transition=${t}:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}[${vOut}]`);
          fc.push(`[${aPrev}][${k}:a]acrossfade=d=${dur.toFixed(3)}[${aOut}]`);
          vPrev = vOut;
          aPrev = aOut;
        }
        const outFile = path.join(workDir, "output.mp4");
        await run("ffmpeg", [
          "-y",
          ...inputs,
          "-filter_complex", fc.join(";"),
          "-map", "[vout]",
          "-map", "[aout]",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "21",
          "-pix_fmt", "yuv420p",
          "-r", String(FPS),
          "-c:a", "aac",
          "-b:a", "160k",
          "-ar", "44100",
          "-ac", "2",
          outFile,
        ], 300000, { cwd: workDir, label: "crossfade assembly" });
        assembled = true;
      } catch (e) {
        console.error(`[render] crossfade assembly failed (${e instanceof Error ? e.message : e}) — falling back to concat`);
        warnings.push("Crossfades unavailable — scenes joined with hard cuts.");
      }
    }

    const outFile = path.join(workDir, "output.mp4");
    if (!assembled) {
      if (clipFiles.length === 1) {
        await fs.copyFile(clipFiles[0], outFile);
      } else {
        // concat clips — entries are bare filenames; the concat demuxer resolves
        // them relative to the list file's directory (workDir), which is
        // Windows-safe (no drive letters / backslashes in the list).
        await onProgress?.(60, "Concatenating scenes");
        const listFile = path.join(workDir, "list.txt");
        await fs.writeFile(
          listFile,
          clipFiles.map((f) => `file '${path.basename(f)}'`).join("\n"),
          "utf8"
        );
        await run("ffmpeg", [
          "-y",
          "-f", "concat",
          "-safe", "0",
          "-i", listFile,
          "-c", "copy",
          outFile,
        ], 120000, { label: "joining scenes" });
      }
    }

    // thumbnail
    await onProgress?.(70, "Generating thumbnail");
    const thumbFile = path.join(workDir, "thumb.jpg");
    await run("ffmpeg", [
      "-y",
      "-ss", "1",
      "-i", outFile,
      "-frames:v", "1",
      "-vf", `scale=540:960`,
      "-q:v", "3",
      thumbFile,
    ], 60000, { label: "creating thumbnail" });

    // quality checks (PRD §6.9)
    await onProgress?.(80, "Quality checks");
    const info = await probeMedia(outFile);
    const vStream = info.streams?.find((s) => s.codec_type === "video");
    const aStream = info.streams?.find((s) => s.codec_type === "audio");
    if (!vStream) throw new Error("Quality check failed: no video stream");
    if (!aStream) warnings.push("No audio stream detected");
    const width = vStream.width || OUT_W;
    const height = vStream.height || OUT_H;
    if (Math.abs(width / height - 9 / 16) > 0.02) warnings.push(`Aspect ratio is ${width}x${height}, expected 9:16`);
    const duration = parseFloat(info.format?.duration || "0");
    if (duration <= 0.5) warnings.push("Output duration looks too short");
    const { silent, rmsDb } = await detectSilence(outFile);
    if (silent) warnings.push(`Audio appears silent (RMS ${rmsDb.toFixed(1)} dB)`);

    // move final outputs into permanent storage
    await onProgress?.(90, "Storing final output");
    const outName = `short_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`;
    const thumbName = path.basename(thumbFile).replace("thumb", `thumb_${Date.now()}`);
    await moveFile(outFile, uploadPath("videos", outName));
    await moveFile(thumbFile, uploadPath("thumbs", thumbName));

    await onProgress?.(100, "Render complete");
    return {
      videoUrl: `/uploads/videos/${outName}`,
      thumbnailUrl: `/uploads/thumbs/${thumbName}`,
      duration,
      width,
      height,
      warnings,
    };
  } finally {
    fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
