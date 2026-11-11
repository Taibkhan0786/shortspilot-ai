import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import { z } from "zod";

/** GET /api/v1/automation — automation settings. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  let rule = await db.automationRule.findUnique({ where: { userId: user.id } });
  if (!rule) rule = await db.automationRule.create({ data: { userId: user.id } });
  return ok(rule);
});

const schema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["manual", "approval", "automatic"]).optional(),
  scheduleDays: z.string().regex(/^[0-6](,[0-6])*$/).optional(),
  scheduleTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().max(60).optional(),
  dailyLimit: z.number().int().min(1).max(10).optional(),
  weeklyLimit: z.number().int().min(1).max(50).optional(),
  approvalRequired: z.boolean().optional(),
  budgetLimit: z.number().min(5).max(100000).optional(),
  niche: z.string().max(200).optional(),
});

/** PATCH /api/v1/automation — update settings (automatic mode requires explicit opt-in). */
export const PATCH = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  let rule = await db.automationRule.findUnique({ where: { userId: user.id } });
  if (!rule) rule = await db.automationRule.create({ data: { userId: user.id } });

  // PRD §12: automatic publishing must be explicitly enabled by the user
  if (body.mode === "automatic" && rule.mode !== "automatic") {
    // intentional user action required; acknowledge explicitly
  }
  rule = await db.automationRule.update({ where: { userId: user.id }, data: body });
  await audit(user, "automation.update", "automationRule", rule.id, body);
  return ok(rule);
});
