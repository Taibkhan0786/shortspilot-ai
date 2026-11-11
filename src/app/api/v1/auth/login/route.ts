import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { handler, ok, parseBody, fail } from "@/lib/api";
import { audit } from "@/lib/notify";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = handler(async (req: NextRequest) => {
  const body = await parseBody(req, schema);
  const email = body.email.toLowerCase().trim();

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    return fail(401, "Invalid email or password");
  }
  if (user.status !== "ACTIVE") return fail(403, "Account suspended");

  const session = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
  await audit({ id: user.id, email: user.email, name: user.name, role: user.role }, "auth.login", "user", user.id);

  const res = ok({ id: user.id, email: user.email, name: user.name, role: user.role });
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions());
  return res;
});
