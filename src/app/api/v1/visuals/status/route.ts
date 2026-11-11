import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

/**
 * GET /api/v1/visuals/status?scriptId=… — poll async visual generation.
 * Returns the latest VisualJob for the script (progress, stage, counts) plus
 * the scene assets created so far, so the UI can show live progress.
 */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const scriptId = req.nextUrl.searchParams.get("scriptId") ?? "";
  if (!scriptId) throw new HttpError(400, "scriptId is required");

  const script = await db.script.findUnique({ where: { id: scriptId } });
  if (!script || script.userId !== user.id) throw new HttpError(404, "Script not found");

  const job = await db.visualJob.findFirst({
    where: { scriptId },
    orderBy: { createdAt: "desc" },
  });

  const assets = await db.mediaAsset.findMany({
    where: { scriptId, userId: user.id, type: "image" },
    orderBy: [{ sceneNumber: "asc" }, { createdAt: "desc" }],
    select: { id: true, sceneNumber: true, assetUrl: true, prompt: true, createdAt: true },
  });
  // keep only the latest asset per scene (older regenerations are history)
  const latestByScene = new Map<number, (typeof assets)[number]>();
  for (const a of assets) {
    const key = a.sceneNumber ?? 0;
    if (!latestByScene.has(key)) latestByScene.set(key, a);
  }
  const latest = [...latestByScene.values()].sort((a, b) => (a.sceneNumber ?? 0) - (b.sceneNumber ?? 0));

  return ok({
    job: job
      ? {
          id: job.id,
          status: job.status,
          progress: job.progress,
          stage: job.stage,
          totalScenes: job.totalScenes,
          createdCount: job.createdCount,
          failedCount: job.failedCount,
          error: job.error,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        }
      : null,
    assetCount: latest.length,
    assets: latest,
  });
});
