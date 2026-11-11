import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { handler, ok, getPagination } from "@/lib/api";

/** GET /api/v1/admin/audit — paginated audit trail with search. */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const { skip, take, page } = getPagination(req.url, 50);
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q") || undefined;
  const action = sp.get("action") || undefined;

  const where = {
    ...(action ? { action: { contains: action } } : {}),
    ...(q
      ? {
          OR: [
            { action: { contains: q } },
            { resourceType: { contains: q } },
            { user: { is: { OR: [{ email: { contains: q } }, { name: { contains: q } }] } } },
          ],
        }
      : {}),
  };

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.auditLog.count({ where }),
  ]);
  return ok({ logs, total, page });
});
