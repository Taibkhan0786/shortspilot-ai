import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { generateImageFile } from "@/lib/ai/image";
import { chargeCredits } from "@/lib/usage";
import { z } from "zod";

const schema = z.object({
  prompt: z.string().min(3).max(1000).optional(), // new prompt; omit to regenerate from stored prompt
});

/** PATCH /api/v1/assets/[id] — replace/regenerate a scene asset (PRD §6.8). */
export const PATCH = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);

  const asset = await db.mediaAsset.findUnique({ where: { id } });
  if (!asset || asset.userId !== user.id) throw new HttpError(404, "Asset not found");

  const prompt = body.prompt || asset.prompt;
  if (!prompt) throw new HttpError(400, "No prompt available for regeneration");

  await chargeCredits(user.id, "visual_per_scene", "Asset regeneration");
  const img = await generateImageFile(prompt, { size: "768x1344", prefix: "scene" });
  const updated = await db.mediaAsset.update({
    where: { id },
    data: { assetUrl: img.url, prompt, provider: "zai-image" },
  });
  return ok({ asset: updated });
});
