import { chatJson, chat } from "@/lib/ai/llm";
import { getGeminiTunables } from "@/lib/ai/config";
import { researchTopic } from "@/lib/ai/search";

export type IdeaResult = {
  topic: string;
  hook: string;
  angle: string;
  duration: number;
  score: number;
};

export type SceneSpec = {
  sceneNumber: number;
  narration: string;
  visualPrompt: string;
  /** optional Flow-AI style motion direction (subject action + camera move) */
  motion?: string;
  caption: string;
};

export type ScriptSpec = {
  hook: string;
  scenes: SceneSpec[];
  cta: string;
  warnings: string[];
};

const IDEA_SYSTEM = `You are a YouTube Shorts content strategist. Generate original, specific, high-retention content ideas.
Respond ONLY with valid JSON. Never invent statistics or fake citations.`;

const SCRIPT_SYSTEM = `You are an expert YouTube Shorts scriptwriter. Write original scripts optimized for retention.
Rules:
- Hook must grab attention in the first 2 seconds. Never start with "Hey guys" or channel intros.
- Narration is spoken text only (no stage directions, no camera notes).
- Each scene narration must be 1-3 sentences.
- visualPrompt: describes ONE vertical (9:16) image to display during the scene. No text in image. Detailed art direction.
- CHARACTER CONSISTENCY (critical): invent ONE specific recurring main character for the video (age, gender, ethnicity, hairstyle, hair color, outfit, one distinctive feature) and describe that character with the SAME exact wording at the start of every scene's visualPrompt (e.g. "A 28-year-old Indian woman with long black hair, wearing a mustard kurti and gold earrings, ..."). The character must look identical in every scene so the video feels like one continuous story.
- motion: cinematic motion for the scene — what the character does + camera move (e.g. "she turns to camera and smiles, slow push-in"). Keep the character the active subject.
- caption: max 8 words, punchy on-screen text for the scene.
- Never fabricate statistics, quotes, dates, or events. If a factual claim is uncertain, include it in "warnings".
Respond ONLY with valid JSON.`;

/** Generate content ideas for a niche (PRD §6.4), optionally grounded with research. */
export async function generateIdeas(opts: {
  niche: string;
  audience?: string;
  language: string;
  customTopic?: string;
  count?: number;
  excludeTopics?: string[];
  research?: boolean;
}): Promise<{ ideas: IdeaResult[]; sources: { title: string; url: string; host?: string; date?: string }[] }> {
  const { niche, audience, language, customTopic, count = 3, excludeTopics = [], research = true } = opts;

  let researchBlock = "";
  let sources: { title: string; url: string; host?: string; date?: string }[] = [];
  if (research) {
    const r = await researchTopic(customTopic ? `${customTopic} ${niche}` : `${niche} trends 2026`);
    sources = r.sources;
    if (r.notes) researchBlock = `\nUse this verified research as factual grounding:\n${r.notes}`;
  }

  const ideaSpec = `{
  "ideas": [
    { "topic": "string - specific video topic",
      "hook": "string - opening hook line",
      "angle": "string - unique content angle",
      "duration": number - suggested seconds (30-60),
      "score": number - potential score 0-100 }
  ]
}`;

  const user = `Channel niche: ${niche}
Target audience: ${audience || "general audience"}
Language: ${language}
${customTopic ? `Base the ideas on this specific topic/prompt: "${customTopic}"` : "Generate fresh trend-aware ideas in this niche."}
${excludeTopics.length ? `Avoid these existing topics: ${excludeTopics.slice(0, 20).join("; ")}` : ""}${researchBlock}

Generate ${count} distinct ideas. Respond with JSON only:
${ideaSpec}`;

  const tunables = await getGeminiTunables();
  const result = await chatJson<{ ideas: IdeaResult[] }>(
    [
      { role: "assistant", content: IDEA_SYSTEM },
      { role: "user", content: user },
    ],
    { retries: 2, temperature: tunables.temperature }
  );

  const ideas = (result.ideas || []).slice(0, count).map((i) => ({
    topic: String(i.topic || "").slice(0, 300),
    hook: String(i.hook || "").slice(0, 500),
    angle: String(i.angle || "").slice(0, 500),
    duration: Math.min(300, Math.max(15, Number(i.duration) || 45)),
    score: Math.min(100, Math.max(0, Number(i.score) || 70)),
  })).filter((i) => i.topic);

  if (ideas.length === 0) throw new Error("Idea generation returned no usable ideas");
  return { ideas, sources };
}

