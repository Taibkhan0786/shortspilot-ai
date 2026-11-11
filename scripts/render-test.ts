/**
 * Render pipeline self-test — run OUTSIDE the dev server to diagnose local
 * FFmpeg problems (Windows especially):
 *
 *   npx tsx scripts/render-test.ts     # or: bunx tsx scripts/render-test.ts
 *
 * Verifies, in order:
 *   1. ffmpeg + ffprobe are on PATH and the build has libx264 + zoompan/drawtext
 *   2. ffmpeg can actually generate a test image + audio (color/sine sources)
 *   3. the real render pipeline produces a captioned 1080x1920 MP4 end-to-end
 */
import fs from "fs/promises";
import path from "path";
import { checkFfmpegReady } from "../src/lib/pipeline/ffmpegCheck";
import { renderShort, run } from "../src/lib/pipeline/render";

async function main() {
  console.log("ShortsPilot AI — render pipeline self-test\n");

  // 1) Preflight: install + capability check (cached logic used by the app)
  process.stdout.write("1. FFmpeg/ffprobe on PATH + libx264/filters… ");
  const ff = await checkFfmpegReady();
  if (!ff.ok) {
    console.log("FAIL\n");
    console.log(`   Problem: ${ff.problem}`);
    console.log(`   ${ff.hint}`);
    process.exit(1);
  }
  console.log(`OK\n   (${ff.version})`);

  // 2) Build test assets with ffmpeg's built-in sources
  const stamp = Date.now();
  const assetsDir = path.join(process.cwd(), "public", "uploads", "tmp", `render_test_${stamp}`);
  const rel = `/uploads/tmp/render_test_${stamp}`;
  await fs.mkdir(assetsDir, { recursive: true });
  process.stdout.write("2. Generating test image + audio (ffmpeg color/sine)… ");
  try {
    await run(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "color=c=steelblue:s=540x960", "-frames:v", "1", path.join(assetsDir, "test.png")],
      30000,
      { label: "test asset (image)" }
    );
    await run(
      "ffmpeg",
      ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ar", "44100", "-ac", "2", path.join(assetsDir, "test.wav")],
      30000,
      { label: "test asset (audio)" }
    );
    console.log("OK");
  } catch (e) {
    console.log("FAIL\n");
    console.log(`   ${(e as Error).message}`);
    await fs.rm(assetsDir, { recursive: true, force: true }).catch(() => {});
    process.exit(1);
  }

  // 3) End-to-end mini render through the real pipeline (same code path as the app)
  process.stdout.write("3. Mini render (zoompan + caption + H.264 MP4)… ");
  try {
    const result = await renderShort(
      [
        {
          sceneNumber: 1,
          assetUrl: `${rel}/test.png`,
          audioUrl: `${rel}/test.wav`,
          caption: "Self-test caption",
        },
      ],
      { watermark: true }
    );
    console.log("OK");
    console.log("\nPASS — the render pipeline is healthy on this machine.");
    console.log(`   Video:     public${result.videoUrl}  (${result.duration.toFixed(1)}s, ${result.width}x${result.height})`);
    console.log(`   Thumbnail: public${result.thumbnailUrl}`);
    console.log("   Play the MP4 to confirm visually; delete both files anytime.");
  } catch (e) {
    console.log("FAIL\n");
    console.log(`   ${(e as Error).message}`);
    console.log("\n   Fix the issue above, then re-run this test until it prints PASS.");
    process.exitCode = 1;
  } finally {
    await fs.rm(assetsDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(`Unexpected failure: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
