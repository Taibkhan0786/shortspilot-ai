import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { chargeCredits, releaseCredits } from "@/lib/usage";
import { audit } from "@/lib/notify";

/**
 * POST /api/v1/videos/[id]/render — queue an async render job (PRD §6.9/§12).
 * Rendering never runs inside the HTTP request; the background worker picks it up.
 */
export const POST = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;

  const video = await db.video.findUnique({ where: { id }, include: { scenes: true } });
  if (!video || video.userId !== user.id) throw new HttpError(404, "Video not found");
  if (video.status === "RENDERING") throw new HttpError(409, "Already rendering");

  const renderable = video.scenes.filter((s) => s.assetUrl && s.audioUrl);
  if (renderable.length === 0) {
    throw new HttpError(400, "No renderable scenes — generate voiceover and visuals first");
  }

  await chargeCredits(user.id, "render", `Render — ${video.title}`);
  const job = await db.renderJob.create({
    data: { videoId: video.id, status: "QUEUED" },
  });
  await db.video.update({
    where: { id: video.id },
    data: { status: "RENDERING", progress: 2, statusMessage: "Queued for render", error: null },
  });
  await audit(user, "video.render", "video", id);
  return ok({ jobId: job.id, status: "QUEUED" }, 202);
});
