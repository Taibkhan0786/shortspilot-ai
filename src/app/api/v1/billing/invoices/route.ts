import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, getPagination } from "@/lib/api";

/** GET /api/v1/billing/invoices — invoice history. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take } = getPagination(req.url, 20);
  const invoices = await db.invoice.findMany({
    where: { subscription: { userId: user.id } },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });
  return ok({ invoices });
});
