// Shared knobs + pure planning for conversation history compaction.
//
// Strategy (the 2026 "summary buffer" pattern: a rolling summary of old turns
// plus a verbatim window of recent turns):
//   prompt = [ stable system/persona ] + [ summary of OLD turns ] + [ last N turns verbatim ] + [ current turn ]
//
// Why this shape:
//   - No context loss: every complete message is EITHER inside the verbatim
//     window OR folded into the running summary — never silently dropped.
//   - Token + cost savings across a long thread: old turns collapse from full
//     text into a single short summary, and we re-summarize RECURSIVELY (fold
//     only the newly-aged-out turns into the prior summary) instead of
//     re-reading the whole transcript every time.
//   - Prompt-cache friendly: the big static persona prompt stays first and
//     byte-identical across turns, and the summary only changes when we
//     re-summarize, so the [persona][summary] prefix stays cacheable between
//     compactions. Modern providers price cached input tokens at a large
//     discount, so a stable prefix matters as much as a small one.
//
// SIZING IS PLAN-AWARE. The verbatim window is sized from the plan's input-token
// budget rather than a flat message count, so higher tiers (which buy a much
// larger maxInputTokens) keep far more turns at full fidelity before anything is
// folded into a summary. A flat count made paid plans summarize as eagerly as
// free even though they had budget to spare — that's the bug this fixes.
//
// The summarizer runs as a background trigger (cost absorbed by us, on the cheap
// utility model), decoupled from request assembly.

// Fixed, non-history overhead that lives in every prompt: the (large) static
// persona/platform prompt, the second system message (alias + language), the
// running summary, the current user turn, and per-message chat overhead. This
// is the part of maxInputTokens that is NOT available for verbatim history, so
// the verbatim window must be sized against what's LEFT after it — sizing
// against gross maxInputTokens is wrong because the persona prompt alone is ~4k
// and would swallow a free plan's entire budget.
//
// TUNING: the persona/platform prompt is the dominant term (~4k tokens, served
// from Firestore). Bias this slightly HIGH — overestimating only makes the
// window a touch conservative, while underestimating lets the summarizer keep
// more than assembly can fit and forces truncation. After deploy, read a
// cold-turn's `inputTokens` from the charge logs (≈ persona + current) to dial
// this in precisely.
export const PROMPT_OVERHEAD_TOKENS = 4800;

// Fraction of the REMAINING headroom (maxInputTokens − PROMPT_OVERHEAD_TOKENS)
// the verbatim tail may fill before older turns fold into the summary. < 1 so a
// tokenizer-estimate drift between our count and OpenAI's doesn't push the
// assembled prompt over the model's input budget.
export const VERBATIM_BUDGET_FRACTION = 0.85;

// Verbatim-tail token allowance for a given plan input budget. This is the knob
// that makes compaction plan-aware: it's the headroom left after the fixed
// prompt overhead, so free (small headroom) keeps a short tail and power (large
// headroom) keeps a long one. Floors at 0 for any plan whose budget barely
// clears the overhead.
export function verbatimBudgetTokens(maxInputTokens: number): number {
  const headroom = maxInputTokens - PROMPT_OVERHEAD_TOKENS;
  if (headroom <= 0) return 0;
  return Math.round(headroom * VERBATIM_BUDGET_FRACTION);
}

// Hard guardrail on how many recent messages stay verbatim regardless of the
// token budget, so a flood of tiny turns can't balloon Firestore reads or the
// prompt. In normal use the token budget gates first; this only bites on
// pathologically short turns. Uniform across plans on purpose — it's a safety
// bound, not a tier feature (the token budget is what scales per plan).
export const MAX_VERBATIM_MESSAGES = 80;

// Batch the (background, but still billable-to-us) summary LLM call: only fold
// newly-aged-out turns in once enough of them have accumulated, by count OR by
// tokens. A long paste that ages out trips the token bar on its own; many short
// turns trip the count bar. Batching keeps the summary prefix stable longer
// (better cache hits) and cuts utility-model spend.
export const SUMMARIZE_BATCH_MESSAGES = 4;
export const SUMMARIZE_BATCH_TOKENS = 1500;

