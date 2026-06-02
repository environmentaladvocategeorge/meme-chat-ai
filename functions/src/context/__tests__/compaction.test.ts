import {
  MAX_VERBATIM_MESSAGES,
  PROMPT_OVERHEAD_TOKENS,
  RECENT_LOAD_LIMIT,
  SUMMARIZE_BATCH_MESSAGES,
  SUMMARIZE_BATCH_TOKENS,
  VERBATIM_BUDGET_FRACTION,
  planCompaction,
  verbatimBudgetTokens,
} from "../compaction";

// Builds n message ids "m0".."m(n-1)" with a flat per-message token count.
function mk(n: number, tokensEach = 10) {
  return {
    messageIds: Array.from({ length: n }, (_, i) => `m${i}`),
    messageTokens: Array.from({ length: n }, () => tokensEach),
  };
}

describe("compaction invariant", () => {
  it("recent load limit covers the worst-case un-summarized tail (no message can be lost)", () => {
    // The background summarizer lets the un-summarized tail grow to the verbatim
    // allowance (≤ MAX_VERBATIM_MESSAGES) plus one batch before folding the
    // oldest in. Assembly's load window must cover that, or an aged-out-but-not-
    // yet-summarized turn would be dropped AND absent from the summary.
    expect(RECENT_LOAD_LIMIT).toBeGreaterThanOrEqual(
      MAX_VERBATIM_MESSAGES + SUMMARIZE_BATCH_MESSAGES,
    );
  });
});

describe("verbatimBudgetTokens", () => {
  it("is sized off the headroom left after the fixed prompt overhead", () => {
    const max = PROMPT_OVERHEAD_TOKENS + 10_000;
    expect(verbatimBudgetTokens(max)).toBe(Math.round(10_000 * VERBATIM_BUDGET_FRACTION));
  });

  it("scales up with the plan's input budget", () => {
    expect(verbatimBudgetTokens(32_000)).toBeGreaterThan(verbatimBudgetTokens(16_000));
    expect(verbatimBudgetTokens(16_000)).toBeGreaterThan(verbatimBudgetTokens(8_000));
  });

  it("floors at 0 when the budget barely clears the prompt overhead", () => {
    expect(verbatimBudgetTokens(PROMPT_OVERHEAD_TOKENS)).toBe(0);
    expect(verbatimBudgetTokens(PROMPT_OVERHEAD_TOKENS - 1000)).toBe(0);
  });
});

