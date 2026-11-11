import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, getPagination, safeJsonParse } from "@/lib/api";

/** GET /api/v1/ideas — idea history (paginated). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take, page } = getPagination(req.url);
  const [ideas, total] = await Promise.all([
    db.contentIdea.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.contentIdea.count({ where: { userId: user.id } }),
  ]);
  return ok({
    ideas: ideas.map((i) => ({ ...i, sources: safeJsonParse(i.sources, []) })),
    total,
    page,
  });
});
