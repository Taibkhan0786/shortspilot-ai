import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, getPagination, safeJsonParse } from "@/lib/api";
import { generateScript, validateScript } from "@/lib/engine/content";
import { chargeCredits, logUsage } from "@/lib/usage";
import { audit, notify } from "@/lib/notify";
import { z } from "zod";

const generateSchema = z.object({
  ideaId: z.string().optional(),
  topic: z.string().min(3).max(300).optional(),
  language: z.string().max(60).optional(),
  tone: z.enum(["educational", "storytelling", "commentary", "entertainment"]).optional(),
  duration: z.number().int().min(15).max(90).optional(),
});

/**
 * POST /api/v1/scripts/generate — structured scene-level script (PRD §6.6).
 * Accepts either an ideaId or an explicit topic.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, generateSchema);
  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });

  let topic = body.topic;
  let idea: Awaited<ReturnType<typeof db.contentIdea.findUnique>> = null;
  if (body.ideaId) {
    idea = await db.contentIdea.findUnique({ where: { id: body.ideaId } });
    if (!idea || idea.userId !== user.id) throw new HttpError(404, "Idea not found");
    topic = topic || idea.topic;
  }
  if (!topic) throw new HttpError(400, "Provide topic or ideaId");

  const language = body.language || idea?.language || profile?.language || "English";
  const tone = body.tone || profile?.scriptStyle || "educational";
  const duration = body.duration || idea?.duration || profile?.duration || 45;

  await chargeCredits(user.id, "script", `Script — ${topic}`);
  const spec = await generateScript({
    topic,
    language,
    tone,
    duration,
    audience: profile?.audience,
    niche: profile?.niche,
  });
  const warnings = [...validateScript({ scenes: spec.scenes, duration }), ...spec.warnings];

  // versioning: same topic = version+1 (PRD §6.6 multiple versions)
  const existingCount = await db.script.count({ where: { userId: user.id, topic } });

  const script = await db.script.create({
    data: {
      ideaId: idea?.id,
      userId: user.id,
      topic,
      language,
      tone,
      duration,
      version: existingCount + 1,
      hook: spec.hook,
      scenes: JSON.stringify(spec.scenes),
      cta: spec.cta,
      model: "glm",
      warnings: JSON.stringify([...new Set(warnings)]),
    },
  });
  if (idea) {
    await db.contentIdea.update({ where: { id: idea.id }, data: { status: "USED" } });
  }
  await logUsage(user.id, "llm", "script", { estimatedCost: 2 });
  await audit(user, "script.generate", "script", script.id);
  await notify(user.id, "script_ready", `Script ready: ${topic}`, "Your new script is ready to edit and approve.", undefined, `scripts:${script.id}`);

  return ok({ script: { ...script, scenes: safeJsonParse(script.scenes, []), warnings: safeJsonParse(script.warnings, []) } }, 201);
});
