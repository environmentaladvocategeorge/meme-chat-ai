import { MODEL_PRICING, type ModelId } from "./models";

// 1 internal credit = USD 0.001 of real AI cost. Credits are charged on the
// full OpenAI usage — input (system prompt + assembled context + the user's
// message) plus output — not on turns.
export const USD_PER_CREDIT = 0.001;

// Anti-abuse floor: any positive-cost turn costs at least this much so a free
// tier can't drain unbilled traffic through micro-requests. Kept tiny (not a
// full credit) so credits stay a faithful mirror of real cost — a $0.00252
// average message charges 2.52 credits, not a rounded-up 3.
export const MIN_BILLABLE_CREDITS = 0.1;

export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
};

export function calculateCostUsd(model: ModelId, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model];
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  // outputTokens is OpenAI's `completion_tokens`, which ALREADY INCLUDES the
  // reasoning tokens (completion_tokens_details.reasoning_tokens is a subset
  // of it, not an addition). reasoningTokens is carried on ModelUsage purely
  // as a telemetry split — adding it here double-billed every reasoning turn.
  const output = usage.outputTokens;

  return (
    fresh * pricing.inputPerToken +
    cached * pricing.cachedInputPerToken +
    output * pricing.outputPerToken
  );
}

// Credits are FRACTIONAL — they map 1:1 to real AI cost at USD_PER_CREDIT with
// no rounding, so the ledger reflects exact spend (a $0.0013 call = 1.3
// credits). Any positive cost is floored at MIN_BILLABLE_CREDITS as a
// micro-request guard. No per-model multiplier; the model's own pricing is the
// only cost differentiator.
export function calculateCredits(costUsd: number): number {
  if (costUsd <= 0) return 0;
  return Math.max(MIN_BILLABLE_CREDITS, costUsd / USD_PER_CREDIT);
}
