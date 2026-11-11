import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, safeJsonParse } from "@/lib/api";
import { processVisualJob } from "@/lib/pipeline/visuals";
import { chargeCredits } from "@/lib/usage";
import { audit } from "@/lib/notify";
import { z } from "zod";

const schema = z.object({
  scriptId: z.string().min(5),
  style: z.enum(["cinematic", "cartoon", "realistic", "minimalist"]).optional(),
  sceneNumbers: z.array(z.number().int().min(1)).optional(), // regenerate only specific scenes
});

/**
 * POST /api/v1/visuals/generate — queue async scene-visual generation (PRD §6.8).
 * Image generation is slow (20-60s/scene) and MUST NOT run inside the HTTP
 * request — long requests get killed by the gateway with 502. Instead we
 * create a VisualJob, process it in the background, and the client polls
 * GET /api/v1/visuals/status?scriptId=… until DONE.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);

  const script = await db.script.findUnique({ where: { id: body.scriptId } });
  if (!script || script.userId !== user.id) throw new HttpError(404, "Script not found");

  const scenes = safeJsonParse<{ sceneNumber: number; visualPrompt: string; caption: string }[]>(script.scenes, []);
  if (scenes.length === 0) throw new HttpError(400, "Script has no scenes");

  const target = body.sceneNumbers?.length
    ? scenes.filter((s) => body.sceneNumbers!.includes(s.sceneNumber))
    : scenes;

  // one active job per script — avoids double charging & racing jobs
  const active = await db.visualJob.findFirst({
    where: { scriptId: script.id, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (active) throw new HttpError(409, "Visual generation already in progress for this script");

  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });
  const style = body.style || profile?.visualStyle || "cinematic";

  await chargeCredits(user.id, "visual_per_scene", `Visuals — ${script.topic}`, undefined, target.length);

  const job = await db.visualJob.create({
    data: {
      scriptId: script.id,
      userId: user.id,
      style,
      sceneNumbers: JSON.stringify(body.sceneNumbers ?? []),
      totalScenes: target.length,
      status: "QUEUED",
    },
  });

  // fire-and-forget background processing (survives after the response is sent)
  void processVisualJob(job.id).catch((e) => console.error("[visual-job]", e));

  await audit(user, "visuals.generate", "script", script.id, { scenes: target.length, jobId: job.id });
  return ok({ jobId: job.id, status: "QUEUED", totalScenes: target.length }, 202);
});
