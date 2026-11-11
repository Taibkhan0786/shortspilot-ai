import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, safeJsonParse } from "@/lib/api";
import { generateIdeas } from "@/lib/engine/content";
import { chargeCredits, logUsage } from "@/lib/usage";
import { z } from "zod";

const generateSchema = z.object({
  topic: z.string().max(300).optional(),
  niche: z.string().max(200).optional(),
  language: z.string().max(60).optional(),
  count: z.number().int().min(1).max(5).optional(),
  research: z.boolean().optional(),
});

/** POST /api/v1/ideas/generate — AI idea generation (PRD §6.4). */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, generateSchema);

  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });
  const niche = body.niche || profile?.niche || "";
  if (!niche && !body.topic) throw new HttpError(400, "Provide a topic or set your niche first");

  const language = body.language || profile?.language || "English";
  const count = body.count ?? 3;

  await chargeCredits(user.id, "idea", "Content idea generation");

  // duplicate detection (PRD §6.4): exclude recent existing topics
  const recent = await db.contentIdea.findMany({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 90 * 86400000) } },
    select: { topic: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  const { ideas, sources } = await generateIdeas({
    niche: niche || body.topic!,
    audience: profile?.audience,
    language,
    customTopic: body.topic,
    count,
    excludeTopics: recent.map((r) => r.topic),
    research: body.research ?? true,
  });

  type CreatedIdea = Awaited<ReturnType<typeof db.contentIdea.create>>;
  const created: CreatedIdea[] = [];
  for (const idea of ideas) {
    created.push(
      await db.contentIdea.create({
        data: {
          userId: user.id,
          topic: idea.topic,
          hook: idea.hook,
          angle: idea.angle,
          language,
          duration: idea.duration,
          sources: JSON.stringify(sources),
          score: idea.score,
          status: "SUGGESTED",
        },
      })
    );
  }
  await logUsage(user.id, "llm", "idea", { units: count, estimatedCost: count });
  return ok({ ideas: created.map((i) => ({ ...i, sources: safeJsonParse(i.sources, []) })) }, 201);
});
