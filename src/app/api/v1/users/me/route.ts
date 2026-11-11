import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import { hashPassword, verifyPassword } from "@/lib/password";
import { z } from "zod";

/** GET /api/v1/users/me — profile + settings. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const [profile, subscription] = await Promise.all([
    db.userProfile.findUnique({ where: { userId: user.id } }),
    db.subscription.findUnique({ where: { userId: user.id }, include: { plan: true } }),
  ]);
  return ok({ user, profile, subscription });
});

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  profile: z
    .object({
      displayName: z.string().max(80).optional(),
      timezone: z.string().max(60).optional(),
      niche: z.string().max(200).optional(),
      audience: z.string().max(200).optional(),
      language: z.string().max(60).optional(),
      scriptStyle: z.enum(["educational", "storytelling", "commentary", "entertainment"]).optional(),
      voiceId: z.string().max(40).optional(),
      voiceSpeed: z.number().min(0.5).max(2.0).optional(),
      visualStyle: z.enum(["cinematic", "cartoon", "realistic", "minimalist"]).optional(),
      duration: z.number().int().min(15).max(90).optional(),
      videosPerWeek: z.number().int().min(1).max(21).optional(),
      publishDays: z.string().max(20).optional(),
      publishTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      approvalMode: z.enum(["manual", "approval", "automatic"]).optional(),
      monthlyLimit: z.number().min(5).max(100000).optional(),
    })
    .optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(100).optional(),
});

/** PATCH /api/v1/users/me — update profile / change password (PRD §6.1). */
export const PATCH = handler(async (req: NextRequest) => {
  const authUser = await requireUser(req);
  const body = await parseBody(req, patchSchema);

  let nameUpdate = {};
  if (body.name) nameUpdate = { name: body.name };

  let passwordUpdate = {};
  if (body.newPassword) {
    if (!body.currentPassword) throw new HttpError(400, "Current password is required to change password");
    const rec = await db.user.findUnique({ where: { id: authUser.id } });
    if (!rec || !verifyPassword(body.currentPassword, rec.passwordHash)) {
      throw new HttpError(401, "Current password is incorrect");
    }
    passwordUpdate = { passwordHash: hashPassword(body.newPassword) };
  }

  const user = await db.user.update({
    where: { id: authUser.id },
    data: { ...nameUpdate, ...passwordUpdate },
  });
  if (body.profile) {
    await db.userProfile.upsert({
      where: { userId: user.id },
      update: body.profile,
      create: { userId: user.id, ...body.profile },
    });
  }
  await audit(authUser, "user.update", "user", user.id);
  return ok({ success: true });
});

/** DELETE /api/v1/users/me — account deletion (PRD §6.1). */
export const DELETE = handler(async (req: NextRequest) => {
  const authUser = await requireUser(req);
  await db.user.delete({ where: { id: authUser.id } }); // cascades tenant data
  await audit(null, "user.delete", "user", authUser.id, { email: authUser.email });
  return ok({ success: true });
});
