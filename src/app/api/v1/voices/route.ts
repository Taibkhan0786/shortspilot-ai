import { handler, ok } from "@/lib/api";
import { VOICES } from "@/lib/ai/tts";

/** GET /api/v1/voices — available voice catalog (PRD §6.7). */
export const GET = handler(async () => {
  return ok({ voices: VOICES });
});
