import { NextRequest } from "next/server";
import { z } from "zod";
import { handler, ok, parseBody } from "@/lib/api";
import { getSessionUser, HttpError } from "@/lib/auth";
import { supportChat, supportChatStream, resolveOrigin } from "@/lib/ai/support";

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(40),
  // stream: true → Server-Sent Events response (token-by-token, feels instant)
  stream: z.boolean().optional(),
});

// Naive per-IP sliding window: 20 messages / 60 s (in-memory, resets on restart).
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

/**
 * POST /api/v1/support/chat — ShortsPilot AI assistant ("Pilot").
 * Works signed-in or signed-out (landing page guidance). Per-IP rate limited.
 * Default response is Server-Sent Events streaming; send { stream: false } for
 * the legacy JSON envelope.
 */
export const POST = handler(async (req: NextRequest) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) throw new HttpError(429, "Too many messages — please wait a minute and try again.");

  const body = await parseBody(req, schema);
  const user = await getSessionUser(req);
  const ctx = user ? { name: user.name, role: user.role } : null;

  if (body.stream === false) {
    const reply = await supportChat(body.messages, ctx, resolveOrigin(req));
    return ok({ reply });
  }

  // ---- SSE streaming ----
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        for await (const delta of supportChatStream(body.messages, ctx, resolveOrigin(req))) {
          send("delta", { text: delta });
        }
        send("done", { ok: true });
      } catch (e) {
        const status = (e as { status?: number }).status ?? 502;
        const message = e instanceof Error ? e.message : "The assistant is temporarily unavailable.";
        send("error", { status, message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
