import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import { z } from "zod";

const patchSchema = z.object({
  action: z.enum(["cancel", "reschedule"]),
  scheduledAt: z.string().datetime().optional(),
});

/** PATCH /api/v1/publishing/jobs/[id] — cancel or reschedule. */
export const PATCH = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);

  const job = await db.publishingJob.findUnique({ where: { id }, include: { video: true } });
  if (!job || job.video.userId !== user.id) throw new HttpError(404, "Job not found");
  if (["DONE", "CANCELLED"].includes(job.uploadStatus)) {
    throw new HttpError(409, `Job already ${job.uploadStatus}`);
  }
  if (body.action === "cancel") {
    await db.publishingJob.update({ where: { id }, data: { uploadStatus: "CANCELLED", completedAt: new Date() } });
    await db.video.update({ where: { id: job.videoId }, data: { status: "APPROVED", scheduledAt: null, statusMessage: "Publishing cancelled" } });
  } else {
    if (!body.scheduledAt) throw new HttpError(400, "scheduledAt required for reschedule");
    await db.publishingJob.update({ where: { id }, data: { scheduledAt: new Date(body.scheduledAt), uploadStatus: "PENDING" } });
    await db.video.update({
      where: { id: job.videoId },
      data: { scheduledAt: new Date(body.scheduledAt), statusMessage: `Rescheduled to ${body.scheduledAt}` },
    });
  }
  await audit(user, `publishing.${body.action}`, "publishingJob", id);
  return ok({ success: true });
});
