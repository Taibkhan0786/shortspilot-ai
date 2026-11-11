import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, HttpError } from "@/lib/auth";
import { handler, ok, getPagination, parseBody } from "@/lib/api";
import { audit, notify } from "@/lib/notify";
import { grantCredits, getBalance } from "@/lib/usage";
import { z } from "zod";

/** GET /api/v1/admin/credits — platform credit stats + filterable ledger. */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const { skip, take, page } = getPagination(req.url, 40);
  const sp = new URL(req.url).searchParams;
  const userId = sp.get("userId") || undefined;
  const type = sp.get("type") || undefined;
  const q = sp.get("q") || undefined;

  const where = {
    ...(userId ? { userId } : {}),
    ...(type ? { type } : {}),
    ...(q ? { user: { OR: [{ email: { contains: q } }, { name: { contains: q } }] } } : {}),
  };

  const [ledger, total, byType, outstanding] = await Promise.all([
    db.creditLedger.findMany({
      where,
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.creditLedger.count({ where }),
    db.creditLedger.groupBy({ by: ["type"], _sum: { amount: true } }),
    db.$queryRaw<{ balance: number }[]>`
      SELECT SUM(balance) as balance FROM CreditLedger
      WHERE rowid IN (SELECT MAX(rowid) FROM CreditLedger GROUP BY userId)
    `,
  ]);

  return ok({
    ledger,
    total,
    page,
    stats: {
      outstanding: outstanding[0]?.balance ?? 0,
      granted: byType.find((t) => t.type === "GRANT")?._sum.amount ?? 0,
      spent: byType.find((t) => t.type === "CHARGE")?._sum.amount ?? 0,
      released: byType.find((t) => t.type === "RELEASE")?._sum.amount ?? 0,
      adjusted: byType.find((t) => t.type === "ADJUST")?._sum.amount ?? 0,
    },
  });
});

const schema = z.object({
  userId: z.string().min(5),
  direction: z.enum(["grant", "deduct"]),
  amount: z.number().min(0.5).max(100000),
  description: z.string().max(200).optional(),
});

/** POST /api/v1/admin/credits — manually grant or deduct credits for a user. */
export const POST = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, schema);

  const user = await db.user.findUnique({ where: { id: body.userId }, select: { id: true, email: true } });
  if (!user) throw new HttpError(404, "User not found");

  let balance: number;
  if (body.direction === "grant") {
    balance = await grantCredits(
      user.id,
      body.amount,
      body.description?.trim() || `Credits granted by admin (${admin.email})`
    );
  } else {
    balance = await getBalance(user.id);
    if (balance < body.amount) {
      throw new HttpError(400, `User only has ${balance} credits — cannot deduct ${body.amount}`);
    }
    await db.creditLedger.create({
      data: {
        userId: user.id,
        type: "ADJUST",
        amount: body.amount,
        balance: balance - body.amount,
        description: body.description?.trim() || `Credits deducted by admin (${admin.email})`,
      },
    });
    balance -= body.amount;
  }

  await audit(admin, `admin.credits.${body.direction}`, "user", user.id, {
    amount: body.amount,
    balanceAfter: balance,
    description: body.description,
  });
  await notify(
    user.id,
    "info",
    body.direction === "grant" ? `+${body.amount} credits added` : `${body.amount} credits deducted`,
    `New balance: ${balance} credits.`,
    undefined,
    "usage"
  );
  return ok({ balance, direction: body.direction, amount: body.amount });
});
