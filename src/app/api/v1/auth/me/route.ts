import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

/** GET /api/v1/auth/me — session bootstrap for the SPA (user + profile + subscription). */
export const GET = handler(async (req: NextRequest) => {
  const user = await getSessionUser(req);
  if (!user) return ok({ user: null });
  const [profile, subscription, unread] = await Promise.all([
    db.userProfile.findUnique({ where: { userId: user.id } }),
    db.subscription.findUnique({ where: { userId: user.id }, include: { plan: true } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return ok({ user, profile, subscription, unreadNotifications: unread });
});
