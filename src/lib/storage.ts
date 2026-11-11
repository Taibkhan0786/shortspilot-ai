import path from "path";
import fs from "fs/promises";

/**
 * Where generated files (voice, images, renders) live on disk.
 * Local dev: ./public/uploads. In production set UPLOAD_DIR to a PERSISTENT
 * disk/volume (e.g. /data/uploads) so files survive restarts and redeploys.
 */
export const UPLOAD_ROOT = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(process.cwd(), "public", "uploads");

/** Map a stored public URL (/uploads/images/x.png) to its absolute path on disk (traversal-safe). */
export function urlToAbs(url: string): string {
  const rel = url.replace(/^\/?uploads\//, "");
  const abs = path.resolve(UPLOAD_ROOT, rel);
  if (abs !== UPLOAD_ROOT && !abs.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error("Invalid file path");
  }
  return abs;
}

export async function ensureDirs() {
  for (const d of ["audio", "images", "videos", "thumbs", "tmp"]) {
    await fs.mkdir(path.join(UPLOAD_ROOT, d), { recursive: true });
  }
}

export function uploadPath(...parts: string[]) {
  return path.join(UPLOAD_ROOT, ...parts);
}

/** Public URL path for a stored file (served statically by Next). */
export function publicUrl(...parts: string[]) {
  return `/uploads/${parts.join("/")}`;
}

export async function saveBuffer(relDir: string, filename: string, data: Buffer) {
  await ensureDirs();
  const abs = uploadPath(relDir, filename);
  await fs.writeFile(abs, data);
  return { abs, url: publicUrl(relDir, filename) };
}
