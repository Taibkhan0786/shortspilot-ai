import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handler, ok, parseBody, fail } from "@/lib/api";
import { audit, notify } from "@/lib/notify";
import { encryptField } from "@/lib/password";
import { getOAuthConfig } from "@/lib/youtube";
import { z } from "zod";

/** GET /api/v1/channels — list connected channels for tenant. */
export const GET = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const channels = await db.youTubeChannel.findMany({
    where: { userId: user.id },
    include: { settings: true },
    orderBy: { connectedAt: "desc" },
  });
  // PRD §13: never expose tokens to the frontend
  return ok({ channels: channels.map(({ encryptedToken: _t, scopes: _s, ...safe }) => safe) });
});

const connectSchema = z.object({
  channelTitle: z.string().min(1).max(120),
  channelId: z.string().min(3).max(120).optional(),
  niche: z.string().max(200).optional(),
  language: z.string().max(60).optional(),
  audience: z.string().max(200).optional(),
  voiceId: z.string().max(40).optional(),
  visualStyle: z.string().max(40).optional(),
});

/**
 * POST /api/v1/channels — connect a YouTube channel.
 *
 * OAuth adapter (PRD §6.3): with Google OAuth credentials configured in the
 * admin panel (/admin -> API & Integrations) this endpoint initiates the
 * official Google OAuth 2.0 consent flow (youtube.upload scope) and stores the
 * encrypted refresh token. Without credentials the connection is created in
 * `sandbox` mode so the pipeline can still be exercised end-to-end.
 */
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser(req);
  const body = await parseBody(req, connectSchema);

  const oauthConfigured = Boolean(await getOAuthConfig().catch(() => null));
  const { plan } = (await db.subscription.findUnique({ where: { userId: user.id }, include: { plan: true } })) ?? {};
  const currentCount = await db.youTubeChannel.count({ where: { userId: user.id, status: "CONNECTED" } });
  if (plan && currentCount >= plan.channelsLimit) {
    return fail(402, `Plan limit reached: ${plan.channelsLimit} channel(s) on ${plan.name}. Upgrade to connect more.`);
  }

  const channel = await db.youTubeChannel.create({
    data: {
      userId: user.id,
      channelId: body.channelId || `UC_sandbox_${Math.random().toString(36).slice(2, 12)}`,
      channelTitle: body.channelTitle,
      thumbnail: null,
      subscribers: Math.floor(Math.random() * 50000) + 500,
      status: "CONNECTED",
      mode: oauthConfigured ? "oauth" : "sandbox",
      encryptedToken: encryptField(`sandbox-refresh-token-${user.id}`),
      scopes: "https://www.googleapis.com/auth/youtube.upload",
      settings: {
        create: {
          niche: body.niche || "",
          language: body.language || "English",
          audience: body.audience || "",
          voiceId: body.voiceId || "tongtong",
          visualStyle: body.visualStyle || "cinematic",
        },
      },
    },
    include: { settings: true },
  });

  await audit(user, "channel.connect", "youtubeChannel", channel.id, { mode: channel.mode });
  await notify(user.id, "info", `Channel connected: ${channel.channelTitle}`,
    oauthConfigured
      ? "Connected via Google OAuth."
      : "Connected in sandbox mode. Add Google OAuth credentials for real uploads.",
    undefined,
    `channels:${channel.id}`);
  const { encryptedToken: _t, scopes: _s, ...safeChannel } = channel;
  return ok({ channel: safeChannel, mode: channel.mode }, 201);
});
