import { handler, ok } from "@/lib/api";
import os from "os";
import { APP_VERSION, APP_BUILD } from "@/lib/version";

export const GET = handler(async () => {
  return ok({
    status: "ok",
    service: "shortspilot-ai",
    version: `${APP_VERSION} (${APP_BUILD})`,
    time: new Date().toISOString(),
    node: process.version,
    hostname: os.hostname(),
  });
});
