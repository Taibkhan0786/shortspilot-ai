import { db } from "@/lib/db";
import { AuthUser } from "@/lib/auth";

export async function notify(
  userId: string,
  type: string,
  title: string,
  body?: string,
  payload?: object,
  link?: string // deep link "view[:resourceId]" — e.g. "videos:cm_x" — opened when clicked
) {
  await db.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      payload: payload ? JSON.stringify(payload) : undefined,
      link,
    },
  });
}

export async function audit(
  user: AuthUser | null,
  action: string,
  resourceType?: string,
  resourceId?: string,
  meta?: object
) {
  await db.auditLog.create({
    data: {
      userId: user?.id,
      action,
      resourceType,
      resourceId,
      meta: meta ? JSON.stringify(meta) : undefined,
    },
  });
}
