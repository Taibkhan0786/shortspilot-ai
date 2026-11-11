import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { getOAuthConfig } from "@/lib/youtube";
import { grantCredits } from "@/lib/usage";
import { audit } from "@/lib/notify";
import { handler } from "@/lib/api";
import { resolveOrigin } from "@/lib/ai/support";

const GOOGLE_STATE_COOKIE = "sp_google_state";

function backToApp(req: NextRequest, status: "error" | "ok", msg?: string): NextResponse {
  const params = new URLSearchParams({ auth: "google", status });
  if (msg) params.set("msg", msg.slice(0, 200));
  const res = NextResponse.redirect(`${resolveOrigin(req)}/?${params.toString()}`);
  res.cookies.set(GOOGLE_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

type GoogleProfile = { email?: string; email_verified?: boolean; name?: string; picture?: string };

/**
 * GET /api/v1/auth/google/callback — finish Google sign-in:
 *  1. validate CSRF state -> 2. exchange code -> 3. fetch userinfo ->
 *  4. find-or-create the user (existing accounts are linked by verified email;
 *     new accounts get the same provisioning as normal sign-up: profile, 14-day
 *     trial, 25 welcome credits, automation rule) -> 5. session cookie -> redirect.
 */
export const GET = handler(async (req: NextRequest) => {
  const origin = resolveOrigin(req);
  const url = new URL(req.url);

  const oauthError = url.searchParams.get("error");
  if (oauthError) return backToApp(req, "error", oauthError === "access_denied" ? "Google consent was denied." : `Google OAuth error: ${oauthError}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = req.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return backToApp(req, "error", "Invalid OAuth state — please try signing in again.");
  }

  const cfg = await getOAuthConfig().catch(() => null);
  if (!cfg) return backToApp(req, "error", "Google sign-in is not configured (Admin -> Integrations).");

  // Exchange the authorization code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: `${origin}/api/v1/auth/google/callback`,
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!tokenRes?.ok) return backToApp(req, "error", "Google token exchange failed — check the OAuth client secret in Admin -> Integrations.");
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) return backToApp(req, "error", "Google did not return an access token.");

  // Fetch the signed-in Google profile.
  const uiRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!uiRes?.ok) return backToApp(req, "error", "Could not read your Google profile.");
  const profile = (await uiRes.json()) as GoogleProfile;

  const email = profile.email?.toLowerCase().trim();
  if (!email || profile.email_verified === false) {
    return backToApp(req, "error", "Your Google account email is not verified — verify it at google.com and try again.");
  }

  let user = await db.user.findUnique({ where: { email } });
  let isNew = false;

  if (!user) {
    // First Google sign-in for this email -> provision like normal registration.
    // passwordHash is deliberately not bcrypt-verifiable: Google users sign in with Google.
    user = await db.user.create({
      data: {
        email,
        name: profile.name?.trim().slice(0, 80) || email.split("@")[0],
        passwordHash: `google-oauth:${crypto.randomBytes(24).toString("hex")}`,
        role: "USER",
      },
    });
    await db.userProfile.create({ data: { userId: user.id } });
    await db.subscription.create({
      data: {
        userId: user.id,
        planId: "free_trial",
        status: "TRIAL",
        periodEnd: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      },
    });
    await grantCredits(user.id, 25, "Welcome credits (free trial)");
    await db.automationRule.create({ data: { userId: user.id } });
    isNew = true;
  } else if (user.status !== "ACTIVE") {
    return backToApp(req, "error", "Account suspended — contact the administrator.");
  }

  const session = await createSession(user.id, req.headers.get("user-agent") ?? undefined);
  await audit(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    isNew ? "auth.register" : "auth.login",
    "user",
    user.id,
    { method: "google" }
  );

  const res = NextResponse.redirect(`${origin}/?auth=google&status=ok`);
  res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions());
  res.cookies.set(GOOGLE_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
});
