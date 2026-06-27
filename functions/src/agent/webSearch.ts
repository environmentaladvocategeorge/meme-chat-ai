import { logger } from "firebase-functions";
import type { ModelUsage } from "../billing/ledger";
import { TAVILY_SEARCH_USD } from "../billing/models";
import { tavilySearch } from "../web/tavilyClient";
import { routeWebSearch } from "./decideWebSearch";

// One-call combiner used by both stream orchestrators (streamAgentAnswer +
// streamReplayTurn): run the nano web-search router and, when it says a turn
// needs live data, perform the Tavily search and build the injectable context
// block. Designed to be kicked off concurrently with the media decider so it
// hides under that latency. Never throws.

export type GatheredWebContext = {
  // The system-message block to inject before the current turn, or null when no
  // search ran or it returned nothing.
  webContext: string | null;
  // The nano router's token usage (billed alongside the reply). Null when the
  // router was skipped entirely (no message / no Tavily key).
  routerUsage: ModelUsage | null;
  // Flat USD cost of the Tavily call when one ran; 0 otherwise.
  searchCostUsd: number;
  // Whether a Tavily search actually executed (telemetry / tests).
  searched: boolean;
};

const SKIPPED: GatheredWebContext = {
  webContext: null,
  routerUsage: null,
  searchCostUsd: 0,
  searched: false,
};

// Wraps the formatted Tavily snippets in an instruction so the reply model uses
// the facts in its own voice instead of dumping links or breaking character.
function buildWebContextNote(contextText: string, todayIso: string): string {
  return (
    `[Live web context — fetched just now for THIS turn (today is ${todayIso}). ` +
    `Use these facts to answer accurately, but weave them into your normal voice: ` +
    `do NOT paste links, list sources, or say "according to my search/the web". ` +
    `If the facts don't actually cover what the user asked, just answer normally.]\n` +
    contextText
  );
}

export async function gatherWebContext(args: {
  openaiApiKey: string;
  // Tavily key. Empty/absent → web search is fully disabled (safe rollout) and
  // this no-ops, so every turn behaves exactly as before the feature.
  tavilyApiKey: string;
  // The user's current message text. Empty (attachment-only turn) → skip.
  message: string;
  // Short recent transcript for reference resolution (e.g. "who won the thing").
  history?: string;
  signal?: AbortSignal;
}): Promise<GatheredWebContext> {
  const message = args.message.trim();
  if (message.length === 0 || args.tavilyApiKey.length === 0) {
    return SKIPPED;
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const startedAt = Date.now();

  const { decision, usage } = await routeWebSearch({
    apiKey: args.openaiApiKey,
    message,
    history: args.history,
    todayIso,
    signal: args.signal,
  });

  if (!decision.search) {
    return { webContext: null, routerUsage: usage, searchCostUsd: 0, searched: false };
  }

  const result = await tavilySearch({
    apiKey: args.tavilyApiKey,
    query: decision.query,
    signal: args.signal,
  });

  logger.info("[gatherWebContext] searched", {
    searched: result !== null,
    query: decision.query,
    latencyMs: Date.now() - startedAt,
  });

  if (!result) {
    // The router wanted a search but Tavily failed / returned nothing. We still
    // bill the flat search cost only when a result came back, so charge 0 here.
    return { webContext: null, routerUsage: usage, searchCostUsd: 0, searched: false };
  }

  return {
    webContext: buildWebContextNote(result.contextText, todayIso),
    routerUsage: usage,
    searchCostUsd: TAVILY_SEARCH_USD,
    searched: true,
  };
}
