import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok } from "@/lib/api";

/** GET /api/v1/billing/subscription — current subscription + plan. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const subscription = await db.subscription.findUnique({
    where: { userId: user.id },
    include: { plan: true },
  });
  return ok({ subscription });
});
