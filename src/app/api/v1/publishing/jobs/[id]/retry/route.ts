import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { audit } from "@/lib/notify";

/** POST /api/v1/publishing/jobs/[id]/retry — requeue a failed job (PRD §12). */
export const POST = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;

  const job = await db.publishingJob.findUnique({
    where: { id },
    include: { video: true },
  });
  if (!job || job.video.userId !== user.id) throw new HttpError(404, "Job not found");
  if (job.uploadStatus !== "FAILED") throw new HttpError(409, "Only failed jobs can be retried");

  const updated = await db.publishingJob.update({
    where: { id },
    data: { uploadStatus: "PENDING", error: null, attempts: 0 },
  });
  await db.video.update({
    where: { id: job.videoId },
    data: { status: "APPROVED", statusMessage: "Publishing retry queued", error: null },
  });
  await audit(user, "publishing.retry", "publishingJob", id);
  return ok({ job: updated });
});