/** Generate a structured scene-level script (PRD §6.6). LONG-VIDEO READY. */
export async function generateScript(opts: {
  topic: string;
  language: string;
  tone: string;
  duration: number;
  audience?: string;
  niche?: string;
  researchNotes?: string;
}): Promise<ScriptSpec> {
  const { topic, language, tone, duration, audience, niche, researchNotes } = opts;
  // ~8s per scene, scaled for long videos (5 min ≈ 37 scenes)
  const sceneCount = Math.max(3, Math.min(40, Math.round(duration / 8)));

  if (sceneCount <= 14) {
    return generateScriptSingle({ topic, language, tone, duration, audience, niche, researchNotes, sceneCount });
  }
  return generateScriptChunked({ topic, language, tone, duration, audience, niche, researchNotes, sceneCount });
}

/** Scene JSON contract shared by both generators. */
function sceneJsonContract(): string {
  return `{  "hook": "string - 1-2 sentence opening hook",
  "scenes": [
    { "sceneNumber": 1,
      "narration": "string - spoken words for this scene",
      "visualPrompt": "string - vertical 9:16 image description: START with the same recurring main character description (identical wording every scene: age, gender, hairstyle, outfit, distinctive feature), then the scene setting, art direction, style, lighting; no text overlays in image",
      "motion": "string - cinematic motion for the scene: what the SAME main character does + camera move (e.g. 'she turns to camera and smiles, slow push-in')",
      "caption": "string - max 8 words on-screen text" }
  ],
  "cta": "string - closing call to action (1 sentence)",
  "warnings": ["string - factual uncertainty or sensitivity flags, empty array if none"]
}`;
}

function baseContext(opts: { topic: string; language: string; tone: string; audience?: string; niche?: string; researchNotes?: string }): string {
  return `Topic: ${opts.topic}
${opts.niche ? `Niche: ${opts.niche}` : ""}
Language: ${opts.language} (write ALL narration and captions in this language)
Tone/format: ${opts.tone}
Audience: ${opts.audience || "general audience"}${opts.researchNotes ? `\n\nVerified research notes (do not contradict; do not add unverified facts):\n${opts.researchNotes}` : ""}`;
}

function normalizeScenes(raw: unknown, offset = 0): SceneSpec[] {
  const list = (Array.isArray(raw) ? raw : (raw as { scenes?: unknown[] })?.scenes ?? []) as Record<string, unknown>[];
  return list
    .map((s, i) => ({
      sceneNumber: offset + i + 1,
      narration: String(s?.narration || "").trim(),
      visualPrompt: String(s?.visualPrompt || "").trim(),
      motion: String(s?.motion || "").trim().slice(0, 300),
      caption: String(s?.caption || "").trim().slice(0, 60),
    }))
    .filter((s) => s.narration);
}

/** Standard path: one call for scripts up to ~14 scenes. */
async function generateScriptSingle(opts: {
  topic: string; language: string; tone: string; duration: number;
  audience?: string; niche?: string; researchNotes?: string; sceneCount: number;
}): Promise<ScriptSpec> {
  const user = `Write a ${opts.duration}-second YouTube Shorts script.
${baseContext(opts)}
Target: exactly ${opts.sceneCount} scenes

Respond with JSON only:
${sceneJsonContract()}`;

  const tunables = await getGeminiTunables();
  const result = await chatJson<ScriptSpec>(
    [
      { role: "assistant", content: SCRIPT_SYSTEM },
      { role: "user", content: user },
    ],
    { retries: 2, temperature: tunables.temperature, minTokens: Math.min(16384, opts.sceneCount * 180 + 400) }
  );

  const scenes = normalizeScenes(result.scenes);
  if (scenes.length === 0) throw new Error("Script generation returned no scenes");

  const warnings = Array.isArray(result.warnings) ? result.warnings.map(String).slice(0, 5) : [];
  return { hook: String(result.hook || opts.topic).slice(0, 300), scenes, cta: String(result.cta || "").slice(0, 300), warnings };
}

