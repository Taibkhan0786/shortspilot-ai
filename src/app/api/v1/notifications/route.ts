import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, getPagination } from "@/lib/api";

/** GET /api/v1/notifications — in-app notifications (PRD §6.17). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take } = getPagination(req.url, 20);
  const [notifications, total, unread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.notification.count({ where: { userId: user.id } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return ok({ notifications, total, unread });
});
