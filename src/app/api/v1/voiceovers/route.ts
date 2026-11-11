import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, getPagination, safeJsonParse } from "@/lib/api";

/** GET /api/v1/voiceovers — generated voiceovers (paginated). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take, page } = getPagination(req.url);
  const [items, total] = await Promise.all([
    db.voiceover.findMany({
      where: { script: { userId: user.id } },
      include: { script: { select: { topic: true, language: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.voiceover.count({ where: { script: { userId: user.id } } }),
  ]);
  return ok({
    voiceovers: items.map((v) => ({ ...v, sceneAudio: safeJsonParse(v.sceneAudio, []) })),
    total,
    page,
  });
});
