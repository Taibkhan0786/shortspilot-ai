import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/api";
import { getOAuthConfig, buildAuthUrl, getRedirectUri } from "@/lib/youtube";

/**
 * GET /api/v1/youtube/auth — start the real Google OAuth 2.0 consent flow
 * (authorization-code + offline access). Redirects the browser to Google.
 * A signed state is stored in an httpOnly cookie and verified in the callback.
 */
export const GET = handler(async (req: NextRequest) => {
  await requireUser(req); // must be signed in to connect a channel

  const cfg = await getOAuthConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "Google OAuth is not configured on this instance. Ask an Admin to add the Google OAuth Client ID + Secret in /admin → API & Integrations.",
      },
      { status: 400 }
    );
  }

  const state = crypto.randomBytes(24).toString("hex");
  const redirectUri = getRedirectUri(req);
  const authUrl = buildAuthUrl(cfg.clientId, redirectUri, state);

  const res = NextResponse.redirect(authUrl, 302);
  res.cookies.set("sp_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: (req.headers.get("x-forwarded-proto") ?? "http") === "https",
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });
  return res;
});
