import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

/** GET /api/v1/admin/jobs — job monitoring (render + publishing failures). */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const status = new URL(req.url).searchParams.get("status");
  const renderWhere = status ? { status } : {};
  const publishWhere = status ? { uploadStatus: status } : {};

  const [renderJobs, publishingJobs] = await Promise.all([
    db.renderJob.findMany({
      where: renderWhere,
      include: { video: { select: { id: true, title: true, user: { select: { email: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    db.publishingJob.findMany({
      where: publishWhere,
      include: { video: { select: { id: true, title: true, user: { select: { email: true } } } }, channel: { select: { channelTitle: true } } },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  return ok({ renderJobs, publishingJobs });
});
