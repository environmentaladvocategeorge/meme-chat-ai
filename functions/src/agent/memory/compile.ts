import { countTokens } from "../../context/tokens";
import {
  MEMORY_MAX_TOKENS,
  type MemoryCategory,
  type MemoryFact,
} from "./types";

// Header prefixed to the REPLY model's compiled block. Counts toward the budget
// so the injected string as a whole can never exceed the cap.
export const MEMORY_BLOCK_HEADER =
  "WHAT YOU KNOW ABOUT THIS USER (from past chats — weave it in naturally when it fits; never recite it as a list or say you have notes on them):";

// Preface for the MEDIA-DECIDER view. The decider emits JSON and picks ONE
// reaction image — the reply framing ("weave it in naturally / never recite as a
// list") is meaningless to it. This tells it to use the user's durable taste to
// pick a MORE on-point reaction, never to attach one it otherwise wouldn't.
export const MEDIA_MEMORY_HEADER =
  "WHAT THIS USER IS INTO (durable taste from past chats). Use this ONLY to sharpen a pick you're already making — never attach because of it, never force a reference that doesn't fit this message.";

// A tighter budget for the media view than the reply view: it's a light nudge
// for a small model, not the full memory dump.
export const MEDIA_MEMORY_MAX_TOKENS = 200;

export type CompiledMemory = {
  block: string;
  includedIds: string[];
  tokens: number;
};

// One rendered view's recipe: which categories to include (all when omitted),
// the token ceiling, and the header/preface for this consumer. Stored facts are
// the single source of truth; each consumer renders its own view from them.
export type MemoryViewConfig = {
  header: string;
  maxTokens: number;
  // When set, only facts in these categories are eligible. Omitted = all.
  categories?: readonly MemoryCategory[];
};

// The reply model's view: every category, the full budget, reply framing.
// Behaviorally identical to the legacy single-compile (see compileMemoryBlock).
export const REPLY_MEMORY_VIEW: MemoryViewConfig = {
  header: MEMORY_BLOCK_HEADER,
  maxTokens: MEMORY_MAX_TOKENS,
};

// The media decider's view: only the taste-bearing categories that make a
// reaction more personal, a tighter budget, and the decider preface. `ongoing`
// and `relationship` are excluded — they rarely sharpen a reaction-image pick.
export const MEDIA_MEMORY_VIEW: MemoryViewConfig = {
  header: MEDIA_MEMORY_HEADER,
  maxTokens: MEDIA_MEMORY_MAX_TOKENS,
  categories: ["preference", "lore", "identity"],
};

// Everything render needs from a fact. Both the full MemoryFact and the
// denormalized MemoryFactLite (stored on the hot-path doc) satisfy this, so a
// view can be rendered straight off a cheap single read with no conversion.
export type RenderableFact = Pick<
  MemoryFact,
  "id" | "text" | "category" | "salience" | "updatedAt"
>;

// Most-useful-first: higher salience, then more recently updated.
function rankFacts(facts: ReadonlyArray<RenderableFact>): RenderableFact[] {
  return facts
    .slice()
    .sort((a, b) => b.salience - a.salience || b.updatedAt - a.updatedAt);
}

// Pure render: scope to the view's categories (all when unset), rank
// most-useful-first, greedily add facts until the next would exceed the view's
// token cap, and prefix the view's header. Returns an empty block when nothing
// qualifies. Deterministic; no clock, no I/O.
export function renderMemoryView(
  facts: ReadonlyArray<RenderableFact>,
  config: MemoryViewConfig,
): CompiledMemory {
  const scoped = config.categories
    ? facts.filter((f) => config.categories!.includes(f.category))
    : facts;
  const ranked = rankFacts(scoped);
  const lines: string[] = [];
  const includedIds: string[] = [];

  for (const f of ranked) {
    const text = f.text.trim();
    if (!text) continue;
    const candidate = `${config.header}\n${[...lines, `- ${text}`].join("\n")}`;
    if (countTokens(candidate) > config.maxTokens) break;
    lines.push(`- ${text}`);
    includedIds.push(f.id);
  }

  if (lines.length === 0) return { block: "", includedIds: [], tokens: 0 };

  const block = `${config.header}\n${lines.join("\n")}`;
  return { block, includedIds, tokens: countTokens(block) };
}

// Back-compat wrapper = the REPLY view. Kept so the cold-path persist (which
// stores the reply block as a fallback) and existing callers are unchanged, and
// it produces byte-identical output to before.
export function compileMemoryBlock(facts: MemoryFact[]): CompiledMemory {
  return renderMemoryView(facts, REPLY_MEMORY_VIEW);
}
