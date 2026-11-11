import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { handler, ok, getPagination, parseBody } from "@/lib/api";
import { audit, notify } from "@/lib/notify";
import { hashPassword } from "@/lib/password";
import { z } from "zod";

/**
 * Latest credit balance per user (SQLite). The CreditLedger is append-only;
 * the newest row per user holds the running balance. Uses the implicit rowid.
 */
async function latestBalances(): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ userId: string; balance: number }[]>`
    SELECT userId, balance FROM CreditLedger
    WHERE rowid IN (SELECT MAX(rowid) FROM CreditLedger GROUP BY userId)
  `;
  return new Map(rows.map((r) => [r.userId, r.balance]));
}

/** GET /api/v1/admin/users — user management list with credits + caps. */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const { skip, take, page } = getPagination(req.url, 30);
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q") || undefined;
  const where = q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : {};
  const [users, total, balances] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, role: true, status: true, createdAt: true,
        subscription: { select: { status: true, plan: { select: { id: true, name: true, price: true } } } },
        profile: { select: { monthlyLimit: true } },
        _count: { select: { videos: true, ideas: true, channels: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.user.count({ where }),
    latestBalances(),
  ]);
  return ok({
    users: users.map((u) => ({ ...u, credits: balances.get(u.id) ?? 0 })),
    total,
    page,
  });
});

const patchSchema = z.object({
  userId: z.string().min(5),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  role: z.enum(["USER", "ADMIN"]).optional(),
  newPassword: z.string().min(8).max(100).optional(),
  monthlyLimit: z.number().min(1).max(100000).optional(),
});

/** PATCH /api/v1/admin/users — suspend/activate, role, password reset, monthly cap. */
export const PATCH = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, patchSchema);
  if (body.userId === admin.id && body.status === "SUSPENDED") {
    throw Object.assign(new Error("You cannot suspend yourself"), { status: 400 });
  }
  if (body.userId === admin.id && body.role && body.role !== "ADMIN") {
    throw Object.assign(new Error("You cannot demote yourself"), { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.status) data.status = body.status;
  if (body.role) data.role = body.role;
  if (body.newPassword) data.passwordHash = hashPassword(body.newPassword);

  const user = await db.user.update({
    where: { id: body.userId },
    data,
    select: { id: true, email: true, name: true, status: true, role: true },
  });

  if (typeof body.monthlyLimit === "number") {
    await db.userProfile.upsert({
      where: { userId: user.id },
      update: { monthlyLimit: body.monthlyLimit },
      create: { userId: user.id, monthlyLimit: body.monthlyLimit },
    });
  }

  await audit(admin, "admin.user.update", "user", user.id, {
    status: body.status, role: body.role,
    passwordReset: Boolean(body.newPassword),
    monthlyLimit: body.monthlyLimit,
  });

  if (body.newPassword) {
    await notify(user.id, "info", "Password reset by admin", "An administrator set a new password for your account. Contact support if this wasn't expected.", undefined, "settings");
  }
  if (body.status === "SUSPENDED") {
    await db.session.deleteMany({ where: { userId: user.id } }); // kill live sessions
  }
  return ok({ user });
});

const deleteSchema = z.object({ userId: z.string().min(5) });

/** DELETE /api/v1/admin/users?userId= — hard delete a user and all tenant data. */
export const DELETE = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const parsed = deleteSchema.safeParse({ userId: new URL(req.url).searchParams.get("userId") ?? "" });
  if (!parsed.success) throw Object.assign(new Error("userId query parameter is required"), { status: 400 });
  const userId = parsed.data.userId;
  if (userId === admin.id) throw Object.assign(new Error("You cannot delete yourself"), { status: 400 });
  const user = await db.user.delete({ where: { id: userId }, select: { email: true } });
  await audit(admin, "admin.user.delete", "user", userId, { email: user.email });
  return ok({ success: true });
});
