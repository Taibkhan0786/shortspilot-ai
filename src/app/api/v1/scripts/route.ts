import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, getPagination, safeJsonParse } from "@/lib/api";

/** GET /api/v1/scripts — paginated script list. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take, page } = getPagination(req.url);
  const status = new URL(req.url).searchParams.get("status") || undefined;
  const where = { userId: user.id, ...(status ? { status } : {}) };
  const [scripts, total] = await Promise.all([
    db.script.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take }),
    db.script.count({ where }),
  ]);
  return ok({
    scripts: scripts.map((s) => ({
      ...s,
      scenes: safeJsonParse(s.scenes, []),
      warnings: safeJsonParse(s.warnings, []),
    })),
    total,
    page,
  });
});
