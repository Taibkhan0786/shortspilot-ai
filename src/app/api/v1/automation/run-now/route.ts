import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { runAutomationPipeline } from "@/lib/pipeline/automation";
import { audit } from "@/lib/notify";

/** POST /api/v1/automation/run-now — trigger one automation run immediately. */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const rule = await db.automationRule.findUnique({ where: { userId: user.id } });
  if (!rule) throw new HttpError(404, "Automation settings missing");
  if (rule.running) throw new HttpError(409, "An automation run is already in progress");

  runAutomationPipeline(user.id).catch((e) => console.error("[automation]", e.message));
  await audit(user, "automation.run_now", "automationRule", rule.id);
  return ok({ started: true }, 202);
});
