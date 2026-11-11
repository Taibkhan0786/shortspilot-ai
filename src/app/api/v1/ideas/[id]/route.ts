import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, safeJsonParse } from "@/lib/api";
import { audit } from "@/lib/notify";
import { z } from "zod";

/** GET /api/v1/ideas/[id] */
export const GET = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const idea = await db.contentIdea.findUnique({ where: { id } });
  if (!idea || idea.userId !== user.id) throw new HttpError(404, "Idea not found");
  return ok({ idea: { ...idea, sources: safeJsonParse(idea.sources, []) } });
});

const patchSchema = z.object({
  topic: z.string().max(300).optional(),
  hook: z.string().max(500).optional(),
  angle: z.string().max(500).optional(),
  duration: z.number().int().min(15).max(90).optional(),
  status: z.enum(["SUGGESTED", "APPROVED", "REJECTED", "USED"]).optional(),
});

/** PATCH /api/v1/ideas/[id] — edit or approve/reject (PRD §6.4). */
export const PATCH = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);

  const idea = await db.contentIdea.findUnique({ where: { id } });
  if (!idea || idea.userId !== user.id) throw new HttpError(404, "Idea not found");

  const updated = await db.contentIdea.update({ where: { id }, data: body });
  await audit(user, `idea.${body.status?.toLowerCase() || "edit"}`, "contentIdea", id);
  return ok({ idea: { ...updated, sources: safeJsonParse(updated.sources, []) } });
});

/** DELETE /api/v1/ideas/[id] */
export const DELETE = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const idea = await db.contentIdea.findUnique({ where: { id } });
  if (!idea || idea.userId !== user.id) throw new HttpError(404, "Idea not found");
  await db.contentIdea.delete({ where: { id } });
  return ok({ success: true });
});
