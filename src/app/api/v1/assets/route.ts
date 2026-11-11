import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, getPagination } from "@/lib/api";

/** GET /api/v1/assets — media library (paginated). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take, page } = getPagination(req.url);
  const type = new URL(req.url).searchParams.get("type") || undefined;
  const scriptId = new URL(req.url).searchParams.get("scriptId") || undefined;
  const where = {
    userId: user.id,
    ...(type ? { type } : {}),
    ...(scriptId ? { scriptId } : {}),
  };
  const [assets, total] = await Promise.all([
    db.mediaAsset.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    db.mediaAsset.count({ where }),
  ]);
  return ok({ assets, total, page });
});