/** Long-video path: outline first, then parallel chunk expansion (fast + coherent). */
async function generateScriptChunked(opts: {
  topic: string; language: string; tone: string; duration: number;
  audience?: string; niche?: string; researchNotes?: string; sceneCount: number;
}): Promise<ScriptSpec> {
  const CHUNK = 12;
  const parts = Math.ceil(opts.sceneCount / CHUNK);

  // Phase 1: one narrative outline so all chunks tell one coherent story
  const outlineUser = `Plan a ${opts.duration}-second (${Math.round(opts.duration / 60)} minute) YouTube video script.
${baseContext(opts)}
Produce an outline of exactly ${opts.sceneCount} short beats (1-2 sentences each) that together tell a complete, well-paced story with a strong hook at beat 1 and a payoff at the end.

Respond with JSON only:
{ "beats": ["beat 1", "beat 2", ...] }`;

  const outline = await chatJson<{ beats: string[] }>(
    [
      { role: "assistant", content: SCRIPT_SYSTEM },
      { role: "user", content: outlineUser },
    ],
    { retries: 2, temperature: 0.7, minTokens: Math.min(8192, opts.sceneCount * 60 + 400) }
  );
  const beats = (outline.beats || []).map(String).filter(Boolean);
  if (beats.length === 0) throw new Error("Outline generation failed");

  // Phase 2: expand chunks in PARALLEL (each chunk knows the full outline for context)
  const chunkSpecs = Array.from({ length: parts }, (_, p) => ({
    part: p,
    beats: beats.slice(p * CHUNK, (p + 1) * CHUNK),
  })).filter((c) => c.beats.length > 0);

  const chunkResults = await Promise.all(
    chunkSpecs.map(async (chunk) => {
      const user = `You are writing PART ${chunk.part + 1} of ${parts} of a long ${opts.duration}-second YouTube video script.
${baseContext(opts)}

CHARACTER CONSISTENCY: pick ONE specific recurring main character for the whole video and open every scene's visualPrompt with the exact same character description (age, gender, hairstyle, outfit, distinctive feature) so all parts show the same person.

FULL story outline (for context — do not rewrite other parts):
${beats.map((b, i) => `${i + 1}. ${b}`).join("\n")}

Your part covers beats ${chunk.part * CHUNK + 1}-${chunk.part * CHUNK + chunk.beats.length}. Expand ONLY those beats into fully-written scenes (narration 1-3 spoken sentences per scene, visualPrompt, motion, caption).

Respond with JSON only:
{ "scenes": [ { "narration": "...", "visualPrompt": "...", "motion": "...", "caption": "..." } ] }`;
      try {
        const tunables = await getGeminiTunables();
        const r = await chatJson<{ scenes: unknown }>(
          [
            { role: "assistant", content: SCRIPT_SYSTEM },
            { role: "user", content: user },
          ],
          { retries: 2, temperature: tunables.temperature, minTokens: Math.min(8192, chunk.beats.length * 200 + 400) }
        );
        return normalizeScenes(r.scenes, chunk.part * CHUNK);
      } catch (e) {
        console.error(`[script] chunk ${chunk.part + 1}/${parts} failed: ${e instanceof Error ? e.message : e}`);
        return [] as SceneSpec[];
      }
    })
  );

  const scenes = chunkResults.flat().map((s, i) => ({ ...s, sceneNumber: i + 1 }));
  if (scenes.length === 0) throw new Error("Long script generation failed — all chunks errored");

  const missing = opts.sceneCount - scenes.length;
  const warnings: string[] = [];
  if (missing > 0) warnings.push(`${missing} outline beat(s) could not be expanded — script has ${scenes.length} scenes.`);
  return {
    hook: String(scenes[0]?.narration || opts.topic).slice(0, 300),
    scenes,
    cta: String(scenes[scenes.length - 1]?.narration || "").slice(0, 300),
    warnings,
  };
}

