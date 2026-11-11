import { NextRequest, NextResponse } from "next/server";
import { ZodType } from "zod";
import { HttpError } from "@/lib/auth";

export function ok<T>(data: T, init?: number) {
  return NextResponse.json(data as object, { status: init ?? 200 });
}

export function fail(status: number, message: string, extra?: object) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Wrap a route handler with consistent error handling (PRD §11). */
export function handler(
  fn: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.message);
      const message = e instanceof Error ? e.message : "Internal server error";
      console.error("[api-error]", message);
      return fail(500, message);
    }
  };
}

/** Parse + validate JSON body with zod. Throws 400 on invalid input. */
export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    throw new HttpError(400, msg);
  }
  return parsed.data;
}

export function getPagination(url: string, defaultLimit = 50) {
  const sp = new URL(url).searchParams;
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export function safeJsonParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
