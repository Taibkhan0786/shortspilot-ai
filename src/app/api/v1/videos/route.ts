import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";
import { handler, ok, parseBody, getPagination, safeJsonParse } from "@/lib/api";
import { generateMetadata } from "@/lib/engine/content";
import { chargeCredits, logUsage, assertCanCreateVideo } from "@/lib/usage";
import { audit } from "@/lib/notify";
import { z } from "zod";

const createSchema = z.object({
  scriptId: z.string().min(5),
  channelId: z.string().optional(),
  generateMeta: z.boolean().optional(),
});

/**
 * POST /api/v1/videos — assemble a Video from script + latest voiceover + latest
 * scene visuals, with AI metadata (PRD §6.11/6.12). Enforces plan limits.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, createSchema);

  const script = await db.script.findUnique({ where: { id: body.scriptId } });
  if (!script || script.userId !== user.id) throw new HttpError(404, "Script not found");

  await assertCanCreateVideo(user.id); // plan shorts/month limit

  const scriptScenes = safeJsonParse<{ sceneNumber: number; narration: string; caption: string }[]>(script.scenes, []);
  if (scriptScenes.length === 0) throw new HttpError(400, "Script has no scenes");

  // latest voiceover + assets for this script
  const voiceover = await db.voiceover.findFirst({
    where: { scriptId: script.id, status: "READY" },
    orderBy: { createdAt: "desc" },
  });
  if (!voiceover) throw new HttpError(400, "Generate the voiceover first");
  const sceneAudio = safeJsonParse<{ sceneNumber: number; url: string; duration: number }[]>(voiceover.sceneAudio, []);

  const assets = await db.mediaAsset.findMany({
    where: { scriptId: script.id, type: "image", userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  const assetByScene = new Map<number, string>();
  for (const a of assets) {
    if (a.sceneNumber && !assetByScene.has(a.sceneNumber)) assetByScene.set(a.sceneNumber, a.assetUrl);
  }
  const audioByScene = new Map(sceneAudio.map((s) => [s.sceneNumber, s]));
  const missingVisuals = scriptScenes.filter((s) => !assetByScene.has(s.sceneNumber)).length;
  if (missingVisuals === scriptScenes.length) {
    throw new HttpError(400, "Generate scene visuals first");
  }

  if (body.channelId) {
    const ch = await db.youTubeChannel.findUnique({ where: { id: body.channelId } });
    if (!ch || ch.userId !== user.id) throw new HttpError(404, "Channel not found");
  }

  // metadata (PRD §6.11)
  let meta = {
    title: script.topic.slice(0, 100),
    description: script.hook,
    hashtags: ["#shorts"],
    tags: [] as string[],
  };
  if (body.generateMeta !== false) {
    try {
      await chargeCredits(user.id, "metadata", `Metadata — ${script.topic}`);
      meta = await generateMetadata({ title: script.topic, topic: `${script.hook} ${script.cta}`, language: script.language });
      await logUsage(user.id, "llm", "metadata", { estimatedCost: 0.5 });
    } catch (e) {
      console.error("[metadata]", e instanceof Error ? e.message : e);
    }
  }

  const video = await db.video.create({
    data: {
      userId: user.id,
      channelId: body.channelId,
      scriptId: script.id,
      title: meta.title,
      description: meta.description,
      hashtags: meta.hashtags.join(" "),
      tags: meta.tags.join(","),
      status: "DRAFT",
      statusMessage: missingVisuals > 0 ? `${missingVisuals} scene(s) missing visuals` : "Ready to render",
      audioUrl: voiceover.audioUrl,
      duration: voiceover.duration,
    },
  });

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
        assetUrl: assetByScene.get(s.sceneNumber) ?? "",
        audioUrl: a?.url ?? "",
        caption: s.caption,
        startTime: start,
        endTime: end,
      },
    });
  }

  await audit(user, "video.create", "video", video.id);
  return ok({ video }, 201);
});

/** GET /api/v1/videos — video library (PRD §6.12). */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const { skip, take, page } = getPagination(req.url);
  const status = new URL(req.url).searchParams.get("status") || undefined;
  const where = { userId: user.id, ...(status ? { status } : {}) };
  const [videos, total] = await Promise.all([
    db.video.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        channel: { select: { channelTitle: true } },
        renderJobs: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, progress: true, stage: true } },
      },
    }),
    db.video.count({ where }),
  ]);
  return ok({ videos, total, page });
});
