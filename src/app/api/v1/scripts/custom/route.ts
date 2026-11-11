import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, safeJsonParse } from "@/lib/api";
import { chatJson } from "@/lib/ai/llm";
import { getGeminiTunables } from "@/lib/ai/config";
import { type SceneSpec, validateScript } from "@/lib/engine/content";
import { chargeCredits, logUsage } from "@/lib/usage";
import { audit, notify } from "@/lib/notify";
import { z } from "zod";

const schema = z.object({
  title: z.string().min(2).max(150).optional(),
  scriptText: z.string().min(30).max(20000),
  language: z.string().max(60).optional(),
  tone: z.enum(["educational", "storytelling", "commentary", "entertainment"]).optional(),
  duration: z.number().int().min(15).max(600).optional(),
});

type StructuredScenes = { scenes: { narration: string; visualPrompt?: string; motion?: string; caption?: string }[] };

/** Split raw text into narration-sized scene chunks WITHOUT any AI (fallback). */
function localSplitScenes(text: string): SceneSpec[] {
  const chunks: string[] = [];
  const paragraphs = text
    .split(/\n\s*\n|\n(?=[-•*]|\d+[.)]\s)/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length > 1) {
    chunks.push(...paragraphs);
  } else {
    // split long prose into ~2-sentence scenes
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
    let cur = "";
    for (const s of sentences) {
      if ((cur + " " + s).trim().split(/\s+/).length > 34) {
        if (cur.trim()) chunks.push(cur.trim());
        cur = s;
      } else {
        cur = (cur + " " + s).trim();
      }
    }
    if (cur.trim()) chunks.push(cur.trim());
  }
  return chunks.slice(0, 60).map((narration, i) => ({
    sceneNumber: i + 1,
    narration,
    visualPrompt: "",
    motion: "",
    caption: narration.split(/\s+/).slice(0, 6).join(" "),
  }));
}

/**
 * POST /api/v1/scripts/custom — turn the USER'S OWN script text into a
 * scene-structured Script that flows through the normal pipeline
 * (voice → visuals → render). The user's narration wording is preserved.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, schema);
  const profile = await db.userProfile.findUnique({ where: { userId: user.id } });

  const language = body.language || profile?.language || "English";
  const tone = body.tone || profile?.scriptStyle || "storytelling";
  const words = body.scriptText.trim().split(/\s+/).length;
  // estimate duration from word count (~150 wpm) unless explicitly given
  const estimated = Math.round(words / 2.5);
  const duration = Math.min(600, Math.max(15, body.duration ?? estimated));

  await chargeCredits(user.id, "script", `Custom script — ${body.title || body.scriptText.slice(0, 40)}`);

  let scenes: SceneSpec[] = [];
  let warnings: string[] = [];
  try {
    const tunables = await getGeminiTunables();
    const result = await chatJson<StructuredScenes>(
      [
        {
          role: "assistant",
          content:
            "You structure a user's own video script into scenes WITHOUT changing their words. " +
            "Split the provided script into scene-sized narration chunks (1-3 short spoken sentences each). " +
            "Preserve the user's wording — you may only remove markdown symbols and fix obvious typos. " +
            "For each scene write a visualPrompt (detailed vertical 9:16 image direction matching that part of the script) " +
            "and a motion direction (cinematic subject action + camera move). Respond ONLY with valid JSON.",
        },
        {
          role: "user",
          content: `Structure this ${language} script (tone: ${tone}) into 3-40 scenes.

USER SCRIPT (do not rewrite the narration, only split it):
"""
${body.scriptText}
"""

Respond with JSON only:
{ "scenes": [ { "narration": "user's own words for this scene", "visualPrompt": "...", "motion": "...", "caption": "max 8 words" } ] }`,
        },
      ],
      { retries: 2, temperature: Math.min(tunables.temperature, 0.6), minTokens: Math.min(16384, words * 4 + 500) }
    );
    scenes = (result.scenes || [])
      .map((s, i) => ({
        sceneNumber: i + 1,
        narration: String(s.narration || "").trim(),
        visualPrompt: String(s.visualPrompt || "").trim(),
        motion: String(s.motion || "").trim().slice(0, 300),
        caption: String(s.caption || "").trim().slice(0, 60),
      }))
      .filter((s) => s.narration);
  } catch (e) {
    console.error("[custom-script] LLM structuring failed, using local split:", e instanceof Error ? e.message : e);
  }

  // Fallback: deterministic split — the feature must work even without an LLM
  if (scenes.length === 0) {
    scenes = localSplitScenes(body.scriptText);
    warnings.push("Structured locally (AI structuring unavailable) — narration preserved, visual prompts will be auto-generated.");
  }

  warnings = [...warnings, ...validateScript({ scenes, duration })];

  const topic = (body.title || body.scriptText.replace(/\s+/g, " ").slice(0, 70)).trim();
  const existingCount = await db.script.count({ where: { userId: user.id, topic } });

  const script = await db.script.create({
    data: {
      userId: user.id,
      topic,
      language,
      tone,
      duration,
      version: existingCount + 1,
      hook: scenes[0]?.narration.slice(0, 300) ?? "",
      scenes: JSON.stringify(scenes),
      cta: scenes[scenes.length - 1]?.narration.slice(0, 300) ?? "",
      status: "DRAFT",
      model: "custom-script",
      warnings: JSON.stringify([...new Set(warnings)]),
    },
  });

  await logUsage(user.id, "llm", "script", { estimatedCost: 2 });
  await audit(user, "script.custom", "script", script.id);
  await notify(user.id, "script_ready", `Script ready: ${topic}`, "Your own script was structured into scenes — review and approve it.", undefined, `scripts:${script.id}`);

  return ok({ script: { ...script, scenes: safeJsonParse(script.scenes, []), warnings: safeJsonParse(script.warnings, []) } }, 201);
});
