import ZAI from "z-ai-web-dev-sdk";
import { getGeminiKey, getAiSetting, getGeminiTunables } from "./config";
import { HttpError } from "@/lib/auth";
import { geminiGenerate, geminiStreamText, GeminiError, DEFAULT_GEMINI_MODELS } from "./gemini";

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;
let zaiBroken = false;

export async function getZAI() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

/** True when the sandbox-provisioned z-ai config is unavailable (e.g. self-hosted runs). */
export function isZaiUnavailable(): boolean {
  return zaiBroken;
}

export type LlmMessage = { role: "assistant" | "user"; content: string };

function isRateLimitError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit");
}

async function zaiChat(messages: LlmMessage[]): Promise<string> {
  const zai = await getZAI();
  const completion = await zai.chat.completions.create({
    messages,
    thinking: { type: "disabled" },
  });
  const content: string | undefined =
    completion?.choices?.[0]?.message?.content ?? completion?.content;
  if (!content || !content.trim()) throw new Error("Empty LLM response");
  return content;
}

/**
 * STREAMING z-ai chat — resolves to the raw SSE ReadableStream
 * (`data: {…chunk…}` lines, terminated by `data: [DONE]`).
 */
export async function zaiChatStream(messages: LlmMessage[]): Promise<ReadableStream<Uint8Array>> {
  const zai = await getZAI();
  const res = await zai.chat.completions.create({
    messages,
    stream: true,
    thinking: { type: "disabled" },
  });
  if (!(res instanceof ReadableStream)) {
    throw new Error("Streaming response not supported by provider");
  }
  return res;
}

/**
 * Google Gemini fallback — free-tier friendly REST call (no SDK needed).
 * Get a free API key at https://aistudio.google.com/apikey and save it in
 * Admin -> API & Integrations (the admin panel is the only source of keys).
 * Google deprecates model names for new keys over time, so requests walk a
 * chain of current models (optional admin override first) and the first
 * model that works is remembered for subsequent calls.
 */
let cachedGeminiModel: string | null = null;

export async function geminiModelChain(): Promise<string[]> {
  const override = (await getAiSetting("gemini_model").catch(() => null))?.trim();
  const chain = override ? [override] : [];
  for (const m of DEFAULT_GEMINI_MODELS) if (m !== override) chain.push(m);
  // try the model that last worked first (but still keep the others as fallbacks)
  if (cachedGeminiModel && !override) {
    chain.sort((a, b) => (a === cachedGeminiModel ? -1 : b === cachedGeminiModel ? 1 : 0));
  }
  return chain;
}

async function geminiChat(messages: LlmMessage[], apiKey: string, temperature?: number): Promise<string> {
  const tunables = await getGeminiTunables();
  const system = messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n\n");
  const userText = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n\n");
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: userText || system || "Hello" }] }],
    generationConfig: {
      temperature: temperature ?? tunables.temperature,
      maxOutputTokens: tunables.maxTokens,
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const { text } = await geminiGenerate({
    apiKey,
    body,
    models: await geminiModelChain(),
    timeoutMs: tunables.timeoutMs,
    onModelUsed: (m) => {
      cachedGeminiModel = m;
    },
  });
  return text;
}

/** Plain chat completion with retry (PRD §12) — SPEED-TUNED retry budget. */
export async function chat(
  messages: LlmMessage[],
  opts: { retries?: number; temperature?: number } = {}
): Promise<string> {
  const { retries = 2 } = opts;
  let lastError: Error | null = null;
  let rateLimited = false;
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Provider 1: z-ai SDK (sandbox / configured deployments)
    if (!zaiBroken) {
      try {
        return await zaiChat(messages);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        const msg = lastError.message.toLowerCase();
        // config-missing / auth errors mean this deployment has no z-ai credentials
        if (msg.includes("z-ai-config") || msg.includes("configuration file") || msg.includes("unauthorized") || msg.includes("401")) {
          zaiBroken = true;
          console.error("[llm] z-ai unavailable — switching to fallback providers");
        } else {
          rateLimited = isRateLimitError(lastError);
          console.error(`[llm] attempt ${attempt} failed: ${lastError.message}`);
        }
      }
    }
    // Provider 2: Google Gemini (free tier key)
    const geminiKey = await getGeminiKey().catch(() => null);
    if (geminiKey) {
      try {
        return await geminiChat(messages, geminiKey, opts.temperature);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        rateLimited = isRateLimitError(lastError);
        console.error(`[llm] gemini attempt ${attempt} failed: ${lastError.message}`);
        if (e instanceof GeminiError && !e.transient) {
          // invalid key / bad request / geo-block: retrying can never succeed
          throw new HttpError(502, `Gemini rejected the request (${e.status}). ${e.message.slice(0, 200)}`);
        }
      }
    } else if (zaiBroken) {
      throw new HttpError(
        502,
        "No LLM provider configured. Ask an Admin to save a free Gemini key (aistudio.google.com/apikey) in Admin → API & Integrations."
      );
    }
    // Short, provider-shaped waits only — 429s move on to the next model fast.
    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, rateLimited ? [1200, 3500][attempt - 1] ?? 1200 : 400 * attempt));
    }
  }
  if (rateLimited) {
    throw new HttpError(429, "AI provider is rate-limited right now — please retry in ~20 seconds.");
  }
  if (lastError instanceof GeminiError && lastError.transient) {
    throw new HttpError(503, "Gemini is overloaded right now (all models busy) — please try again in a minute.");
  }
  throw lastError ?? new HttpError(502, "LLM request failed");
}

/** Extract the first JSON object/array from a model response. */
export function extractJson<T>(text: string): T {
  let t = text.trim();
  // strip markdown fences if present
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const starts = [t.indexOf("{"), t.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) throw new Error("No JSON found in LLM response");
  const start = Math.min(...starts);
  const openChar = t[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Unterminated JSON in LLM response");
  return JSON.parse(t.slice(start, end)) as T;
}

/** Chat completion that must return JSON, with retry. */
export async function chatJson<T>(
  messages: LlmMessage[],
  opts: { retries?: number; temperature?: number } = {}
): Promise<T> {
  const { retries = 2 } = opts;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const text = await chat(messages, { retries: 1, temperature: opts.temperature });
      return extractJson<T>(text);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.error(`[llm-json] attempt ${attempt} failed: ${lastError.message}`);
    }
  }
  throw lastError ?? new Error("LLM JSON request failed");
}
