import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, safeJsonParse } from "@/lib/api";
import { audit } from "@/lib/notify";
import { z } from "zod";

const sceneSchema = z.object({
  sceneNumber: z.number().int().min(1),
  narration: z.string().max(1200),
  visualPrompt: z.string().max(1000),
  caption: z.string().max(60).optional().default(""),
});

const patchSchema = z.object({
  topic: z.string().max(300).optional(),
  hook: z.string().max(500).optional(),
  cta: z.string().max(300).optional(),
  scenes: z.array(sceneSchema).max(10).optional(),
  status: z.enum(["DRAFT", "APPROVED"]).optional(),
});

async function loadOwned(userId: string, id: string) {
  const script = await db.script.findUnique({ where: { id } });
  if (!script || script.userId !== userId) throw new HttpError(404, "Script not found");
  return script;
}

/** GET /api/v1/scripts/[id] */
export const GET = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const script = await loadOwned(user.id, id);
  return ok({ script: { ...script, scenes: safeJsonParse(script.scenes, []), warnings: safeJsonParse(script.warnings, []) } });
});

/** PATCH /api/v1/scripts/[id] — manual editing + approve (PRD §6.6). */
export const PATCH = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  await loadOwned(user.id, id);

  const data: Record<string, unknown> = {};
  if (body.topic !== undefined) data.topic = body.topic;
  if (body.hook !== undefined) data.hook = body.hook;
  if (body.cta !== undefined) data.cta = body.cta;
  if (body.status !== undefined) data.status = body.status;
  if (body.scenes !== undefined) {
    data.scenes = JSON.stringify(body.scenes.map((s, i) => ({ ...s, sceneNumber: i + 1 })));
  }

  const script = await db.script.update({ where: { id }, data });
  await audit(user, body.status === "APPROVED" ? "script.approve" : "script.edit", "script", id);
  return ok({ script: { ...script, scenes: safeJsonParse(script.scenes, []), warnings: safeJsonParse(script.warnings, []) } });
});

/** DELETE /api/v1/scripts/[id] */
export const DELETE = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await loadOwned(user.id, id);
  await db.script.delete({ where: { id } });
  return ok({ success: true });
});
