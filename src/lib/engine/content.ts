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
    duration: Math.min(90, Math.max(15, Number(i.duration) || 45)),
    score: Math.min(100, Math.max(0, Number(i.score) || 70)),
  })).filter((i) => i.topic);

  if (ideas.length === 0) throw new Error("Idea generation returned no usable ideas");
  return { ideas, sources };
}

/** Generate a structured scene-level script (PRD §6.6). */
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
  const sceneCount = Math.max(3, Math.min(8, Math.round(duration / 9)));

  const user = `Write a ${duration}-second YouTube Shorts script.
Topic: ${topic}
${niche ? `Niche: ${niche}` : ""}
Language: ${language} (write ALL narration and captions in this language)
Tone/format: ${tone}
Audience: ${audience || "general audience"}
Target: exactly ${sceneCount} scenes${researchNotes ? `\n\nVerified research notes (do not contradict; do not add unverified facts):\n${researchNotes}` : ""}

Respond with JSON only:
{
  "hook": "string - 1-2 sentence opening hook",
  "scenes": [
    { "sceneNumber": 1,
      "narration": "string - spoken words for this scene",
      "visualPrompt": "string - vertical 9:16 image description, art direction, style, lighting; no text overlays in image",
      "caption": "string - max 8 words on-screen text" }
  ],
  "cta": "string - closing call to action (1 sentence)",
  "warnings": ["string - factual uncertainty or sensitivity flags, empty array if none"]
}`;

  const tunables = await getGeminiTunables();
  const result = await chatJson<ScriptSpec>(
    [
      { role: "assistant", content: SCRIPT_SYSTEM },
      { role: "user", content: user },
    ],
    { retries: 2, temperature: tunables.temperature }
  );

  const scenes = (result.scenes || [])
    .map((s, i) => ({
      sceneNumber: i + 1,
      narration: String(s.narration || "").trim(),
      visualPrompt: String(s.visualPrompt || "").trim(),
      caption: String(s.caption || "").trim().slice(0, 60),
    }))
    .filter((s) => s.narration);

  if (scenes.length === 0) throw new Error("Script generation returned no scenes");

  const warnings = Array.isArray(result.warnings) ? result.warnings.map(String).slice(0, 5) : [];
  return { hook: String(result.hook || topic).slice(0, 300), scenes, cta: String(result.cta || "").slice(0, 300), warnings };
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
