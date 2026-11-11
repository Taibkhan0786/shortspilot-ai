/**
 * Cross-platform dev server launcher.
 * Runs `next dev` and tees all output to the terminal AND dev.log,
 * so it behaves identically on Windows (npm) and Linux (bun).
 *
 * Binds to 0.0.0.0 by default so other devices on your LAN/phone can open
 * http://<your-ip>:3000 — restrict it with DEV_HOST=localhost if needed.
 *
 * Usage:  npm run dev                 (port 3000, all interfaces)
 *         DEV_PORT=3001 npm run dev   (custom port)
 *         DEV_HOST=localhost npm run dev (localhost only)
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const port = process.env.DEV_PORT || "3000";
const host = process.env.DEV_HOST || "0.0.0.0";
const nextBin = require.resolve("next/dist/bin/next");
const logPath = path.join(process.cwd(), "dev.log");
const logFile = fs.createWriteStream(logPath, { flags: "a" });

function stamp() {
  return new Date().toISOString();
}

logFile.write(`\n========== dev server started ${stamp()} (port ${port}, host ${host}) ==========\n`);
process.stdout.write(`[dev] starting next dev on http://${host}:${port} (log: ${logPath})\n`);

const child = spawn(process.execPath, [nextBin, "dev", "-p", port, "-H", host], {
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

function tee(chunk) {
  process.stdout.write(chunk);
  logFile.write(chunk);
}

child.stdout.on("data", tee);
child.stderr.on("data", tee);

child.on("close", (code) => {
  logFile.write(`\n========== dev server exited (${code}) ${stamp()} ==========\n`);
  logFile.end();
  process.exit(typeof code === "number" ? code : 0);
});

["SIGINT", "SIGTERM"].forEach((sig) => {
  process.on(sig, () => {
    child.kill(sig);
  });
});
