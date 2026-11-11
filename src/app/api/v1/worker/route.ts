import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { startWorker } from "@/lib/worker";

export const GET = handler(async (req: NextRequest) => {
  await requireUser(req);
  startWorker(); // ensure worker is alive even without instrumentation
  const [renderQueued, renderRunning, publishPending, published] = await Promise.all([
    db.renderJob.count({ where: { status: "QUEUED" } }),
    db.renderJob.count({ where: { status: "RUNNING" } }),
    db.publishingJob.count({ where: { uploadStatus: { in: ["PENDING", "UPLOADING", "PROCESSING"] } } }),
    db.video.count({ where: { status: "PUBLISHED" } }),
  ]);
  return ok({
    worker: "running",
    queues: { renderQueued, renderRunning, publishPending, publishedVideos: published },
    time: new Date().toISOString(),
  });
});
