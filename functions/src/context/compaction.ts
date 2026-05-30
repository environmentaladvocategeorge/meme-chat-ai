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
//     re-summarize (every SUMMARIZE_BATCH_MESSAGES turns), so the
//     [persona][summary] prefix stays cacheable between compactions. Modern
//     providers price cached input tokens at a large discount, so a stable
//     prefix matters as much as a small one.
//
// The summarizer runs as a background trigger (cost absorbed by us, on the
// cheap utility model), decoupled from request assembly. The constants below
// are coupled by one invariant — see RECENT_WINDOW.

// Don't compact at all until a conversation is genuinely long. Short threads
// fit verbatim and a summary would only add noise + a wasted LLM call.
export const MESSAGES_BEFORE_SUMMARIZE = 12;

// Newest complete messages the summarizer always leaves OUT of the summary, so
// recent turns stay verbatim (full fidelity is what users feel as "it
// remembers what I just said"). The summary covers everything older.
export const SUMMARY_KEEP_RECENT = 6;

// Batch the (background, but still billable-to-us) summary LLM call: only fold
// newly-aged-out turns in once enough of them have accumulated, by count OR by
// tokens. A long paste that ages out trips the token bar on its own; many short
// turns trip the count bar. Batching keeps the summary prefix stable longer
// (better cache hits) and cuts utility-model spend.
export const SUMMARIZE_BATCH_MESSAGES = 4;
export const SUMMARIZE_BATCH_TOKENS = 1500;

// Verbatim window assembly keeps after the summary cutoff. INVARIANT:
//   RECENT_WINDOW >= SUMMARY_KEEP_RECENT + SUMMARIZE_BATCH_MESSAGES
// The background summarizer lets the un-summarized tail grow up to
// SUMMARY_KEEP_RECENT + SUMMARIZE_BATCH_MESSAGES before it folds the oldest of
// them into the summary. Assembly must keep at least that many recent messages
// verbatim, otherwise a turn that has aged past the cutoff but hasn't been
// summarized yet would be dropped by the window slice AND absent from the
// summary — i.e. lost. 12 >= 6 + 4 holds with headroom for the in-flight
// streaming placeholder.
export const RECENT_WINDOW = 12;

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
export function planCompaction(input: {
  messageIds: string[]; // complete messages, oldest → newest
  messageTokens: number[]; // per-message token counts, parallel to messageIds
  lastSummarizedId: string | null;
}): CompactionPlan {
  const total = input.messageIds.length;
  if (total <= MESSAGES_BEFORE_SUMMARIZE) return { summarize: false };

  // Newest message we're allowed to fold in: everything after it is the
  // verbatim tail we deliberately leave alone.
  const boundaryIdx = total - 1 - SUMMARY_KEEP_RECENT;
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
