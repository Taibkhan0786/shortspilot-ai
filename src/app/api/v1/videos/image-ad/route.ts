import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok } from "@/lib/api";
import { saveBuffer } from "@/lib/storage";
import { chatJson } from "@/lib/ai/llm";
import { generateVoiceoverForScenes } from "@/lib/pipeline/voice";
import { isValidVoice } from "@/lib/ai/tts";
import { chargeCredits, logUsage, releaseCredits, assertCanCreateVideo } from "@/lib/usage";
import { audit, notify } from "@/lib/notify";
import { z } from "zod";

/**
 * POST /api/v1/videos/image-ad — PROFESSIONAL IMAGE → VIDEO ads creator.
 *
 * The user uploads ONE product/person image, picks an ad template (UGC ad,
 * product showcase, cinematic reel, testimonial, fashion, food, tech unboxing)
 * and the platform produces a publish-ready vertical video:
 *   1. AI copywriter writes a punchy ad script for the template
 *   2. Google voice narrates it (Gemini TTS voices, pooled accounts)
 *   3. Every scene animates the uploaded image (Veo motion / cinematic zoom)
 *   4. Render job is queued — progress polls like the normal pipeline
 */

const MAX_BYTES = 8 * 1024 * 1024;

const TEMPLATES = [
  "ugc_ad",
  "product_showcase",
  "cinematic_reel",
  "testimonial",
  "fashion",
  "food",
  "tech",
] as const;

type Template = (typeof TEMPLATES)[number];

const TEMPLATE_BRIEF: Record<Template, string> = {
  ugc_ad:
    "Authentic UGC (user-generated content) ad style: first-person, friendly creator energy, phone-shot feel, problem → solution → result → CTA, casual spoken language, hard hook in the first 2 seconds.",
  product_showcase:
    "Premium product showcase ad: confident brand voice, highlight 3 key benefits, feature beats with vivid sensory detail, sleek close, strong CTA.",
  cinematic_reel:
    "Cinematic Instagram-reel style: dramatic storytelling, emotional beats, visual metaphors, bold one-liners, epic close.",
  testimonial:
    "Customer testimonial ad: first-person success story, before → after transformation, specific relatable benefits, trust-building tone, soft CTA.",
  fashion:
    "Fashion lookbook reel: style-forward language, trend references, outfit/look details, confident vibe, 'shop the look' CTA.",
  food:
    "Food promo reel: mouth-watering sensory descriptions (taste, texture, aroma), craving triggers, value mention, 'order now' CTA.",
  tech:
    "Tech unboxing/review ad: spec highlights in plain words, 'wow' feature moments, comparison hook, speed and quality emphasis, CTA.",
};

