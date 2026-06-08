import { countTokens } from "../../context/tokens";
import { MEMORY_MAX_TOKENS, type MemoryFact } from "./types";

// Header prefixed to the compiled block. Counts toward the 500-token budget so
// the injected string as a whole can never exceed the cap.
export const MEMORY_BLOCK_HEADER =
  "WHAT YOU KNOW ABOUT THIS USER (from past chats — weave it in naturally when it fits; never recite it as a list or say you have notes on them):";

export type CompiledMemory = {
  block: string;
  includedIds: string[];
  tokens: number;
};

// Most-useful-first: higher salience, then more recently updated.
function rankFacts(facts: MemoryFact[]): MemoryFact[] {
  return facts
    .slice()
    .sort((a, b) => b.salience - a.salience || b.updatedAt - a.updatedAt);
}

// Pure compile: renders the highest-ranked facts into ONE block guaranteed to be
// <= MEMORY_MAX_TOKENS. Greedily adds facts in rank order and stops before the
// cap would be exceeded (lower-ranked facts are simply dropped from the block —
// they remain stored and can surface later if higher-ranked ones are removed).
// Returns an empty block when there are no usable facts.
export function compileMemoryBlock(facts: MemoryFact[]): CompiledMemory {
  const ranked = rankFacts(facts);
  const lines: string[] = [];
  const includedIds: string[] = [];

  for (const f of ranked) {
    const text = f.text.trim();
    if (!text) continue;
    const candidate = `${MEMORY_BLOCK_HEADER}\n${[...lines, `- ${text}`].join("\n")}`;
    if (countTokens(candidate) > MEMORY_MAX_TOKENS) break;
    lines.push(`- ${text}`);
    includedIds.push(f.id);
  }

  if (lines.length === 0) return { block: "", includedIds: [], tokens: 0 };

  const block = `${MEMORY_BLOCK_HEADER}\n${lines.join("\n")}`;
  return { block, includedIds, tokens: countTokens(block) };
}
