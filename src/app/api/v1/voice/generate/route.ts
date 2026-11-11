import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, safeJsonParse } from "@/lib/api";
import { generateVoiceoverForScenes } from "@/lib/pipeline/voice";
import { isValidVoice } from "@/lib/ai/tts";
import { chargeCredits, logUsage, releaseCredits } from "@/lib/usage";
import { audit } from "@/lib/notify";
import { z } from "zod";

const schema = z.object({
  scriptId: z.string().min(5),
  voice: z.string().max(40).optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
});

/**
 * POST /api/v1/voice/generate — voiceover for an approved/draft script (PRD §6.7).
 * Generates per-scene audio + a full narration track; records cost & durations.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);

  const script = await db.script.findUnique({ where: { id: body.scriptId } });
  if (!script || script.userId !== user.id) throw new HttpError(404, "Script not found");

  const scenes = safeJsonParse<{ sceneNumber: number; narration: string }[]>(script.scenes, []);
  if (scenes.length === 0) throw new HttpError(400, "Script has no scenes");

  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });
  const voice = body.voice || profile?.voiceId || "tongtong";
  if (!isValidVoice(voice)) throw new HttpError(400, `Unknown voice: ${voice}`);
  const speed = body.speed ?? profile?.voiceSpeed ?? 1.0;

  await chargeCredits(user.id, "voiceover", `Voiceover — ${script.topic}`);
  try {
    const result = await generateVoiceoverForScenes({
      narrations: scenes.map((s) => s.narration),
      voice,
      speed,
    });
    const voiceover = await db.voiceover.create({
      data: {
        scriptId: script.id,
        provider: "zai-tts",
        voiceId: voice,
        speed,
        audioUrl: result.fullAudioUrl,
        duration: result.duration,
        cost: 4,
        status: "READY",
        sceneAudio: JSON.stringify(result.sceneAudio),
      },
    });
    await logUsage(user.id, "tts", "voiceover", { units: scenes.length, estimatedCost: 4 });
    await audit(user, "voice.generate", "voiceover", voiceover.id);
    return ok({ voiceover: { ...voiceover, sceneAudio: result.sceneAudio } }, 201);
  } catch (e) {
    await releaseCredits(user.id, 4, `Voiceover failed refund — ${script.topic}`, script.id);
    throw e;
  }
});
