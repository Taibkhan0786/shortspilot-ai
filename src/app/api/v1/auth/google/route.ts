import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { handler } from "@/lib/api";
import { getOAuthConfig } from "@/lib/youtube";
import { resolveOrigin } from "@/lib/ai/support";

export const GOOGLE_STATE_COOKIE = "sp_google_state";

function backToApp(req: NextRequest, status: "error" | "ok", msg?: string): NextResponse {
  const params = new URLSearchParams({ auth: "google", status });
  if (msg) params.set("msg", msg.slice(0, 200));
  return NextResponse.redirect(`${resolveOrigin(req)}/?${params.toString()}`);
}

/**
 * GET /api/v1/auth/google — start "Continue with Google" sign-in.
 * Uses the SAME Google OAuth client as YouTube connect, configured exclusively
 * by an Admin in /admin -> API & Integrations (no .env fallback).
 * Scope: openid email profile (no offline access needed).
 */
export const GET = handler(async (req: NextRequest) => {
  const origin = resolveOrigin(req);
  const cfg = await getOAuthConfig().catch(() => null);
  if (!cfg) {
    return backToApp(
      req,
      "error",
      "Google sign-in is not configured yet. Add your Google OAuth Client ID + Secret in Admin -> Integrations."
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: `${origin}/api/v1/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // sandbox runs behind gateway TLS termination
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });
  return res;
});
