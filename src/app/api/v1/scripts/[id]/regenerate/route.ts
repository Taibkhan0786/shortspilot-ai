import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, safeJsonParse } from "@/lib/api";
import { generateScript, validateScript } from "@/lib/engine/content";
import { chargeCredits, logUsage } from "@/lib/usage";
import { z } from "zod";

const schema = z.object({
  tone: z.enum(["educational", "storytelling", "commentary", "entertainment"]).optional(),
  scenes: z.array(z.number().int().min(1)).optional(), // regenerate only selected scenes (PRD §6.6)
});

/**
 * POST /api/v1/scripts/[id]/regenerate — new version of the script.
 * Full regeneration produces a new Script version; partial scene regeneration
 * updates scenes in place when specific scene numbers are provided.
 */
export const POST = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);

  const old = await db.script.findUnique({ where: { id } });
  if (!old || old.userId !== user.id) throw new HttpError(404, "Script not found");

  await chargeCredits(user.id, "script_regenerate", `Regenerate script — ${old.topic}`);

  // partial scene regeneration (in place)
  if (body.scenes && body.scenes.length > 0) {
    const oldScenes = safeJsonParse<{ sceneNumber: number; narration: string; visualPrompt: string; caption: string }[]>(old.scenes, []);
    const spec = await generateScript({
      topic: old.topic,
      language: old.language,
      tone: body.tone || (old.tone as "educational"),
      duration: old.duration,
    });
    const byNumber = new Map(spec.scenes.map((s) => [s.sceneNumber, s]));
    const merged = oldScenes.map((s) => {
      if (!body.scenes!.includes(s.sceneNumber)) return s;
      const fresh = byNumber.get(s.sceneNumber);
      return fresh ?? s;
    });
    const updated = await db.script.update({
      where: { id },
      data: {
        scenes: JSON.stringify(merged),
        warnings: JSON.stringify(validateScript({ scenes: merged, duration: old.duration })),
      },
    });
    await logUsage(user.id, "llm", "script", { estimatedCost: 2 });
    return ok({ script: { ...updated, scenes: safeJsonParse(updated.scenes, []), warnings: safeJsonParse(updated.warnings, []) } });
  }

  // full regeneration → new version record (PRD §6.6 multiple script versions)
  const spec = await generateScript({
    topic: old.topic,
    language: old.language,
    tone: body.tone || (old.tone as "educational"),
    duration: old.duration,
  });
  const warnings = [...validateScript({ scenes: spec.scenes, duration: old.duration }), ...spec.warnings];
  const versionCount = await db.script.count({ where: { userId: user.id, topic: old.topic } });

  const script = await db.script.create({
    data: {
      ideaId: old.ideaId,
      userId: user.id,
      topic: old.topic,
      language: old.language,
      tone: body.tone || old.tone,
      duration: old.duration,
      version: versionCount + 1,
      hook: spec.hook,
      scenes: JSON.stringify(spec.scenes),
      cta: spec.cta,
      model: "glm",
      warnings: JSON.stringify([...new Set(warnings)]),
    },
  });
  await logUsage(user.id, "llm", "script", { estimatedCost: 2 });
  return ok({ script: { ...script, scenes: safeJsonParse(script.scenes, []), warnings: safeJsonParse(script.warnings, []) } }, 201);
});
