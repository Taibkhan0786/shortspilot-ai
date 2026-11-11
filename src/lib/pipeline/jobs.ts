import { db } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { renderShort } from "@/lib/pipeline/render";
import { uploadPath, urlToAbs } from "@/lib/storage";
import { notify } from "@/lib/notify";
import { releaseCredits } from "@/lib/usage";
import { isVeoEnabled, generateVeoClip } from "@/lib/ai/veo";
import { getGeminiKey } from "@/lib/ai/config";

/** Process a queued RenderJob: scenes → MP4 → quality checks → approval state. */
export async function processRenderJob(jobId: string) {
  const job = await db.renderJob.findUnique({
    where: { id: jobId },
    include: { video: { include: { scenes: { orderBy: { sceneNumber: "asc" } } } } },
  });
  if (!job || job.status !== "QUEUED") return;

  const video = job.video;
  const claimed = await db.renderJob.updateMany({
    where: { id: job.id, status: "QUEUED" }, // claim idempotently
    data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 }, worker: "inline" },
  });
  if (claimed.count === 0) return;

  await db.video.update({
    where: { id: video.id },
    data: { status: "RENDERING", progress: 5, statusMessage: "Render started", error: null },
  });
  await notify(video.userId, "render_started", `Rendering "${video.title}"`, "Your Short is being rendered.", undefined, `videos:${video.id}`);

  try {
    const usable = video.scenes.filter((s) => s.assetUrl && s.audioUrl);
    if (usable.length === 0) {
      throw new Error("No renderable scenes: missing scene images or voiceover audio. Generate visuals and voice first.");
    }
    const missing = video.scenes.length - usable.length;
    if (missing > 0) {
      await db.video.update({
        where: { id: video.id },
        data: { statusMessage: `${missing} scene(s) missing assets — rendering ${usable.length} scene(s)` },
      });
    }

    const { watermark } = (await db.subscription.findUnique({
      where: { userId: video.userId },
      include: { plan: true },
    }))?.plan ?? { watermark: true };

    // ---- Optional Veo cinematic motion (Admin → API & Integrations toggle) ----
    // Generates a short realistic AI video from each scene still (Flow-style).
    // Any per-scene failure falls back to the built-in cinematic zoom-pan.
    const motionClips: (string | null)[] = usable.map(() => null);
    const veoWarnings: string[] = [];
    if (await isVeoEnabled()) {
      const geminiKey = await getGeminiKey().catch(() => null);
      if (!geminiKey) {
        veoWarnings.push("Veo motion skipped — no Gemini key configured.");
      } else {
        const veoDir = uploadPath("tmp", `veo_${job.id}`);
        await fs.mkdir(veoDir, { recursive: true });
        try {
          for (let i = 0; i < usable.length; i++) {
            const s = usable[i];
            await db.renderJob.update({
              where: { id: job.id },
              data: { progress: 5 + Math.round((i / usable.length) * 28), stage: `Veo motion — scene ${i + 1}/${usable.length}` },
            });
            await db.video.update({
              where: { id: video.id },
              data: { progress: 5 + Math.round((i / usable.length) * 28), statusMessage: `Veo motion — scene ${i + 1}/${usable.length}` },
            });
            try {
              const image = await fs.readFile(urlToAbs(s.assetUrl!));
              const mime = image[0] === 0xff && image[1] === 0xd8 ? "image/jpeg" : "image/png";
              const motionPrompt = [
                s.caption ? `Scene about: ${s.caption}` : "",
                `Narration: ${s.narration}`,
                "Animate this still image with smooth, realistic cinematic motion: gentle camera push-in, subtle parallax between subject and background, natural ambient movement. Stable, professional footage. No text, no captions.",
              ].filter(Boolean).join(". ");
              const { video: clip } = await generateVeoClip({
                image,
                mimeType: mime,
                prompt: motionPrompt,
                seconds: 8,
              });
              const clipPath = path.join(veoDir, `veo_${i}.mp4`);
              await fs.writeFile(clipPath, clip);
              motionClips[i] = clipPath;
            } catch (e) {
              const msg = e instanceof Error ? e.message.slice(0, 140) : "Veo clip failed";
              console.error(`[render] veo scene ${i + 1} failed: ${msg}`);
              veoWarnings.push(`Scene ${i + 1} Veo motion unavailable (${msg.slice(0, 60)}) — cinematic zoom used.`);
            }
          }
        } finally {
          fs.rm(veoDir, { recursive: true, force: true }).catch(() => {});
        }
        if (motionClips.some(Boolean)) {
          await db.video.update({
            where: { id: video.id },
            data: { statusMessage: "Veo motion ready — rendering cinematic video" },
          });
        }
      }
    }

    const result = await renderShort(
      usable.map((s, idx) => ({
        sceneNumber: s.sceneNumber,
        assetUrl: s.assetUrl!,
        audioUrl: s.audioUrl!,
        caption: s.caption,
        motionClip: motionClips[idx],
      })),
      {
        watermark,
        onProgress: async (p, stage) => {
          await db.renderJob.update({ where: { id: job.id }, data: { progress: p, stage } });
          await db.video.update({ where: { id: video.id }, data: { progress: p, statusMessage: stage } });
        },
      }
    );
    if (veoWarnings.length > 0) {
      result.warnings.unshift(...veoWarnings.slice(0, 4));
    }

    // final status: approval queue unless automatic publishing is enabled
    const automation = await db.automationRule.findUnique({ where: { userId: video.userId } });
    const autoPublish = automation?.enabled && automation.mode === "automatic" && video.channelId;
    const nextStatus = autoPublish ? "APPROVED" : "PENDING_APPROVAL";

    await db.renderJob.update({
      where: { id: job.id },
      data: { status: "DONE", progress: 100, stage: "Done", completedAt: new Date(), error: null },
    });
    await db.video.update({
      where: { id: video.id },
      data: {
        status: nextStatus,
        progress: 100,
        statusMessage:
          result.warnings.length > 0
            ? `Rendered with warnings: ${result.warnings.join(" ")}`
            : "Render complete — ready for review",
        videoUrl: result.videoUrl,
        thumbnailUrl: result.thumbnailUrl,
        audioUrl: null,
        duration: result.duration,
        width: result.width,
        height: result.height,
        error: null,
      },
    });
    await notify(
      video.userId,
      "video_ready",
      `Video ready: ${video.title}`,
      nextStatus === "PENDING_APPROVAL"
        ? "Your Short passed quality checks and is waiting for your approval."
        : "Your Short passed quality checks and will be published automatically.",
      { videoId: video.id, warnings: result.warnings },
      `videos:${video.id}`
    );

    if (autoPublish && video.channelId) {
      const key = `${video.id}:${video.channelId}`;
      await db.publishingJob.create({
        data: {
          videoId: video.id,
          channelId: video.channelId,
          uploadStatus: "PENDING",
          idempotencyKey: key,
        },
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 400) : "Render failed";
    await db.renderJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: message, completedAt: new Date(), stage: "Failed" },
    });
    await db.video.update({
      where: { id: video.id },
      data: { status: "FAILED", error: message, statusMessage: "Render failed", progress: 0 },
    });
    // release render credits on failure (PRD §6.19)
    await releaseCredits(video.userId, 3, `Render failed refund — ${video.title}`, video.id).catch(() => {});
    await notify(video.userId, "generation_failed", `Render failed: ${video.title}`, message, { videoId: video.id }, `videos:${video.id}`);
  }
}