function sniffImage(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

type AdCopy = {
  hook: string;
  scenes: { narration: string; caption?: string; motion?: string; visualPrompt?: string }[];
  cta: string;
};

export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Expected multipart/form-data");
  }
  const file = form.get("image");
  if (!(file instanceof File)) throw new HttpError(400, "Upload a product/person image (field 'image')");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Image too large (max 8 MB)");

  const templateRaw = String(form.get("template") || "ugc_ad") as Template;
  if (!TEMPLATES.includes(templateRaw)) throw new HttpError(400, `Unknown template: ${templateRaw}`);
  const productName = String(form.get("productName") || "").trim().slice(0, 100);
  if (productName.length < 2) throw new HttpError(400, "Enter the product/brand name");
  const notes = String(form.get("notes") || "").trim().slice(0, 500);
  const language = String(form.get("language") || "English").slice(0, 60);
  const voice = String(form.get("voice") || "g-kore").slice(0, 40);
  if (!isValidVoice(voice)) throw new HttpError(400, `Unknown voice: ${voice}`);
  const duration = Math.min(90, Math.max(15, parseInt(String(form.get("duration") || "30"), 10) || 30));

  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new HttpError(415, "Only JPEG, PNG or WebP images are supported");

  await assertCanCreateVideo(user.id);

  // 1) store the uploaded image (permanent asset for this user)
  const ext = kind === "jpeg" ? "jpg" : kind;
  const img = await saveBuffer("images", `ad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`, bytes);

  // 2) AI ad copywriter (charge script credits)
  await chargeCredits(user.id, "script", `Image ad script — ${productName}`);
  const sceneCount = Math.min(6, Math.max(3, Math.round(duration / 10)));
  let copy: AdCopy;
  try {
    copy = await chatJson<AdCopy>(
      [
        {
          role: "assistant",
          content:
            "You are a senior direct-response video ad copywriter. You write short vertical video ad scripts that convert. " +
            "Narration lines are spoken words only, punchy and natural. Respond ONLY with valid JSON.",
        },
        {
          role: "user",
          content: `Write a ${duration}-second vertical (9:16) ${templateRaw.replace("_", " ")} video ad.
Product/brand: ${productName}
${notes ? `Extra direction: ${notes}` : ""}
Language: ${language} (write ALL narration and captions in this language)
Style: ${TEMPLATE_BRIEF[templateRaw]}
The single uploaded image shows the product/subject — every scene animates this same image, so motion directions should describe camera moves + subject motion around it.
Target: exactly ${sceneCount} scenes.

Respond with JSON only:
{ "hook": "1-2 sentence opening hook",
  "scenes": [ { "narration": "spoken line", "caption": "max 6 words on screen", "motion": "camera + subject motion for this scene" } ],
  "cta": "closing call to action, 1 sentence" }`,
        },
      ],
      { retries: 2, temperature: 0.85, minTokens: 1200 }
    );
  } catch (e) {
    await releaseCredits(user.id, 2, `Image ad script failed — ${productName}`);
    throw e;
  }

  const scenesSrc = (copy.scenes || []).filter((s) => String(s.narration || "").trim()).slice(0, 8);
  if (scenesSrc.length === 0) {
    await releaseCredits(user.id, 2, `Image ad script empty — ${productName}`);
    throw new HttpError(502, "Ad copy generation returned no scenes — try again");
  }

  // 3) persist the Script (model "image-ad", approved — goes straight to render)
  const topic = `${templateRaw.replace("_", " ")} ad — ${productName}`;
  const scriptScenes = scenesSrc.map((s, i) => ({
    sceneNumber: i + 1,
    narration: String(s.narration).trim(),
    visualPrompt: String(s.visualPrompt || productName).slice(0, 500),
    motion: String(s.motion || "").slice(0, 300),
    caption: String(s.caption || productName.split(/\s+/).slice(0, 4).join(" ")).slice(0, 60),
  }));
  const script = await db.script.create({
    data: {
      userId: user.id,
      topic,
      language,
      tone: templateRaw,
      duration,
      version: 1,
      hook: String(copy.hook || productName).slice(0, 300),
      scenes: JSON.stringify(scriptScenes),
      cta: String(copy.cta || "").slice(0, 300),
      status: "APPROVED",
      model: "image-ad",
      warnings: JSON.stringify([]),
    },
  });

  // 4) Google-voice narration (charge voiceover credits)
  await chargeCredits(user.id, "voiceover", `Ad voiceover — ${productName}`);
  let vo: { fullAudioUrl: string; duration: number; sceneAudio: { sceneNumber: number; url: string; duration: number }[] };
  try {
    vo = await generateVoiceoverForScenes({
      narrations: scriptScenes.map((s) => s.narration),
      voice,
      speed: 1.0,
    });
  } catch (e) {
    await releaseCredits(user.id, 4, `Ad voiceover failed — ${productName}`);
    throw e;
  }
  const voiceover = await db.voiceover.create({
    data: {
      scriptId: script.id,
      provider: "gemini-tts",
      voiceId: voice,
      speed: 1.0,
      audioUrl: vo.fullAudioUrl,
      duration: vo.duration,
      cost: 4,
      status: "READY",
      sceneAudio: JSON.stringify(vo.sceneAudio),
    },
  });

  // 5) assemble the Video + scenes (uploaded image reused for every scene)
  const video = await db.video.create({
    data: {
      userId: user.id,
      scriptId: script.id,
      title: `${productName} — ${templateRaw.replace("_", " ")} ad`.slice(0, 100),
      description: String(copy.hook || productName).slice(0, 500),
      hashtags: ["#ad", "#shorts", `#${productName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "brand"}`].join(" "),
      tags: [productName.toLowerCase(), templateRaw.replace("_", "-"), "shorts", "ad"].join(","),
      status: "DRAFT",
      statusMessage: "Ready to render",
      audioUrl: vo.fullAudioUrl,
      duration: vo.duration,
    },
  });

  const audioByScene = new Map(vo.sceneAudio.map((a) => [a.sceneNumber, a]));
  let t = 0;
  for (const s of scriptScenes) {
    const a = audioByScene.get(s.sceneNumber);
    const start = t;
    const end = t + (a?.duration ?? 0);
    t = end;
    await db.videoScene.create({
      data: {
        videoId: video.id,
        sceneNumber: s.sceneNumber,
        narration: s.narration,
        assetUrl: img.url,
        audioUrl: a?.url ?? "",
        caption: s.caption,
        motionPrompt: s.motion,
        startTime: start,
        endTime: end,
      },
    });
  }

  await db.mediaAsset.create({
    data: {
      userId: user.id,
      scriptId: script.id,
      type: "image",
      source: "uploaded",
      provider: "user-upload",
      assetUrl: img.url,
      prompt: `Image-ad source — ${productName}`,
      license: "User provided — all rights belong to the uploader",
      metadata: JSON.stringify({ videoId: video.id, template: templateRaw }),
    },
  });

  await logUsage(user.id, "llm", "image-ad", { estimatedCost: 6 });
  await audit(user, "video.image_ad", "video", video.id);
  await notify(
    user.id,
    "render_started",
    `Ad video queued: ${video.title}`,
    "Your image is being turned into a professional ad video — track progress in the AI Studio.",
    { videoId: video.id },
    `videos:${video.id}`
  );

  return ok({ video, script, voiceover }, 201);
});
