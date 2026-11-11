import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, safeJsonParse } from "@/lib/api";
import { audit, notify } from "@/lib/notify";
import { z } from "zod";

async function loadOwned(userId: string, id: string) {
  const video = await db.video.findUnique({
    where: { id },
    include: {
      scenes: { orderBy: { sceneNumber: "asc" } },
      channel: { select: { id: true, channelTitle: true } },
      renderJobs: { orderBy: { createdAt: "desc" }, take: 1 },
      publishingJobs: { orderBy: { createdAt: "desc" }, take: 3 },
      script: { select: { topic: true, language: true, hook: true } },
    },
  });
  if (!video || video.userId !== userId) throw new HttpError(404, "Video not found");
  return video;
}

/** GET /api/v1/videos/[id] — full detail for studio/library views. */
export const GET = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const video = await loadOwned(user.id, id);
  return ok({ video });
});

const patchSchema = z.object({
  title: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  hashtags: z.string().max(500).optional(),
  tags: z.string().max(500).optional(),
  channelId: z.string().nullable().optional(),
  status: z.enum(["APPROVED", "REJECTED", "PENDING_APPROVAL", "CANCELLED"]).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

/** PATCH /api/v1/videos/[id] — edit metadata, assign channel, approve/reject. */
export const PATCH = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  await loadOwned(user.id, id);

  const data: Record<string, unknown> = {};
  for (const k of ["title", "description", "hashtags", "tags"] as const) {
    if (body[k] !== undefined) data[k] = body[k];
  }
  if (body.channelId !== undefined) {
    if (body.channelId) {
      const ch = await db.youTubeChannel.findUnique({ where: { id: body.channelId } });
      if (!ch || ch.userId !== user.id) throw new HttpError(404, "Channel not found");
    }
    data.channelId = body.channelId;
  }
  if (body.status !== undefined) data.status = body.status;
  if (body.scheduledAt !== undefined) data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;

  const video = await db.video.update({ where: { id }, data });
  await audit(user, `video.${body.status?.toLowerCase() || "edit"}`, "video", id);
  if (body.status === "APPROVED") {
    await notify(user.id, "info", `Approved: ${video.title}`, "Video approved. You can now upload or schedule it.", undefined, `videos:${video.id}`);
  }
  return ok({ video });
});

/** DELETE /api/v1/videos/[id] */
export const DELETE = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await loadOwned(user.id, id);
  await db.video.delete({ where: { id } });
  await audit(user, "video.delete", "video", id);
  return ok({ success: true });
});
