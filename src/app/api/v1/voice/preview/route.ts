import { NextRequest } from "next/server";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { ttsPreview, isValidVoice } from "@/lib/ai/tts";
import { logUsage } from "@/lib/usage";
import { z } from "zod";

const schema = z.object({
  text: z.string().min(1).max(1000),
  voice: z.string().max(40).optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
});

/** POST /api/v1/voice/preview — short voice sample for the voice library. */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  const voice = body.voice || "tongtong";
  if (!isValidVoice(voice)) throw new HttpError(400, `Unknown voice: ${voice}`);
  const { url } = await ttsPreview(body.text, voice, body.speed ?? 1.0);
  await logUsage(user.id, "tts", "preview", { estimatedCost: 0 });
  return ok({ audioUrl: url });
});
