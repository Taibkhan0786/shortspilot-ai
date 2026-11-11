import { NextRequest } from "next/server";
import { requireUser, requireAdmin } from "@/lib/auth";
import { handler, ok, parseBody } from "@/lib/api";
import { getOAuthConfig, getApiKey, getRedirectUri, setSetting, deleteSetting } from "@/lib/youtube";
import { audit } from "@/lib/notify";
import { z } from "zod";

/**
 * GET /api/v1/youtube/config — what integration options are configured on this
 * instance (Google OAuth client, YouTube Data API key) + the exact redirect URI
 * that must be whitelisted in Google Cloud Console.
 */
export const GET = handler(async (req: NextRequest) => {
  await requireUser(req);
  const [oauth, apiKey] = await Promise.all([getOAuthConfig(), getApiKey()]);
  return ok({
    oauth: oauth ? { configured: true, source: oauth.source } : { configured: false, source: null },
    apiKey: { configured: Boolean(apiKey) },
    redirectUri: getRedirectUri(req),
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.upload",
    ],
  });
});

const schema = z.object({
  googleClientId: z.string().min(10).max(300).optional(),
  googleClientSecret: z.string().min(10).max(300).optional(),
  youtubeApiKey: z.string().min(10).max(200).optional(),
});

/**
 * POST /api/v1/youtube/config — Admin can configure the Google OAuth client and
 * YouTube Data API key from the UI (stored in AppSetting; secrets AES-256-GCM
 * encrypted at rest). Env variables always take precedence.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireAdmin(req);
  const body = await parseBody(req, schema);
  if (body.googleClientId) await setSetting("google_client_id", body.googleClientId);
  if (body.googleClientSecret) await setSetting("google_client_secret", body.googleClientSecret, true);
  if (body.youtubeApiKey) await setSetting("youtube_api_key", body.youtubeApiKey, true);
  await audit(user, "youtube.config.update", "appSetting", undefined, {
    clientId: Boolean(body.googleClientId),
    clientSecret: Boolean(body.googleClientSecret),
    apiKey: Boolean(body.youtubeApiKey),
  });
  const [oauth, apiKey] = await Promise.all([getOAuthConfig(), getApiKey()]);
  return ok({
    oauth: oauth ? { configured: true, source: oauth.source } : { configured: false, source: null },
    apiKey: { configured: Boolean(apiKey) },
    redirectUri: getRedirectUri(req),
  });
});

/** DELETE /api/v1/youtube/config?key=google|apiKey — clear DB-stored credentials (Admin only, env vars untouched). */
export const DELETE = handler(async (req: NextRequest) => {
  const user = await requireAdmin(req);
  const key = new URL(req.url).searchParams.get("key");
  if (key === "google") {
    await deleteSetting("google_client_id");
    await deleteSetting("google_client_secret");
  } else if (key === "apiKey") {
    await deleteSetting("youtube_api_key");
  } else {
    return ok({ error: "key must be 'google' or 'apiKey'" }, 400);
  }
  await audit(user, "youtube.config.clear", "appSetting", undefined, { key });
  return ok({ cleared: key });
});
