import { db } from "@/lib/db";
import { processRenderJob, processPublishingJob, syncAnalytics } from "@/lib/pipeline/jobs";
import { runAutomationPipeline } from "@/lib/pipeline/automation";

const globalForWorker = globalThis as unknown as {
  spWorkerStarted?: boolean;
  spWorkerTimers?: NodeJS.Timeout[];
};

let renderBusy = false;
let publishBusy = false;
let tickCount = 0;

async function tick() {
  tickCount++;
  try {
    // render queue: one job at a time (rendering is CPU heavy)
    if (!renderBusy) {
      const next = await db.renderJob.findFirst({
        where: { status: "QUEUED" },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        renderBusy = true;
        processRenderJob(next.id)
          .catch((e) => console.error("[worker/render]", e.message))
          .finally(() => { renderBusy = false; });
      }
    }

    // publishing queue: due jobs
    if (!publishBusy) {
      const next = await db.publishingJob.findFirst({
        where: {
          uploadStatus: { in: ["PENDING", "UPLOADING", "PROCESSING"] },
          OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        publishBusy = true;
        processPublishingJob(next.id)
          .catch((e) => console.error("[worker/publish]", e.message))
          .finally(() => { publishBusy = false; });
      }
    }

    // analytics sync every ~60s
    if (tickCount % 20 === 0) {
      syncAnalytics().catch((e) => console.error("[worker/analytics]", e.message));
    }

    // automation scheduler every ~45s: check each enabled rule against its schedule window
    if (tickCount % 15 === 0) {
      checkAutomationSchedule().catch((e) => console.error("[worker/automation]", e.message));
    }
  } catch (e) {
    console.error("[worker]", e instanceof Error ? e.message : e);
  }
}

/** Is the automation rule due? day matches + within a 10-minute window after scheduleTime. */
async function checkAutomationSchedule() {
  const rules = await db.automationRule.findMany({ where: { enabled: true, running: false } });
  const now = new Date();
  const currentDay = now.getDay(); // 0=Sun
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const rule of rules) {
    // respect pause
    if (rule.pausedAt) continue;
    const days = rule.scheduleDays.split(",").map((d) => parseInt(d.trim(), 10)).filter((d) => !isNaN(d));
    if (!days.includes(currentDay)) continue;

    const [hh, mm] = rule.scheduleTime.split(":").map((x) => parseInt(x, 10));
    if (isNaN(hh) || isNaN(mm)) continue;
    const scheduledMinutes = hh * 60 + mm;
    // due if we're within [scheduled, scheduled+10min] and haven't run since that window started
    const windowStart = new Date(now);
    windowStart.setHours(hh, mm, 0, 0);
    if (currentMinutes < scheduledMinutes || currentMinutes > scheduledMinutes + 10) continue;
    if (rule.lastRunAt && rule.lastRunAt >= windowStart) continue;

    runAutomationPipeline(rule.userId).catch((e) => console.error("[automation]", e.message));
  }
}

export function startWorker() {
  if (globalForWorker.spWorkerStarted) return;
  globalForWorker.spWorkerStarted = true;
  console.log("[worker] ShortsPilot background worker started (render/publish/analytics/automation)");
  const t = setInterval(tick, 3000);
  globalForWorker.spWorkerTimers = [t];
  // first tick after a short delay to let the app settle
  setTimeout(tick, 2000);
}
