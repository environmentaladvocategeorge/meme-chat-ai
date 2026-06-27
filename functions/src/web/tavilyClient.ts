import { logger } from "firebase-functions";

// Thin client for Tavily's /search endpoint (https://tavily.com). Tavily is an
// LLM-oriented search API: one call returns a synthesized `answer` plus ranked
// source snippets, so we can inject the result straight into the reply model's
// context with minimal formatting. Wrapped to NEVER throw — any failure (network,
// non-2xx, bad JSON, empty result) resolves to null so the turn still produces a
// normal, search-free reply (mirrors the decideMedia/getGif never-throw contract).

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

// Keep the injected block small so the responder's input stays cheap: cap how
// many sources we fold in and how long each snippet may be, plus a hard ceiling
// on the whole block.
const MAX_SOURCES = 4;
const MAX_SNIPPET_CHARS = 280;
const MAX_CONTEXT_CHARS = 1500;

type TavilyResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
};

type TavilyResponse = {
  answer?: unknown;
  results?: unknown;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

// Formats Tavily's answer + top results into a compact, injectable block. Returns
// null when there's nothing usable (no answer and no results) so the caller skips
// injection entirely.
export function formatTavilyContext(body: TavilyResponse): string | null {
  const answer = asString(body.answer).trim();
  const rawResults = Array.isArray(body.results) ? body.results : [];

  const lines: string[] = [];
  if (answer) lines.push(`Answer: ${answer}`);

  const sourceLines: string[] = [];
  for (const r of rawResults.slice(0, MAX_SOURCES) as TavilyResult[]) {
    const title = asString(r.title).trim();
    const url = asString(r.url).trim();
    const snippet = truncate(asString(r.content), MAX_SNIPPET_CHARS);
    if (!title && !snippet) continue;
    const head = title || url || "source";
    sourceLines.push(`- ${head}: ${snippet}${url ? ` (${url})` : ""}`);
  }
  if (sourceLines.length > 0) {
    lines.push("Sources:");
    lines.push(...sourceLines);
  }

  if (lines.length === 0) return null;
  return truncate(lines.join("\n"), MAX_CONTEXT_CHARS);
}

// Runs ONE Tavily search and returns the formatted context block, or null on any
// failure / empty result. `search_depth: "basic"` is the cheaper, faster tier —
// enough for the "grab a few live facts" use case here.
export async function tavilySearch(args: {
  apiKey: string;
  query: string;
  signal?: AbortSignal;
}): Promise<{ contextText: string } | null> {
  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        query: args.query,
        search_depth: "basic",
        include_answer: true,
        max_results: 5,
      }),
      signal: args.signal,
    });

    if (!response.ok) {
      logger.warn("[tavilySearch] non-2xx response", { status: response.status });
      return null;
    }

    const body = (await response.json()) as TavilyResponse;
    const contextText = formatTavilyContext(body);
    if (!contextText) return null;
    return { contextText };
  } catch (err) {
    logger.warn("[tavilySearch] failed; no web context", { err });
    return null;
  }
}
