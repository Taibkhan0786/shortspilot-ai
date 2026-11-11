import { NextRequest } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

export const POST = handler(async (req: NextRequest) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  const res = ok({ success: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
});
