import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { Readable } from "stream";
import path from "path";
import { urlToAbs } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * GET /uploads/* — serves generated files from UPLOAD_ROOT.
 * Needed because Next's standalone production server only serves files that
 * existed in /public at startup, so anything generated at runtime (voice,
 * images, videos) would 404. Supports HTTP Range so <video> can seek.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  if (parts.some((p) => p.includes("..") || p.includes("\\"))) return new NextResponse("Bad request", { status: 400 });
  let abs: string;
  try {
    abs = urlToAbs(parts.join("/"));
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (path.basename(path.dirname(abs)) === "tmp") return new NextResponse("Not found", { status: 404 });

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(abs);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }

  const type = MIME[path.extname(abs).toLowerCase()] ?? "application/octet-stream";
  const base = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
  };

  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : stat.size - parseInt(m[2], 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    const body = Readable.toWeb(fs.createReadStream(abs, { start, end })) as unknown as ReadableStream;
    return new NextResponse(body, {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const body = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream;
  return new NextResponse(body, { headers: { ...base, "Content-Length": String(stat.size) } });
}
