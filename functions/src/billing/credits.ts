import { MODEL_PRICING, type ModelId } from "./models";

// 1 internal credit = USD 0.001 of real AI cost. Credits are charged on the
// full OpenAI usage — input (system prompt + assembled context + the user's
// message) plus output — not on turns. A $0.0001 call rounds up to 1 credit.
export const USD_PER_CREDIT = 0.001;

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
  // reasoningTokens are billed at the output rate (OpenAI o-series convention).
  const output = usage.outputTokens + (usage.reasoningTokens ?? 0);

  return (
    fresh * pricing.inputPerToken +
    cached * pricing.cachedInputPerToken +
    output * pricing.outputPerToken
  );
}

// Any positive cost yields at least 1 credit (floor) so a free tier can't
// drain unbilled traffic through micro-requests. Credits map 1:1 to real AI
// cost at USD_PER_CREDIT — no per-model multiplier; the model's own pricing
// already differentiates plans.
export function calculateCredits(costUsd: number): number {
  if (costUsd <= 0) return 0;
  return Math.max(1, Math.ceil(costUsd / USD_PER_CREDIT));
}