/** Quality validation for scripts (PRD §12 validate_script). */
export function validateScript(spec: { scenes: SceneSpec[]; duration: number }): string[] {
  const warnings: string[] = [];
  const words = spec.scenes.reduce((n, s) => n + s.narration.split(/\s+/).length, 0);
  const estimatedSeconds = Math.round(words / 2.6); // ~155 wpm
  if (estimatedSeconds > spec.duration * 1.35) {
    warnings.push(`Estimated narration length (${estimatedSeconds}s) exceeds target duration (${spec.duration}s).`);
  }
  if (estimatedSeconds < spec.duration * 0.55) {
    warnings.push(`Estimated narration (${estimatedSeconds}s) is much shorter than target (${spec.duration}s).`);
  }
  if (spec.scenes.some((s) => !s.visualPrompt)) {
    warnings.push("One or more scenes are missing visual prompts.");
  }
  if (spec.scenes.length < 3) {
    warnings.push("Script has fewer than 3 scenes.");
  }
  return warnings;
}

/** Video metadata generation (PRD §6.11). */
export async function generateMetadata(opts: {
  title: string;
  topic: string;
  language: string;
}): Promise<{ title: string; description: string; hashtags: string[]; tags: string[] }> {
  const user = `Generate YouTube Shorts metadata.
Video topic/title: ${opts.title}
Content summary: ${opts.topic}
Language: ${opts.language}

Rules: title under 80 chars, no clickbait lies, no keyword stuffing, description 1-3 sentences + hashtags, 8-15 relevant hashtags starting with #, 10-15 lowercase tags without #.

Respond with JSON only:
{ "title": "string", "description": "string", "hashtags": ["#tag"], "tags": ["tag"] }`;

  const result = await chatJson<{ title: string; description: string; hashtags: string[]; tags: string[] }>(
    [
      { role: "assistant", content: "You are a YouTube metadata specialist. Avoid misleading titles and keyword stuffing. Respond ONLY with valid JSON." },
      { role: "user", content: user },
    ],
    { retries: 2 }
  );

  return {
    title: String(result.title || opts.title).slice(0, 100),
    description: String(result.description || "").slice(0, 500),
    hashtags: (Array.isArray(result.hashtags) ? result.hashtags : [])
      .map((h) => (String(h).startsWith("#") ? String(h) : `#${h}`))
      .slice(0, 15),
    tags: (Array.isArray(result.tags) ? result.tags : []).map(String).slice(0, 15),
  };
}

/** AI performance optimizer: recommendations from stored analytics (PRD §6.16). */
export async function performanceRecommendations(stats: {
  videos: { title: string; views: number; likes: number; duration: number; topic?: string }[];
}): Promise<{ recommendations: string[]; experiments: string[] }> {
  if (stats.videos.length === 0) {
    return {
      recommendations: [
        "Publish your first videos to unlock AI performance insights.",
        "Keep hooks under 3 seconds and durations between 30-60s while you build baseline data.",
      ],
      experiments: [
        "Try two different hook styles on similar topics and compare retention.",
      ],
    };
  }
  const user = `Channel performance data (views/likes per Short):
${stats.videos.map((v) => `- "${v.title}" | ${v.views} views | ${v.likes} likes | ${v.duration}s`).join("\n")}

Analyze which topics/formats/durations perform best. Provide evidence-based suggestions. Never guarantee performance.
Respond with JSON only:
{ "recommendations": ["string"], "experiments": ["string"] }`;
  try {
    const result = await chatJson<{ recommendations: string[]; experiments: string[] }>(
      [
        { role: "assistant", content: "You are a YouTube growth analyst. Ground every recommendation in the provided data. Respond ONLY with valid JSON." },
        { role: "user", content: user },
      ],
      { retries: 2 }
    );
    return {
      recommendations: (result.recommendations || []).map(String).slice(0, 6),
      experiments: (result.experiments || []).map(String).slice(0, 4),
    };
  } catch {
    return { recommendations: ["Analysis temporarily unavailable. Try again shortly."], experiments: [] };
  }
}
