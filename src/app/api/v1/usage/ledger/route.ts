import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, getPagination } from "@/lib/api";

/** GET /api/v1/usage/ledger — credit ledger (transaction-based, PRD §6.19). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take, page } = getPagination(req.url, 30);
  const [entries, total] = await Promise.all([
    db.creditLedger.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.creditLedger.count({ where: { userId: user.id } }),
  ]);
  return ok({ entries, total, page });
});
