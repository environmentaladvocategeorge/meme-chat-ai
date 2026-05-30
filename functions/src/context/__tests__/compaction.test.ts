import {
  MESSAGES_BEFORE_SUMMARIZE,
  RECENT_WINDOW,
  SUMMARIZE_BATCH_MESSAGES,
  SUMMARIZE_BATCH_TOKENS,
  SUMMARY_KEEP_RECENT,
  planCompaction,
} from "../compaction";

// Builds n message ids "m0".."m(n-1)" with a flat per-message token count.
function mk(n: number, tokensEach = 10) {
  return {
    messageIds: Array.from({ length: n }, (_, i) => `m${i}`),
    messageTokens: Array.from({ length: n }, () => tokensEach),
  };
}

describe("compaction invariant", () => {
  it("recent window covers the worst-case un-summarized tail (no message can be lost)", () => {
    // The background summarizer lets the tail grow to
    // SUMMARY_KEEP_RECENT + SUMMARIZE_BATCH_MESSAGES before folding the oldest
    // in. Assembly's verbatim window must cover that, or an aged-out-but-not-
    // yet-summarized turn would be dropped AND absent from the summary.
    expect(RECENT_WINDOW).toBeGreaterThanOrEqual(
      SUMMARY_KEEP_RECENT + SUMMARIZE_BATCH_MESSAGES,
    );
  });
});

describe("planCompaction", () => {
  it("skips conversations at or under the compaction threshold", () => {
    const plan = planCompaction({
      ...mk(MESSAGES_BEFORE_SUMMARIZE),
      lastSummarizedId: null,
    });
    expect(plan.summarize).toBe(false);
  });

  it("summarizes once the thread is long enough, leaving the recent tail verbatim", () => {
    const total = MESSAGES_BEFORE_SUMMARIZE + 8; // 20 messages
    const plan = planCompaction({ ...mk(total), lastSummarizedId: null });

    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;

    // Boundary leaves exactly SUMMARY_KEEP_RECENT messages after it untouched.
    const boundaryIdx = Number(plan.boundaryId.slice(1));
    expect(total - 1 - boundaryIdx).toBe(SUMMARY_KEEP_RECENT);
    // First run with no prior summary folds in everything from the start.
    expect(plan.fromIndex).toBe(0);
    expect(plan.toIndex).toBe(boundaryIdx);
  });

  it("never folds in the verbatim tail", () => {
    const total = 30;
    const plan = planCompaction({ ...mk(total), lastSummarizedId: null });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    // The last SUMMARY_KEEP_RECENT messages are always past the boundary.
    expect(plan.toIndex).toBeLessThanOrEqual(total - 1 - SUMMARY_KEEP_RECENT);
  });

  it("recursively folds in only the newly-aged-out turns (not the whole thread)", () => {
    // Already summarized up to m10; thread has since grown to 24.
    const total = 24;
    const plan = planCompaction({ ...mk(total), lastSummarizedId: "m10" });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    expect(plan.fromIndex).toBe(11); // strictly after the last summarized id
    expect(plan.toIndex).toBe(total - 1 - SUMMARY_KEEP_RECENT);
  });

  it("skips when too few new turns have aged out since the last summary", () => {
    // Summarized up to m13 in a 20-message thread: only m14..m13' worth aged out,
    // which is under the batch threshold.
    const total = MESSAGES_BEFORE_SUMMARIZE + 5; // 17
    const boundaryIfRun = total - 1 - SUMMARY_KEEP_RECENT; // newest foldable idx
    // Pretend we already summarized right up to the boundary → nothing new.
    const plan = planCompaction({
      ...mk(total),
      lastSummarizedId: `m${boundaryIfRun}`,
    });
    expect(plan.summarize).toBe(false);
  });

  it("does not summarize when fewer than the batch count have aged out", () => {
    // total chosen so only (SUMMARIZE_BATCH_MESSAGES - 1) messages sit before the
    // verbatim tail, with tiny tokens so the token bar isn't tripped either.
    const agedOut = SUMMARIZE_BATCH_MESSAGES - 1;
    const total = SUMMARY_KEEP_RECENT + agedOut;
    if (total <= MESSAGES_BEFORE_SUMMARIZE) {
      // Guard: this case is only meaningful past the length gate.
      const plan = planCompaction({ ...mk(total, 1), lastSummarizedId: null });
      expect(plan.summarize).toBe(false);
      return;
    }
    const plan = planCompaction({ ...mk(total, 1), lastSummarizedId: null });
    expect(plan.summarize).toBe(false);
  });

  it("trips the token bar early when a long turn ages out (count bar not met)", () => {
    // 20 messages, already summarized up to m11. boundary = 20-1-6 = 13, so only
    // m12 + m13 (2 turns, under the count bar) have newly aged out. Make m12 huge
    // so the token bar trips on its own.
    const total = 20;
    const messageTokens = Array.from({ length: total }, () => 1);
    messageTokens[12] = SUMMARIZE_BATCH_TOKENS + 100;
    const plan = planCompaction({
      messageIds: mk(total).messageIds,
      messageTokens,
      lastSummarizedId: "m11",
    });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    expect(plan.toIndex - plan.fromIndex + 1).toBeLessThan(SUMMARIZE_BATCH_MESSAGES);
  });

  it("treats an unknown lastSummarizedId as 'nothing summarized yet'", () => {
    const total = 20;
    const plan = planCompaction({
      ...mk(total),
      lastSummarizedId: "does-not-exist",
    });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    expect(plan.fromIndex).toBe(0);
  });
});