describe("planCompaction", () => {
  it("skips while the whole thread fits within the verbatim token budget", () => {
    // 20 messages * 10 tokens = 200 tokens, well under a 1000-token budget.
    const plan = planCompaction({
      ...mk(20),
      lastSummarizedId: null,
      verbatimBudgetTokens: 1000,
    });
    expect(plan.summarize).toBe(false);
  });

  it("summarizes once the tail exceeds the token budget, leaving recent turns verbatim", () => {
    // 30 messages * 10 tokens = 300; a 100-token budget keeps the newest 10.
    const budget = 100;
    const tokensEach = 10;
    const total = 30;
    const plan = planCompaction({
      ...mk(total, tokensEach),
      lastSummarizedId: null,
      verbatimBudgetTokens: budget,
    });

    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;

    // Verbatim tail left after the boundary == budget / per-message tokens.
    const keptVerbatim = total - 1 - Number(plan.boundaryId.slice(1));
    expect(keptVerbatim).toBe(budget / tokensEach);
    // First run with no prior summary folds in everything from the start.
    expect(plan.fromIndex).toBe(0);
    expect(plan.toIndex).toBe(total - 1 - keptVerbatim);
  });

  it("a larger plan budget keeps more verbatim and summarizes later", () => {
    const args = { ...mk(30, 10), lastSummarizedId: null };
    // Small budget (free-like): summarizes. Large budget (power-like): the whole
    // thread still fits, so nothing folds.
    expect(planCompaction({ ...args, verbatimBudgetTokens: 100 }).summarize).toBe(true);
    expect(planCompaction({ ...args, verbatimBudgetTokens: 5000 }).summarize).toBe(false);
  });

  it("never folds in the verbatim tail", () => {
    const total = 40;
    const plan = planCompaction({
      ...mk(total, 10),
      lastSummarizedId: null,
      verbatimBudgetTokens: 100,
    });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    // 100-token budget at 10 tokens each keeps the newest 10 untouched.
    expect(plan.toIndex).toBeLessThanOrEqual(total - 1 - 10);
  });

  it("recursively folds in only the newly-aged-out turns (not the whole thread)", () => {
    const total = 30;
    const plan = planCompaction({
      ...mk(total, 10),
      lastSummarizedId: "m10",
      verbatimBudgetTokens: 100, // keeps newest 10 → boundary at idx 19
    });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    expect(plan.fromIndex).toBe(11); // strictly after the last summarized id
    expect(plan.toIndex).toBe(total - 1 - 10);
  });

  it("skips when too few new turns have aged out since the last summary", () => {
    // Budget keeps newest 6; boundary at idx 13 in a 20-message thread. Pretend
    // we already summarized up to m12 → only m13 (1 turn) newly aged out, under
    // both batch bars.
    const plan = planCompaction({
      ...mk(20, 10),
      lastSummarizedId: "m12",
      verbatimBudgetTokens: 60,
    });
    expect(plan.summarize).toBe(false);
  });

  it("does not summarize when fewer than the batch count have aged out", () => {
    // Budget keeps newest 6; total 8 leaves only 2 foldable (< batch count), and
    // with tiny tokens the token bar isn't tripped either.
    const total = SUMMARIZE_BATCH_MESSAGES - 1 + 6; // 9
    const plan = planCompaction({
      ...mk(total, 1),
      lastSummarizedId: null,
      verbatimBudgetTokens: 6,
    });
    expect(plan.summarize).toBe(false);
  });

  it("trips the token bar early when a long turn ages out (count bar not met)", () => {
    // 20 messages, budget keeps the newest 6 (idx 14..19) → boundary 13.
    // Already summarized up to m11, so only m12 + m13 (2 turns, under the count
    // bar) newly aged out. Make m12 huge so the token bar trips on its own.
    const total = 20;
    const messageTokens = Array.from({ length: total }, () => 1);
    messageTokens[12] = SUMMARIZE_BATCH_TOKENS + 100;
    const plan = planCompaction({
      messageIds: mk(total).messageIds,
      messageTokens,
      lastSummarizedId: "m11",
      verbatimBudgetTokens: 6,
    });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    expect(plan.toIndex - plan.fromIndex + 1).toBeLessThan(SUMMARIZE_BATCH_MESSAGES);
  });

  it("always keeps at least the newest message verbatim, even if it alone blows the budget", () => {
    // Newest message is enormous; everything else tiny. Tail can't shrink below
    // the single newest turn.
    const total = 10;
    const messageTokens = Array.from({ length: total }, () => 1);
    messageTokens[total - 1] = 9999;
    const plan = planCompaction({
      messageIds: mk(total).messageIds,
      messageTokens,
      lastSummarizedId: null,
      verbatimBudgetTokens: 5,
    });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    // Exactly the newest message is left verbatim (boundary is the one before it).
    expect(plan.boundaryId).toBe(`m${total - 2}`);
  });

  it("respects the message-count guardrail for a flood of tiny turns", () => {
    // Far more tiny messages than MAX_VERBATIM_MESSAGES, all of which fit the
    // token budget — the count guardrail must still force a fold.
    const total = MAX_VERBATIM_MESSAGES + 30;
    const plan = planCompaction({
      ...mk(total, 1),
      lastSummarizedId: null,
      verbatimBudgetTokens: 1_000_000, // effectively unlimited tokens
      maxVerbatimMessages: MAX_VERBATIM_MESSAGES,
    });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    // Verbatim tail capped at the guardrail.
    const keptVerbatim = total - 1 - Number(plan.boundaryId.slice(1));
    expect(keptVerbatim).toBe(MAX_VERBATIM_MESSAGES);
  });

  it("treats an unknown lastSummarizedId as 'nothing summarized yet'", () => {
    const plan = planCompaction({
      ...mk(30, 10),
      lastSummarizedId: "does-not-exist",
      verbatimBudgetTokens: 100,
    });
    expect(plan.summarize).toBe(true);
    if (!plan.summarize) return;
    expect(plan.fromIndex).toBe(0);
  });
});
