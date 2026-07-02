import { USD_PER_CREDIT, calculateCostUsd, calculateCredits } from "../credits";
import { MODEL_PRICING } from "../models";

describe("calculateCostUsd", () => {
  it("computes input + output cost for nano (gpt-5.4-nano pricing)", () => {
    const cost = calculateCostUsd("gpt-5.4-nano", {
      inputTokens: 1000,
      outputTokens: 1000,
    });
    // 1000 * 0.20/M + 1000 * 1.25/M = 0.0002 + 0.00125 = 0.00145
    expect(cost).toBeCloseTo(0.00145, 10);
  });

  it("discounts cached input tokens", () => {
    const cost = calculateCostUsd("gpt-5.4-nano", {
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 0,
    });
    // 500 fresh @ 0.20/M + 500 cached @ 0.02/M = 0.0001 + 0.00001 = 0.00011
    expect(cost).toBeCloseTo(0.00011, 10);
  });

  it("does NOT double-bill reasoning tokens (already inside outputTokens)", () => {
    // outputTokens mirrors OpenAI's completion_tokens, which already CONTAINS
    // completion_tokens_details.reasoning_tokens — the reasoning split is
    // telemetry, not an extra charge.
    const cost = calculateCostUsd("gpt-5.4-mini", {
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 100,
    });
    expect(cost).toBeCloseTo(100 * MODEL_PRICING["gpt-5.4-mini"].outputPerToken, 12);
  });

  it("prices the Big Brain full model above mini for the same tokens", () => {
    const usage = { inputTokens: 1000, outputTokens: 1000 };
    expect(calculateCostUsd("gpt-5.4", usage)).toBeGreaterThan(
      calculateCostUsd("gpt-5.4-mini", usage),
    );
  });

  it("clamps cached tokens to inputTokens", () => {
    const cost = calculateCostUsd("gpt-5.4-nano", {
      inputTokens: 100,
      cachedInputTokens: 500,
      outputTokens: 0,
    });
    // All 100 input treated as cached; no negative fresh charge.
    expect(cost).toBeCloseTo(
      100 * MODEL_PRICING["gpt-5.4-nano"].cachedInputPerToken,
      12,
    );
  });
});

describe("calculateCredits", () => {
  it("returns 0 for zero cost", () => {
    expect(calculateCredits(0)).toBe(0);
  });

  it("floors any positive cost at the micro-request minimum (0.1)", () => {
    expect(calculateCredits(0.0000001)).toBe(0.1);
    expect(calculateCredits(0.00005)).toBe(0.1); // 0.05 → 0.1 floor
  });

  it("maps cost to credits 1:1 at $0.001 per credit (no multiplier)", () => {
    expect(calculateCredits(0.001)).toBe(1);
    expect(calculateCredits(0.005)).toBe(5);
    expect(calculateCredits(0.01)).toBe(10);
  });

  it("keeps credits fractional (no rounding to whole credits)", () => {
    expect(calculateCredits(0.0005)).toBeCloseTo(0.5, 10); // $0.0005 → 0.5
    expect(calculateCredits(0.0013)).toBeCloseTo(1.3, 10); // $0.0013 → 1.3
    expect(calculateCredits(0.00252)).toBeCloseTo(2.52, 10); // avg msg → 2.52
  });

  it("USD_PER_CREDIT is 0.001", () => {
    expect(USD_PER_CREDIT).toBe(0.001);
  });
});
