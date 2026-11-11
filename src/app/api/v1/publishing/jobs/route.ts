import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, getPagination } from "@/lib/api";

/** GET /api/v1/publishing/jobs — publishing queue with video + channel info. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take, page } = getPagination(req.url);
  const status = new URL(req.url).searchParams.get("status") || undefined;
  const where = {
    video: { userId: user.id },
    ...(status ? { uploadStatus: status } : {}),
  };
  const [jobs, total] = await Promise.all([
    db.publishingJob.findMany({
      where,
      include: {
        video: { select: { id: true, title: true, thumbnailUrl: true, status: true } },
        channel: { select: { channelTitle: true, mode: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.publishingJob.count({ where }),
  ]);
  return ok({ jobs, total, page });
});
