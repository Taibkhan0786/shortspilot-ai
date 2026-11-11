import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { saveBuffer } from "@/lib/storage";
import { audit } from "@/lib/notify";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function sniffImage(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/**
 * POST /api/v1/assets/upload — upload the USER'S OWN image (multipart).
 * Used by the AI Studio (per-scene image replacement and the Image → Ad Video
 * creator). Optionally attaches the asset to a script scene.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected multipart/form-data with an image file");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Missing image file (field 'file')");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Image too large (max 8 MB)");

  const scriptId = (form.get("scriptId") as string | null)?.trim() || undefined;
  const sceneNumberRaw = (form.get("sceneNumber") as string | null)?.trim();
  const sceneNumber = sceneNumberRaw ? Math.max(1, Math.min(99, parseInt(sceneNumberRaw, 10) || 0)) : null;

  if (scriptId) {
    const script = await db.script.findUnique({ where: { id: scriptId } });
    if (!script || script.userId !== user.id) throw new HttpError(404, "Script not found");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind || !ALLOWED.has(file.type || `image/${kind}`)) {
    throw new HttpError(415, "Only JPEG, PNG or WebP images are supported");
  }

  const ext = kind === "jpeg" ? "jpg" : kind;
  const filename = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { url } = await saveBuffer("images", filename, bytes);

  const asset = await db.mediaAsset.create({
    data: {
      userId: user.id,
      scriptId: scriptId ?? null,
      type: "image",
      sceneNumber,
      source: "uploaded",
      provider: "user-upload",
      assetUrl: url,
      prompt: `User uploaded image (${file.name.slice(0, 80)})`,
      license: "User provided — all rights belong to the uploader",
      metadata: JSON.stringify({ originalName: file.name.slice(0, 120), bytes: bytes.length }),
    },
  });

  await audit(user, "asset.upload", "mediaAsset", asset.id);
  return ok({ asset }, 201);
});
