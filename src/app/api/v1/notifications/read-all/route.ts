import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

/** POST /api/v1/notifications/read-all — mark all as read. */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  await db.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return ok({ success: true });
});