/** Process a publishing job (sandbox adapter). Stages: UPLOADING → PROCESSING → DONE. */
export async function processPublishingJob(jobId: string) {
  const job = await db.publishingJob.findUnique({
    where: { id: jobId },
    include: { video: true, channel: true },
  });
  if (!job) return;
  if (["DONE", "CANCELLED"].includes(job.uploadStatus)) return;
  if (job.scheduledAt && job.scheduledAt > new Date()) return; // not due yet

  const claimed = await db.publishingJob.updateMany({
    where: { id: job.id, uploadStatus: { in: ["PENDING", "UPLOADING", "PROCESSING"] } },
    data: { uploadStatus: "UPLOADING", startedAt: job.startedAt ?? new Date(), attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return;

  const video = job.video;
  try {
    if (!video.videoUrl) throw new Error("Video file not ready for upload");
    if (!["APPROVED", "SCHEDULED"].includes(video.status)) {
      throw new Error(`Video status is ${video.status}; must be APPROVED or SCHEDULED to publish`);
    }
    // duplicate-upload protection (PRD §6.14)
    const existingDone = await db.publishingJob.findFirst({
      where: { videoId: video.id, uploadStatus: "DONE", id: { not: job.id } },
    });
    if (existingDone?.youtubeVideoId) {
      await db.publishingJob.update({
        where: { id: job.id },
        data: { uploadStatus: "DONE", youtubeVideoId: existingDone.youtubeVideoId, youtubeUrl: existingDone.youtubeUrl, completedAt: new Date() },
      });
      return;
    }

    await db.video.update({ where: { id: video.id }, data: { status: "SCHEDULED", statusMessage: "Uploading to YouTube" } });
    await notify(video.userId, "upload_started", `Uploading "${video.title}"`, "Your approved Short is uploading to YouTube.", undefined, `videos:${video.id}`);

    // ---- YouTube adapter: sandbox mode ----
    // With the Admin-configured Google OAuth client (Admin → API & Integrations)
    // plus a connected OAuth channel this would perform a resumable videos.insert
    // upload. In sandbox mode we simulate the upload session.
    await new Promise((r) => setTimeout(r, 2500));
    await db.publishingJob.update({ where: { id: job.id }, data: { uploadStatus: "PROCESSING" } });
    await db.video.update({ where: { id: video.id }, data: { statusMessage: "YouTube is processing the upload" } });
    await new Promise((r) => setTimeout(r, 3000));

    const youtubeVideoId = `sp_${video.id.replace(/[^a-z0-9]/gi, "").slice(0, 11).toLowerCase()}`;
    const youtubeUrl = `https://youtube.com/shorts/${youtubeVideoId}`;

    await db.publishingJob.update({
      where: { id: job.id },
      data: {
        uploadStatus: "DONE",
        youtubeVideoId,
        youtubeUrl,
        completedAt: new Date(),
        error: null,
      },
    });
    await db.video.update({
      where: { id: video.id },
      data: {
        status: "PUBLISHED",
        statusMessage: "Published to YouTube",
        publishedAt: new Date(),
        youtubeVideoId,
        youtubeUrl,
      },
    });
    await notify(
      video.userId,
      "upload_success",
      `Published: ${video.title}`,
      `Your Short is live (sandbox upload). Video ID: ${youtubeVideoId}`,
      { videoId: video.id, youtubeUrl },
      `videos:${video.id}`
    );
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 400) : "Upload failed";
    const attempts = job.attempts + 1;
    await db.publishingJob.update({
      where: { id: job.id },
      data: {
        uploadStatus: attempts >= 3 ? "FAILED" : "PENDING",
        error: message,
        completedAt: attempts >= 3 ? new Date() : null,
      },
    });
    if (attempts >= 3) {
      await db.video.update({
        where: { id: video.id },
        data: { status: "FAILED", error: `Publish failed: ${message}`, statusMessage: "Publish failed" },
      });
      await notify(video.userId, "generation_failed", `Publish failed: ${video.title}`, message, { videoId: video.id }, `videos:${video.id}`);
    }
  }
}

/** Analytics sync worker (PRD §6.15). Sandbox: simulates metrics for published Shorts. */
export async function syncAnalytics() {
  const published = await db.video.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true, publishedAt: true, duration: true, title: true },
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const v of published) {
    const publishedAt = v.publishedAt ?? new Date();
    const daysLive = Math.max(1, Math.ceil((Date.now() - publishedAt.getTime()) / 86400000));

    const last = await db.videoAnalytics.findFirst({
      where: { videoId: v.id },
      orderBy: { date: "desc" },
    });
    const lastViews = last?.views ?? 0;
    // decay curve: early days stronger, then tapering
    const base = 180 + (v.id.charCodeAt(v.id.length - 1) % 90);
    const growth = Math.round((base / daysLive) * (1 + Math.random() * 0.5));
    const newViews = lastViews + growth;
    const views = newViews;
    const likes = Math.round(views * (0.05 + Math.random() * 0.03));
    const comments = Math.round(views * (0.006 + Math.random() * 0.004));
    const subs = Math.round(views * 0.004);
    const watchTime = Math.round(views * (v.duration || 40) * 0.6);
    const avgViewDuration = Math.round((v.duration || 40) * 0.6);

    const existingToday = await db.videoAnalytics.findFirst({ where: { videoId: v.id, date: today } });
    if (existingToday) {
      await db.videoAnalytics.update({
        where: { id: existingToday.id },
        data: { views, likes, comments, subscribersGained: subs, watchTime, avgViewDuration },
      });
    } else {
      await db.videoAnalytics.create({
        data: { videoId: v.id, date: today, views, likes, comments, subscribersGained: subs, watchTime, avgViewDuration },
      });
    }
  }
}
