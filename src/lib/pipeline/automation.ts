import { db } from "@/lib/db";
import { generateIdeas, generateScript, generateMetadata, validateScript } from "@/lib/engine/content";
import { generateVoiceoverForScenes } from "@/lib/pipeline/voice";
import { generateVisualsForScenes } from "@/lib/pipeline/visuals";
import { notify } from "@/lib/notify";
import { chargeCredits, logUsage } from "@/lib/usage";

/**
 * Full automation run (PRD §5 automated journey):
 * idea → script → voice → visuals → video record → render job → publish/approval.
 * Runs while AutomationRule.running holds the per-user lock.
 */
export async function runAutomationPipeline(userId: string) {
  const rule = await db.automationRule.findUnique({ where: { userId } });
  if (!rule || !rule.enabled || rule.running) return;

  await db.automationRule.update({ where: { userId }, data: { running: true } });
  try {
    const profile = await db.userProfile.findUnique({ where: { userId } });
    const channel = await db.youTubeChannel.findFirst({
      where: { userId, status: "CONNECTED" },
      orderBy: { connectedAt: "asc" },
    });

    // ---- budget guard (PRD §6.19) ----
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const spend = await db.creditLedger.aggregate({
      where: { userId, type: "CHARGE", createdAt: { gte: monthStart } },
      _sum: { amount: true },
    });
    if ((spend._sum.amount ?? 0) > rule.budgetLimit) {
      await notify(userId, "usage_limit", "Automation paused: budget limit reached",
        `Monthly automation budget is ${rule.budgetLimit} credits. Raise it in Automation settings to continue.`, undefined, "automation");
      return;
    }

    // ---- daily / weekly limit guards ----
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
    const todayCount = await db.video.count({ where: { userId, createdAt: { gte: dayStart } } });
    const weekCount = await db.video.count({ where: { userId, createdAt: { gte: weekStart } } });
    if (todayCount >= rule.dailyLimit) return;
    if (weekCount >= rule.weeklyLimit) return;

    const niche = rule.niche || profile?.niche || "general knowledge";
    const language = profile?.language || "English";
    const voice = profile?.voiceId || "tongtong";
    const speed = profile?.voiceSpeed || 1.0;
    const style = profile?.visualStyle || "cinematic";
    const tone = profile?.scriptStyle || "educational";
    const audience = profile?.audience || "general audience";

    // ---- 1. idea ----
    await chargeCredits(userId, "idea", "Automation: content idea");
    const { ideas, sources } = await generateIdeas({ niche, language, count: 1 });
    const idea = ideas[0];
    await logUsage(userId, "llm", "idea", { estimatedCost: 1 });
    const ideaRecord = await db.contentIdea.create({
      data: {
        userId,
        channelId: channel?.id,
        topic: idea.topic,
        hook: idea.hook,
        angle: idea.angle,
        language,
        duration: idea.duration,
        sources: JSON.stringify(sources),
        status: "APPROVED",
        score: idea.score,
      },
    });

    // duplicate-topic guard: if topic already used recently, still proceed but note it
    // ---- 2. script ----
    await chargeCredits(userId, "script", `Automation: script — ${idea.topic}`);
    const spec = await generateScript({
      topic: idea.topic, language, tone, duration: ideaRecord.duration, audience, niche,
    });
    const warnings = [...validateScript({ scenes: spec.scenes, duration: ideaRecord.duration })];
    const script = await db.script.create({
      data: {
        ideaId: ideaRecord.id,
        userId,
        topic: idea.topic,
        language,
        tone,
        duration: ideaRecord.duration,
        hook: spec.hook,
        scenes: JSON.stringify(spec.scenes),
        cta: spec.cta,
        status: "APPROVED",
        model: "glm",
        warnings: JSON.stringify([...new Set([...warnings, ...spec.warnings])]),
      },
    });
    await logUsage(userId, "llm", "script", { estimatedCost: 2 });

    // ---- 3. voice ----
    await chargeCredits(userId, "voiceover", `Automation: voiceover — ${idea.topic}`);
    const vo = await generateVoiceoverForScenes({
      narrations: spec.scenes.map((s) => s.narration),
      voice, speed,
    });
    const voiceover = await db.voiceover.create({
      data: {
        scriptId: script.id,
        provider: "zai-tts",
        voiceId: voice,
        speed,
        audioUrl: vo.fullAudioUrl,
        duration: vo.duration,
        cost: 4,
        status: "READY",
        sceneAudio: JSON.stringify(vo.sceneAudio),
      },
    });
    await logUsage(userId, "tts", "voiceover", { units: spec.scenes.length, estimatedCost: 4 });

    // ---- 4. visuals ----
    const visualCredits = spec.scenes.length * 1.5;
    await chargeCredits(userId, "visual_per_scene", `Automation: visuals — ${idea.topic}`, undefined, spec.scenes.length);
    const { visuals } = await generateVisualsForScenes({
      prompts: spec.scenes.map((s) => ({ sceneNumber: s.sceneNumber, visualPrompt: s.visualPrompt, caption: s.caption })),
      style,
    });
    for (const v of visuals) {
      await db.mediaAsset.create({
        data: {
          userId, scriptId: script.id, type: "image", sceneNumber: v.sceneNumber,
          source: "generated", provider: "zai-image", assetUrl: v.url, prompt: v.prompt,
        },
      });
    }
    await logUsage(userId, "image", "visual", { units: visuals.length, estimatedCost: visualCredits });

    // ---- 5. metadata ----
    const meta = await generateMetadata({ title: idea.topic, topic: `${idea.hook} ${idea.angle}`, language });

    // ---- 6. video record + scenes ----
    const video = await db.video.create({
      data: {
        userId,
        channelId: channel?.id,
        scriptId: script.id,
        title: meta.title,
        description: meta.description,
        hashtags: meta.hashtags.join(" "),
        tags: meta.tags.join(","),
        status: "DRAFT",
        statusMessage: "Queued for render",
      },
    });
    const visualMap = new Map(visuals.map((v) => [v.sceneNumber, v.url]));
    const audioMap = new Map(vo.sceneAudio.map((a) => [a.sceneNumber, { url: a.url, dur: a.duration }]));
    let t = 0;
    for (const s of spec.scenes) {
      const a = audioMap.get(s.sceneNumber);
      const start = t;
      const end = t + (a?.dur ?? 0);
      t = end;
      await db.videoScene.create({
        data: {
          videoId: video.id,
          sceneNumber: s.sceneNumber,
          narration: s.narration,
          assetUrl: visualMap.get(s.sceneNumber) ?? "",
          audioUrl: a?.url ?? "",
          caption: s.caption,
          startTime: start,
          endTime: end,
        },
      });
    }
    await db.video.update({ where: { id: video.id }, data: { duration: vo.duration } });

    // ---- 7. render job ----
    await db.renderJob.create({ data: { videoId: video.id, status: "QUEUED" } });
    await notify(userId, "info", `Automation produced "${video.title}"`,
      "Idea, script, voice, visuals and render were generated automatically. It will appear in your approval queue unless automatic publishing is on.",
      { videoId: video.id, ideaId: ideaRecord.id, scriptId: script.id },
      `videos:${video.id}`);
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "Automation run failed";
    console.error("[automation]", message);
    await notify(userId, "generation_failed", "Automation run failed", message, undefined, "automation");
  } finally {
    await db.automationRule.updateMany({ where: { userId }, data: { running: false, lastRunAt: new Date() } });
  }
}
