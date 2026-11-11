import { NextRequest } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "sp_session";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

/** Create a DB-backed session and return the opaque token. */
export async function createSession(userId: string, userAgent?: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const session = await db.session.create({
    data: {
      token,
      userId,
      userAgent: userAgent?.slice(0, 250) ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return session;
}

export async function destroySession(token: string) {
  await db.session.deleteMany({ where: { token } });
}

/** Read the Authorization session from cookie; returns user or null. */
export async function getSessionUser(req: NextRequest): Promise<AuthUser | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (session.user.status !== "ACTIVE") return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Require an authenticated user or throw 401. */
export async function requireUser(req: NextRequest): Promise<AuthUser> {
  const user = await getSessionUser(req);
  if (!user) throw new HttpError(401, "Authentication required");
  return user;
}

/** Require an authenticated admin or throw 403. */
export async function requireAdmin(req: NextRequest): Promise<AuthUser> {
  const user = await requireUser(req);
  if (user.role !== "ADMIN") throw new HttpError(403, "Admin permission required");
  return user;
}

export function sessionCookieOptions(maxAge = SESSION_TTL_MS / 1000) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false, // sandbox runs behind gateway TLS termination
    path: "/",
    maxAge,
  };
}
