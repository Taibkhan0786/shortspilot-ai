import { generateImageFile } from "@/lib/ai/image";
import { db } from "@/lib/db";
import { logUsage, releaseCredits } from "@/lib/usage";

export type SceneVisual = { sceneNumber: number; url: string; prompt: string; bytes: number };

const styleDirective = (style: string) =>
  style === "cartoon"
    ? "colorful 3D cartoon illustration style, vibrant, playful, high detail"
    : style === "realistic"
      ? "photorealistic, professional photography, natural lighting, shallow depth of field, ultra sharp focus, professional color grading, high resolution"
      : style === "minimalist"
        ? "minimalist flat design, clean composition, generous negative space"
        : "cinematic lighting, dramatic composition, film still quality, photorealistic detail, shallow depth of field, professional color grading, ultra sharp, high detail";

/**
 * Generate one vertical image per scene from its visual prompt (PRD §6.8).
 * Scenes are generated with bounded concurrency (3) so a 5-scene script takes
 * ~1 image-generation instead of 5, keeping us far below gateway timeouts.
 * Per-scene failures are isolated: a failed scene is reported and retriable.
 */
export async function generateVisualsForScenes(opts: {
  prompts: { sceneNumber: number; visualPrompt: string; caption?: string }[];
  style: string;
  concurrency?: number;
  onProgress?: (pct: number, stage: string, created: number, failed: number) => void;
}): Promise<{ visuals: SceneVisual[]; failures: { sceneNumber: number; error: string }[] }> {
  const { prompts, style, onProgress, concurrency = 3 } = opts;
  const directive = styleDirective(style);

  const visuals: SceneVisual[] = [];
  const failures: { sceneNumber: number; error: string }[] = [];

  const todo = prompts.filter((p) => p.visualPrompt);
  for (const p of prompts.filter((p) => !p.visualPrompt)) {
    failures.push({ sceneNumber: p.sceneNumber, error: "Missing visual prompt" });
  }

  let done = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
    while (cursor < todo.length) {
      const p = todo[cursor++];
      const fullPrompt = `${p.visualPrompt}. ${directive}, vertical 9:16 composition, no text, no watermarks`;
      try {
        const img = await generateImageFile(fullPrompt, { size: "768x1344", prefix: "scene" });
        visuals.push({ sceneNumber: p.sceneNumber, url: img.url, prompt: fullPrompt, bytes: img.bytes });
      } catch (e) {
        failures.push({
          sceneNumber: p.sceneNumber,
          error: e instanceof Error ? e.message.slice(0, 200) : "Image generation failed",
        });
      }
      done++;
      // callback errors must never kill the generation workers
      try {
        onProgress?.(Math.round((done / prompts.length) * 100), `Generating visual ${done}/${prompts.length}`, visuals.length, failures.length);
      } catch {
        /* ignore */
      }
    }
  });
  await Promise.all(workers);

  if (visuals.length === 0 && failures.length > 0) {
    throw new Error(`All scene visuals failed: ${failures[0].error}`);
  }
  return { visuals, failures };
}

/** Refund helper for failed visual jobs. */
async function refundVisualJob(userId: string, scenes: number, topic: string, scriptId: string) {
  const credits = scenes * 1.5;
  await releaseCredits(userId, credits, `Visuals failed refund — ${topic}`, scriptId);
}

/**
 * Background processor for async VisualJobs.
 * Runs outside the HTTP request (fire-and-forget from the API route), updates
 * progress in the DB so the client can poll GET /api/v1/visuals/status.
 */
export async function processVisualJob(jobId: string): Promise<void> {
  const job = await db.visualJob.findUnique({ where: { id: jobId }, include: { script: true } });
  if (!job || job.status === "RUNNING" || job.status === "DONE") return;

  const targets = JSON.parse(job.sceneNumbers || "[]") as number[];
  const allScenes = JSON.parse(job.script.scenes || "[]") as {
    sceneNumber: number;
    visualPrompt: string;
    caption?: string;
  }[];
  const scoped = targets.length ? allScenes.filter((s) => targets.includes(s.sceneNumber)) : allScenes;

  await db.visualJob.update({
    where: { id: job.id },
    data: { status: "RUNNING", startedAt: new Date(), stage: "Starting", totalScenes: scoped.length },
  });

  try {
    const { visuals, failures } = await generateVisualsForScenes({
      prompts: scoped.map((s) => ({ sceneNumber: s.sceneNumber, visualPrompt: s.visualPrompt, caption: s.caption })),
      style: job.style,
      concurrency: 3,
      onProgress: (pct, stage, created, failed) => {
        db.visualJob
          .update({ where: { id: job.id }, data: { progress: pct, stage, createdCount: created, failedCount: failed } })
          .catch(() => {});
      },
    });

    for (const v of visuals) {
      await db.mediaAsset.create({
        data: {
          userId: job.userId,
          scriptId: job.scriptId,
          type: "image",
          sceneNumber: v.sceneNumber,
          source: "generated",
          provider: "zai-image",
          assetUrl: v.url,
          prompt: v.prompt,
          metadata: JSON.stringify({ scriptTopic: job.script.topic, jobId: job.id }),
        },
      });
    }

    await db.visualJob.update({
      where: { id: job.id },
      data: {
        status: "DONE",
        progress: 100,
        stage: "Visuals ready",
        createdCount: visuals.length,
        failedCount: failures.length,
        completedAt: new Date(),
      },
    });
    await logUsage(job.userId, "image", "visual", { units: visuals.length, estimatedCost: visuals.length * 1.5 });

    // All scenes failed -> refund; partial failure -> keep charge for successes
    if (visuals.length === 0) {
      await refundVisualJob(job.userId, scoped.length, job.script.topic, job.scriptId);
      await db.visualJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: failures[0]?.error ?? "All scene visuals failed" },
      });
    }
  } catch (e) {
    await db.visualJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: e instanceof Error ? e.message.slice(0, 300) : "Visual generation failed",
        completedAt: new Date(),
      },
    });
    await refundVisualJob(job.userId, scoped.length, job.script.topic, job.scriptId);
  }
}