// How many recent message docs assembly loads from Firestore. INVARIANT:
//   RECENT_LOAD_LIMIT >= MAX_VERBATIM_MESSAGES + SUMMARIZE_BATCH_MESSAGES
// The background summarizer lets the un-summarized tail grow to the verbatim
// allowance (≤ MAX_VERBATIM_MESSAGES) plus one batch before it folds the oldest
// in. Assembly must load at least that many messages, otherwise a turn that has
// aged past the verbatim allowance but hasn't been summarized yet would be
// absent from the loaded window AND from the summary — i.e. lost. The extra
// buffer covers filtered docs (streaming/errored/empty/replay-excluded).
export const RECENT_LOAD_LIMIT =
  MAX_VERBATIM_MESSAGES + SUMMARIZE_BATCH_MESSAGES + 8;

export type CompactionPlan =
  | { summarize: false }
  | {
      summarize: true;
      // Doc id of the newest message folded into the summary this run. Stored as
      // the conversation's summaryUpToMessageId; assembly drops everything up to
      // and including it from the verbatim window.
      boundaryId: string;
      // Inclusive index range (into the supplied complete-message arrays) of the
      // turns to fold in this run — i.e. those that have aged out since the last
      // summary. The caller summarizes only these, on top of the prior summary.
      fromIndex: number;
      toIndex: number;
    };

// Pure: decides whether to (re)summarize and which aged-out turns to fold in.
// Operates on COMPLETE messages only (oldest → newest); the caller is
// responsible for filtering out streaming/errored docs first so the boundary
// can never land on a message whose id or text is still changing.
//
// The verbatim tail is the newest run of messages that fits within BOTH the
// plan's token budget and the message-count guardrail; everything older is
// eligible to fold. We always keep at least the newest message (a single
// oversized turn can't be folded to nothing).
export function planCompaction(input: {
  messageIds: string[]; // complete messages, oldest → newest
  messageTokens: number[]; // per-message token counts, parallel to messageIds
  lastSummarizedId: string | null;
  // Verbatim-tail token allowance for this conversation's plan
  // (see verbatimBudgetTokens).
  verbatimBudgetTokens: number;
  // Count guardrail; defaults to MAX_VERBATIM_MESSAGES.
  maxVerbatimMessages?: number;
}): CompactionPlan {
  const total = input.messageIds.length;
  if (total === 0) return { summarize: false };

  const maxVerbatim = input.maxVerbatimMessages ?? MAX_VERBATIM_MESSAGES;

  // Walk newest → oldest, growing the verbatim tail until adding the next-oldest
  // message would exceed either the token budget or the count guardrail. The
  // newest message is always kept (the `i < total - 1` guard).
  let tailTokens = 0;
  let keepFromIdx = total - 1; // index of the oldest message still in the tail
  for (let i = total - 1; i >= 0; i--) {
    const t = input.messageTokens[i] ?? 0;
    const keptIfAdded = total - i; // tail size including message i
    const exceedsTokens = tailTokens + t > input.verbatimBudgetTokens;
    const exceedsCount = keptIfAdded > maxVerbatim;
    if (i < total - 1 && (exceedsTokens || exceedsCount)) break;
    tailTokens += t;
    keepFromIdx = i;
  }

  // Newest message we're allowed to fold in: everything from keepFromIdx on is
  // the verbatim tail we deliberately leave alone.
  const boundaryIdx = keepFromIdx - 1;
  // Whole thread fits within the verbatim tail — nothing has aged out yet.
  if (boundaryIdx < 0) return { summarize: false };

  const lastIdx = input.lastSummarizedId
    ? input.messageIds.indexOf(input.lastSummarizedId)
    : -1;
  const fromIndex = lastIdx + 1;
  // Already summarized up to (or past) the boundary — nothing new has aged out.
  if (fromIndex > boundaryIdx) return { summarize: false };

  const absorbCount = boundaryIdx - fromIndex + 1;
  let absorbTokens = 0;
  for (let i = fromIndex; i <= boundaryIdx; i++) {
    absorbTokens += input.messageTokens[i] ?? 0;
  }

  if (
    absorbCount < SUMMARIZE_BATCH_MESSAGES &&
    absorbTokens < SUMMARIZE_BATCH_TOKENS
  ) {
    return { summarize: false };
  }

  return {
    summarize: true,
    boundaryId: input.messageIds[boundaryIdx],
    fromIndex,
    toIndex: boundaryIdx,
  };
}
