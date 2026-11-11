import { chatJson } from "./llm";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  host_name: string;
  date: string;
};

/**
 * DuckDuckGo HTML fallback — free web search, no API key required.
 * Parses the lightweight HTML results page. Best-effort: returns [] on any failure.
 */
async function duckduckgoSearch(query: string, num: number): Promise<SearchResult[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: `q=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const links: { href: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < num * 2) links.push({ href: m[1], title: strip(m[2]) });
  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) && snippets.length < num * 2) snippets.push(strip(m[1]));
  for (let i = 0; i < links.length && results.length < num; i++) {
    let href = links[i].href;
    const uddg = href.match(/uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = `https:${href}`;
    if (!/^https?:\/\//.test(href)) continue;
    let host = "unknown";
    try { host = new URL(href).hostname.replace(/^www\./, ""); } catch { continue; }
    results.push({
      title: links[i].title || host,
      url: href,
      snippet: snippets[i] ?? "",
      host_name: host,
      date: "",
    });
  }
  return results;
}

/**
 * Google News RSS fallback — free, reliable, no key, no bot-check.
 * Real news coverage for almost any query; perfect grounding for trend-aware ideas.
 */
async function googleNewsSearch(query: string, num: number): Promise<SearchResult[]> {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    `&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Google News ${res.status}`);
  const xml = await res.text();
  const strip = (s: string) =>
    s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  const results: SearchResult[] = [];
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) && results.length < num) {
    const block = m[1];
    const get = (tag: string) => {
      const mm = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return mm ? mm[1] : "";
    };
    const title = strip(get("title"));
    let link = strip(get("link"));
    if (!title || !link) continue;
    if (link.startsWith("//")) link = `https:${link}`;
    let host = "news.google.com";
    try { host = new URL(link).hostname.replace(/^www\./, ""); } catch { /* keep default */ }
    results.push({
      title,
      url: link,
      snippet: strip(get("description")).slice(0, 300),
      host_name: host,
      date: strip(get("pubDate")).slice(0, 40),
    });
  }
  return results;
}

/** Web search: z-ai SDK first, then free fallbacks — DuckDuckGo, Google News RSS. */
export async function webSearch(query: string, num = 5): Promise<SearchResult[]> {
  // Provider 1: z-ai SDK
  try {
    const { getZAI } = await import("./llm");
    const zai = await getZAI();
    const res = (await zai.functions.invoke("web_search", { query, num })) as unknown as SearchResult[];
    if (!Array.isArray(res)) return [];
    return res.slice(0, num);
  } catch (e) {
    console.error(
      `[search] z-ai unavailable (${e instanceof Error ? e.message.slice(0, 100) : e}) — using free fallbacks`
    );
  }
  // Provider 2: DuckDuckGo (works from residential IPs; datacenter IPs may be challenged)
  try {
    const results = await duckduckgoSearch(query, num);
    if (results.length > 0) return results;
  } catch (e) {
    console.error("[search] duckduckgo failed:", e instanceof Error ? e.message : e);
  }
  // Provider 3: Google News RSS (reliable from any IP)
  try {
    const results = await googleNewsSearch(query, num);
    if (results.length > 0) return results;
  } catch (e) {
    console.error("[search] google news failed:", e instanceof Error ? e.message : e);
  }
  return [];
}

/** Summarize research into compact factual notes with source tracking. */
export async function researchTopic(topic: string) {
  const results = await webSearch(topic, 5);
  const sources = results.map((r) => ({
    title: r.title,
    url: r.url,
    host: r.host_name,
    date: r.date,
  }));
  let notes = "";
  if (results.length > 0) {
    const { chat } = await import("./llm");
    const context = results
      .map((r, i) => `[${i + 1}] ${r.title} (${r.host_name}): ${r.snippet}`)
      .join("\n");
    notes = await chat(
      [
        {
          role: "assistant",
          content:
            "You are a meticulous research assistant. Summarize only facts present in the provided sources. Never invent statistics, quotes, or events. Output 3-5 concise bullet points. Flag any conflicting or uncertain claims with [UNVERIFIED].",
        },
        {
          role: "user",
          content: `Topic: ${topic}\n\nSources:\n${context}`,
        },
      ],
      { retries: 2 }
    );
  }
  return { sources, notes };
}
