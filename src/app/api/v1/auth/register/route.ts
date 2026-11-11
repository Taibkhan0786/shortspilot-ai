import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { handler, ok, parseBody, fail } from "@/lib/api";
import { audit } from "@/lib/notify";
import { grantCredits } from "@/lib/usage";

const schema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(8).max(100),
});

export const POST = handler(async (req: NextRequest) => {
  const body = await parseBody(req, schema);
  const email = body.email.toLowerCase().trim();

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return fail(409, "An account with this email already exists");

  const user = await db.user.create({
    data: {
      email,
      name: body.name.trim(),
      passwordHash: hashPassword(body.password),
      role: "USER",
    },
  });

  // default profile + trial subscription + welcome credits
  await db.userProfile.create({ data: { userId: user.id } });
  await db.subscription.create({
    data: {
      userId: user.id,
      planId: "free_trial",
      status: "TRIAL",
      periodEnd: new Date(Date.now() + 14 * 24 * 3600 * 1000),
    },
  });
  await grantCredits(user.id, 25, "Welcome credits (free trial)");
  await db.automationRule.create({ data: { userId: user.id } });

  const session = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
  await audit({ id: user.id, email, name: user.name, role: user.role }, "auth.register", "user", user.id);

  const res = ok({ id: user.id, email: user.email, name: user.name, role: user.role }, 201);
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions());
  return res;
});
