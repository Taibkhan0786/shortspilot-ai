import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { audit } from "@/lib/notify";
import {
  getAiSetting,
  getElevenLabsKey,
  getGeminiTunables,
  invalidateAiConfigCache,
  GEMINI_TUNABLE_DEFAULTS,
} from "@/lib/ai/config";
import { getGeminiKeyPool, maskKey } from "@/lib/ai/keyPool";
import { isZaiUnavailable } from "@/lib/ai/llm";
import { setSettingValue, deleteSettingValue } from "@/lib/payments";

/**
 * GET /api/v1/admin/ai/config — AI provider status for this deployment.
 * z-ai is the built-in provider (sandbox); Gemini (free tier) is the self-hosted
 * fallback for text; Edge TTS (free) for voice; Pollinations (free) for visuals.
 * Also returns the Gemini generation tunables, the ACCOUNT POOL and the Veo engine.
 */
export const GET = handler(async (req: NextRequest) => {
  await requireAdmin(req);
  const pool = await getGeminiKeyPool().catch(() => [] as string[]);
  const model = (await getAiSetting("gemini_model").catch(() => null))?.trim() || "auto";
  const tunables = await getGeminiTunables();
  const veoEnabled = (await getAiSetting("veo_enabled").catch(() => null)) === "true";
  const veoEngine = ((await getAiSetting("veo_engine").catch(() => null))?.trim() === "omni" ? "omni" : "veo3") as
    | "veo3"
    | "omni";
  return ok({
    zai: { builtIn: true, available: !isZaiUnavailable() },
    gemini: {
      configured: pool.length > 0,
      source: pool.length > 0 ? "db" : null,
      model,
      poolSize: pool.length,
      poolKeys: pool.map(maskKey),
    },
    elevenlabs: { configured: Boolean(await getElevenLabsKey().catch(() => null)) },
    tunables: {
      ...tunables,
      defaults: GEMINI_TUNABLE_DEFAULTS,
    },
    veo: { enabled: veoEnabled, engine: veoEngine },
    fallbacks: {
      tts: "edge (free, no key)",
      image: "pollinations (free, no key)",
      search: "duckduckgo + google news (free, no key)",
    },
    selfHosted: isZaiUnavailable(),
    help: { geminiKeyUrl: "https://aistudio.google.com/apikey" },
  });
});

const numberOrNull = (min: number, max: number) =>
  z.number().min(min).max(max).nullable().optional();

const schema = z.object({
  geminiApiKey: z.string().min(20).max(300).optional(),
  // MULTI-ACCOUNT POOL: newline/comma separated API keys (10 accounts x 50 credits etc.)
  geminiKeyPool: z.string().max(20000).optional(),
  elevenlabsApiKey: z.string().min(20).max(200).optional(),
  geminiModel: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9._-]*$/, "model name format")
    .optional(),
  // --- Gemini generation tunables (null = reset to default) ---
  geminiTemperature: numberOrNull(0, 2),
  geminiSupportTemperature: numberOrNull(0, 1),
  geminiMaxTokens: numberOrNull(256, 16384),
  geminiTimeout: numberOrNull(10, 120),
  // --- Veo cinematic motion toggle + engine ---
  veoEnabled: z.boolean().optional(),
  veoEngine: z.enum(["veo3", "omni"]).optional(),
});

async function setNumberSetting(key: string, value: number | null | undefined, fallback: number) {
  if (value === undefined) return;
  if (value === null) {
    await deleteSettingValue(key);
  } else {
    await setSettingValue(key, String(Number.isFinite(value) ? value : fallback));
  }
}

/**
 * POST /api/v1/admin/ai/config — Admin saves the Gemini keys (AES-256-GCM
 * encrypted at rest), the multi-account pool, generation tunables and the
 * Veo engine. This is the ONLY source for the keys (admin panel only).
 */
