import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import { z } from "zod";

/** GET current onboarding/profile settings. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  let profile = await db.userProfile.findUnique({ where: { userId: user.id } });
  if (!profile) profile = await db.userProfile.create({ data: { userId: user.id } });
  return ok(profile);
});

const upsertSchema = z.object({
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
  onboarded: z.boolean().optional(),
});

/** Save onboarding/profile preferences. */
export const PATCH = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, upsertSchema);
  const profile = await db.userProfile.upsert({
    where: { userId: user.id },
    update: body,
    create: { userId: user.id, ...body },
  });
  await audit(user, "profile.update", "userProfile", profile.id);
  return ok(profile);
});
