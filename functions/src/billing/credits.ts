import { MODEL_CREDIT_MULTIPLIER, MODEL_PRICING, type ModelId } from "./models";

// 1 internal credit = USD 0.001. A $0.0001 call rounds up to 1 credit.
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
// drain unbilled traffic through micro-requests.
export function calculateCredits(model: ModelId, costUsd: number): number {
  if (costUsd <= 0) return 0;
  const multiplier = MODEL_CREDIT_MULTIPLIER[model];
  return Math.max(1, Math.ceil((costUsd * multiplier) / USD_PER_CREDIT));
}

// Pre-call reservation. Assumes a worst-case full-context request at
// plan.maxOutputTokens so we never under-reserve. Settled to actual usage
// after the stream's final chunk.
export function estimateReservationCredits(
  model: ModelId,
  estimatedInputTokens: number,
  maxOutputTokens: number,
): number {
  const costUsd = calculateCostUsd(model, {
    inputTokens: estimatedInputTokens,
    outputTokens: maxOutputTokens,
  });
  return calculateCredits(model, costUsd);
}
