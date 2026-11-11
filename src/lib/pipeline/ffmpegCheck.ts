import { execFile } from "child_process";

/**
 * FFmpeg availability & capability preflight + failure-reason parser.
 *
 * Why: local (Windows) installs fail at render time for reasons that were
 * previously invisible — the raw execFile message contains a huge command
 * line and the real ffmpeg stderr reason lands AFTER it, where the 400-char
 * job-error truncation cuts it off. These helpers surface the actual cause
 * ("Unknown encoder 'libx264'", "No such filter: 'drawtext'", corrupt inputs,
 * missing install) as a short, actionable message.
 */

export type FfmpegStatus =
  | { ok: true; version: string }
  | { ok: false; problem: string; hint: string };

const WIN_HINT =
  "Windows fix: run `winget install Gyan.FFmpeg` (full build), then CLOSE and REOPEN your terminal and restart the dev server (npm run dev).";
const MAC_HINT = "macOS fix: run `brew install ffmpeg`, then restart the dev server.";
const LINUX_HINT = "Linux fix: run `sudo apt install ffmpeg`, then restart the dev server.";

function installHint(): string {
  if (process.platform === "win32") return WIN_HINT;
  if (process.platform === "darwin") return MAC_HINT;
  return LINUX_HINT;
}

type ProbeResult = {
  ran: boolean; // false when the binary itself could not be spawned (not installed / not on PATH)
  code: number | string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function probe(cmd: string, args: string[], timeoutMs = 20000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, encoding: "buffer" as const },
      (err: import("child_process").ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        if (err) {
          const spawnFailed = typeof err.code === "string"; // ENOENT / EACCES / EINVAL …
          resolve({
            ran: !spawnFailed,
            code: err.code ?? null,
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
            timedOut: Boolean(err.killed),
          });
        } else {
          resolve({ ran: true, code: 0, stdout: String(stdout || ""), stderr: String(stderr || ""), timedOut: false });
        }
      }
    );
  });
}

let cached: Promise<FfmpegStatus> | null = null;

/**
 * One-shot check (cached per process) that the render pipeline can run:
 * 1) ffmpeg exists on PATH, 2) ffprobe exists (some manual installs copy only ffmpeg.exe),
 * 3) the build has libx264, 4) the build has zoompan + drawtext filters.
 */
export function checkFfmpegReady(): Promise<FfmpegStatus> {
  if (cached) return cached;
  cached = (async (): Promise<FfmpegStatus> => {
    const notInstalled = (what: string): FfmpegStatus => ({
      ok: false,
      problem: `${what} is not installed or not on PATH`,
      hint: installHint(),
    });

    const ff = await probe("ffmpeg", ["-version"]);
    if (!ff.ran || ff.timedOut) return notInstalled("FFmpeg");
    const versionLine = ff.stdout.split("\n")[0]?.trim() || "";
    // Windows "App execution alias" stubs launch but produce no version banner.
    if (!/ffmpeg version/i.test(versionLine)) return notInstalled("FFmpeg");

    const fp = await probe("ffprobe", ["-version"]);
    if (!fp.ran || fp.timedOut || !/ffprobe version|ffmpeg version/i.test(fp.stdout.split("\n")[0] || "")) {
      return notInstalled("ffprobe");
    }

    const enc = await probe("ffmpeg", ["-hide_banner", "-encoders"]);
    if (enc.ran && !/libx264/.test(enc.stdout)) {
      return {
        ok: false,
        problem: `Your FFmpeg build has no libx264 (H.264) encoder — MP4 rendering is impossible with it (${versionLine})`,
        hint: installHint(),
      };
    }

    const filters = await probe("ffmpeg", ["-hide_banner", "-filters"]);
    if (filters.ran) {
      const missing = ["zoompan", "drawtext"].filter((f) => !new RegExp(`\\s${f}\\s`).test(filters.stdout));
      if (missing.length > 0) {
        return {
          ok: false,
          problem: `Your FFmpeg build lacks the ${missing.join(" + ")} filter(s) needed for motion/captions (${versionLine})`,
          hint: installHint(),
        };
      }
    }

    return { ok: true, version: versionLine };
  })();
  cached.catch(() => {
    cached = null; // never cache unexpected crashes — retry next render
  });
  return cached;
}

/** Human message for a failed preflight, ready to throw. */
export function ffmpegStatusError(s: Exclude<FfmpegStatus, { ok: true }>): Error {
  return new Error(`Cannot render: ${s.problem}. ${s.hint}`.slice(0, 380));
}

const REASON_RE =
  /(invalid data|unknown encoder|no such filter|error initializing|error opening|no such file|permission denied|unable|failed|matches no streams|does not contain|not found|conversion failed|invalid argument|moov atom|corrupt)/i;
const BANNER_RE = /^(ffmpeg|ffprobe)\s+version\b|^built with|^configuration\b|^libav\S*\s|^libsw\S*\s|^\s*Press \[q\]|^stream mapping:/i;

/**
 * Extract the real ffmpeg failure reason from stderr (last meaningful lines),
 * with known-pattern hints for the most common local (Windows) problems.
 */
export function describeFfmpegFailure(stderr: string, timedOut = false): { reason: string; hint?: string } {
  if (timedOut) {
    return { reason: "timed out — the clip took too long to encode", hint: "Try again; if it repeats, close other heavy apps." };
  }

  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !BANNER_RE.test(l));

  const interesting = lines.filter((l) => REASON_RE.test(l));
  const picked = (interesting.length > 0 ? interesting : lines).slice(-2);
  let reason = picked.join(" | ").replace(/\s+/g, " ").slice(0, 220);
  if (!reason) reason = "exited with an error (no details in the log)";

  let hint: string | undefined;
  if (/unknown encoder/i.test(stderr) || /error while opening encoder/i.test(stderr)) {
    hint = /libx264/i.test(stderr)
      ? "This FFmpeg build cannot produce MP4 (no libx264) — install a full build (Windows: winget install Gyan.FFmpeg) and reopen the terminal."
      : "The encoder needed for MP4 is missing in this FFmpeg build — install a full build (Windows: winget install Gyan.FFmpeg) and reopen the terminal.";
  } else if (/no such filter|error initializing filter 'drawtext'/i.test(stderr)) {
    hint = "This FFmpeg build lacks a required filter (freetype) — install a full build (Windows: winget install Gyan.FFmpeg) and reopen the terminal.";
  } else if (/invalid data found when processing input/i.test(stderr)) {
    hint = "A scene image or voice file is corrupt — regenerate the visuals/voice for this video, then render again.";
  } else if (/no such file or directory/i.test(stderr)) {
    hint = "An input file was not found — make sure the dev server is started from inside the project folder.";
  } else if (/permission denied/i.test(stderr)) {
    hint = "A file is locked (close any app playing it) or antivirus is blocking the folder — then render again.";
  }
  return { reason, hint };
}
