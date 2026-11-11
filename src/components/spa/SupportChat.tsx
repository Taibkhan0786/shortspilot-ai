"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, MessageCircle, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

const GREETING: Msg = {
  role: "assistant",
  content:
    "Hi! I'm Pilot, the ShortsPilot AI assistant.\n\nI can guide you through:\n- Setting up ShortsPilot on your PC\n- Connecting your YouTube channel\n- Generating ideas, scripts, voiceovers & Shorts\n- Plans, pricing and credits\n- Fixing common errors\n\nWhat would you like to know?",
};

const SUGGESTIONS = [
  "How do I set up ShortsPilot locally?",
  "How do I connect my YouTube channel?",
  "What are the plans and pricing?",
  "How do I get a free Gemini API key?",
];

/** Stream the assistant reply over SSE and call onDelta for every token. */
async function streamChat(
  history: Msg[],
  handlers: { onDelta: (t: string) => void }
): Promise<void> {
  const res = await fetch("/api/v1/support/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history.slice(-12), stream: true }),
  });

  const contentType = res.headers.get("content-type") ?? "";

  // Legacy JSON mode / gateway fallback
  if (contentType.includes("application/json")) {
    const data = (await res.json()) as { reply?: string; error?: { message?: string }; message?: string };
    if (!res.ok) throw new Error(data.error?.message ?? data.message ?? `Request failed (${res.status})`);
    handlers.onDelta(data.reply ?? "");
    return;
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let msg = `Request failed (${res.status})`;
    try {
      const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
      msg = j.error?.message ?? j.message ?? msg;
    } catch { /* keep default */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let sawDelta = false;
  const parseLine = (line: string) => {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      return;
    }
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload) return;
    try {
      const data = JSON.parse(payload) as { text?: string; message?: string };
      if (eventName === "error") throw new Error(data.message ?? "The assistant is temporarily unavailable.");
      if (eventName === "delta" && data.text) {
        sawDelta = true;
        handlers.onDelta(data.text);
      }
    } catch (e) {
      if (e instanceof Error && e.message && !e.message.includes("JSON")) throw e;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      parseLine(line);
    }
  }
  if (!sawDelta) throw new Error("Sorry, I got an empty response — please try again.");
}

export function SupportChat() {
  const [open, setOpen] = useState(false);
  // `msgs` is the display transcript (starts with the greeting);
  // `history` is the real conversation sent to the API (greeting excluded).
  const [msgs, setMsgs] = useState<Msg[]>([GREETING]);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, sending, open]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setInput("");

    const userMsg: Msg = { role: "user", content };
    const nextHistory = [...history, { role: "user" as const, content }];
    setMsgs((m) => [...m, userMsg]);
    setHistory(nextHistory);
    setSending(true);
    setStreaming(true);

    // Placeholder bubble that fills up as tokens stream in
    const replyIndex = msgs.length + 1; // greeting + user msg + existing
    setMsgs((m) => [...m, { role: "assistant", content: "" }]);

    let accumulated = "";
    try {
      await streamChat(nextHistory, {
        onDelta: (t) => {
          accumulated += t;
          setMsgs((m) => {
            const copy = [...m];
            const target = copy[replyIndex];
            if (target && target.role === "assistant") copy[replyIndex] = { ...target, content: accumulated };
            return copy;
          });
        },
      });
      const reply = accumulated.trim() || "Sorry, I got an empty response — please try again.";
      setMsgs((m) => {
        const copy = [...m];
        copy[replyIndex] = { role: "assistant", content: reply };
        return copy;
      });
      setHistory((h) => [...h, { role: "assistant", content: reply }]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong. Please try again.";
      setMsgs((m) => {
        const copy = [...m];
        const target = copy[replyIndex];
        if (target && target.role === "assistant" && target.content) {
          // partial answer arrived before the failure — keep it and annotate
          copy[replyIndex] = { role: "assistant", content: `${target.content}\n\n— ${message}`, error: true };
        } else {
          copy[replyIndex] = { role: "assistant", content: message, error: true };
        }
        return copy;
      });
      if (accumulated.trim()) {
        setHistory((h) => [...h, { role: "assistant", content: accumulated.trim() }]);
      }
    } finally {
      setSending(false);
      setStreaming(false);
    }
  }

  function reset() {
    setMsgs([GREETING]);
    setHistory([]);
  }

  return (
    <div
      className="fixed z-50 flex flex-col items-start gap-3"
      style={{
        left: "1rem",
        bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      {open && (
        <div
          role="dialog"
          aria-label="ShortsPilot AI assistant"
          className="flex h-[min(70vh,520px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center gap-3 bg-gradient-to-r from-rose-500 to-violet-600 px-4 py-3 text-white">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
              <Bot className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">ShortsPilot Assistant</p>
              <p className="flex items-center gap-1.5 text-xs text-white/80">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
                Online — instant answers
              </p>
            </div>
            {history.length > 0 && (
              <button
                type="button"
                onClick={reset}
                aria-label="New conversation"
                title="New conversation"
                className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              >
                <Send className="h-4 w-4 -rotate-45" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-full p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {msgs.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "ml-auto rounded-br-md bg-primary text-primary-foreground"
                    : m.error
                      ? "mr-auto rounded-bl-md border border-destructive/40 bg-destructive/10 text-destructive"
                      : "mr-auto rounded-bl-md bg-accent text-accent-foreground"
                )}
              >
                {m.content}
                {i === msgs.length - 1 && m.role === "assistant" && streaming && m.content === "" && (
                  <span className="inline-flex gap-1 py-1">
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                        style={{ animationDelay: `${d * 0.15}s` }}
                      />
                    ))}
                  </span>
                )}
                {i === msgs.length - 1 && m.role === "assistant" && streaming && m.content !== "" && (
                  <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-primary align-middle" />
                )}
              </div>
            ))}
            {history.length === 0 && !sending && (
              <div className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-border/60 bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <form
            className="flex items-center gap-2 border-t border-border/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about setup, plans, YouTube…"
              aria-label="Message the ShortsPilot assistant"
              maxLength={2000}
              className="h-11 flex-1 rounded-lg border border-border/60 bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-rose-500 to-violet-600 text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      {/* Floating action button — bottom-left */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close ShortsPilot assistant" : "Open ShortsPilot assistant"}
        aria-expanded={open}
        className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-violet-600 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        {!open && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-background bg-emerald-400" />
          </span>
        )}
      </button>
    </div>
  );
}