export const POST = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const body = await parseBody(req, schema);
  if (body.geminiApiKey) await setSettingValue("gemini_api_key", body.geminiApiKey, true);
  if (body.geminiKeyPool !== undefined) {
    // empty string clears the pool; otherwise store a deduped JSON array
    const keys = [
      ...new Set(
        body.geminiKeyPool
          .split(/[\n,;]+/)
          .map((k) => k.trim().replace(/^["']|["']$/g, ""))
          .filter((k) => k.length >= 20)
      ),
    ];
    if (keys.length > 0) {
      await setSettingValue("gemini_api_keys", JSON.stringify(keys), true);
    } else {
      await deleteSettingValue("gemini_api_keys");
    }
  }
  if (body.elevenlabsApiKey) await setSettingValue("elevenlabs_api_key", body.elevenlabsApiKey.trim(), true);
  if (body.geminiModel !== undefined) {
    // empty string clears the override → automatic model chain
    if (body.geminiModel.trim()) {
      await setSettingValue("gemini_model", body.geminiModel.trim());
    } else {
      await deleteSettingValue("gemini_model");
    }
  }
  await setNumberSetting("gemini_temperature", body.geminiTemperature, GEMINI_TUNABLE_DEFAULTS.temperature);
  await setNumberSetting("gemini_support_temperature", body.geminiSupportTemperature, GEMINI_TUNABLE_DEFAULTS.supportTemperature);
  await setNumberSetting("gemini_max_tokens", body.geminiMaxTokens, GEMINI_TUNABLE_DEFAULTS.maxTokens);
  await setNumberSetting("gemini_timeout", body.geminiTimeout, GEMINI_TUNABLE_DEFAULTS.timeoutMs / 1000);
  if (body.veoEnabled !== undefined) {
    await setSettingValue("veo_enabled", body.veoEnabled ? "true" : "false");
  }
  if (body.veoEngine !== undefined) {
    await setSettingValue("veo_engine", body.veoEngine);
  }
  invalidateAiConfigCache();

  const pool = await getGeminiKeyPool().catch(() => [] as string[]);
  await audit(admin, "admin.ai.config.update", "appSetting", undefined, {
    gemini: Boolean(body.geminiApiKey),
    poolAdded: body.geminiKeyPool !== undefined ? pool.length : undefined,
    elevenlabs: Boolean(body.elevenlabsApiKey),
    model: body.geminiModel !== undefined ? body.geminiModel.trim() || "auto" : undefined,
    tunables: {
      temperature: body.geminiTemperature,
      supportTemperature: body.geminiSupportTemperature,
      maxTokens: body.geminiMaxTokens,
      timeout: body.geminiTimeout,
      veo: body.veoEnabled,
      veoEngine: body.veoEngine,
    },
  });

  return ok({
    zai: { builtIn: true, available: !isZaiUnavailable() },
    gemini: {
      configured: pool.length > 0,
      source: pool.length > 0 ? "db" : null,
      model: (await getAiSetting("gemini_model").catch(() => null))?.trim() || "auto",
      poolSize: pool.length,
      poolKeys: pool.map(maskKey),
    },
    elevenlabs: { configured: Boolean(await getElevenLabsKey().catch(() => null)) },
    tunables: { ...getGeminiTunables(), defaults: GEMINI_TUNABLE_DEFAULTS },
    veo: {
      enabled: (await getAiSetting("veo_enabled").catch(() => null)) === "true",
      engine: (await getAiSetting("veo_engine").catch(() => null))?.trim() === "omni" ? "omni" : "veo3",
    },
  });
});

/** DELETE /api/v1/admin/ai/config — clear a stored key / the account pool. */
export const DELETE = handler(async (req: NextRequest) => {
  const admin = await requireAdmin(req);
  const target = new URL(req.url).searchParams.get("key");
  if (target === "elevenlabs") {
    await deleteSettingValue("elevenlabs_api_key");
    invalidateAiConfigCache();
    await audit(admin, "admin.ai.config.clear", "appSetting", "elevenlabs_api_key");
    return ok({ elevenlabs: { configured: false } });
  }
  if (target === "pool") {
    await deleteSettingValue("gemini_api_keys");
    invalidateAiConfigCache();
    await audit(admin, "admin.ai.config.clear", "appSetting", "gemini_api_keys");
    return ok({ gemini: { poolSize: 0, poolKeys: [] } });
  }
  await deleteSettingValue("gemini_api_key");
  invalidateAiConfigCache();
  await audit(admin, "admin.ai.config.clear", "appSetting", "gemini_api_key");
  return ok({ gemini: { configured: false, source: null, model: "auto", poolSize: 0, poolKeys: [] }, zai: { builtIn: true, available: !isZaiUnavailable() } });
});
