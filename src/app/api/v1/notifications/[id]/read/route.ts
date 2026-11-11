import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

/** POST /api/v1/notifications/[id]/read — mark a single notification as read. */
export const POST = handler(async (req: NextRequest, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;

  const notification = await db.notification.findUnique({ where: { id } });
  if (!notification || notification.userId !== user.id) throw new HttpError(404, "Notification not found");

  if (!notification.readAt) {
    await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  }
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  return ok({ success: true, unread });
});
