import {
  USD_PER_CREDIT,
  calculateCostUsd,
  calculateCredits,
  estimateReservationCredits,
} from "../credits";
import { MODEL_PRICING } from "../models";

describe("calculateCostUsd", () => {
  it("computes input + output cost for nano (gpt-4o-mini pricing)", () => {
    const cost = calculateCostUsd("nano", { inputTokens: 1000, outputTokens: 1000 });
    // 1000 * 0.15/M + 1000 * 0.60/M = 0.00015 + 0.00060 = 0.00075
    expect(cost).toBeCloseTo(0.00075, 10);
  });

  it("discounts cached input tokens", () => {
    const cost = calculateCostUsd("nano", {
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 0,
    });
    // 500 fresh @ 0.15/M + 500 cached @ 0.075/M = 0.000075 + 0.0000375 = 0.0001125
    expect(cost).toBeCloseTo(0.0001125, 10);
  });

  it("treats reasoning tokens as output tokens", () => {
    const cost = calculateCostUsd("smart-mini", {
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 100,
    });
    expect(cost).toBeCloseTo(200 * MODEL_PRICING["smart-mini"].outputPerToken, 12);
  });

  it("clamps cached tokens to inputTokens", () => {
    const cost = calculateCostUsd("nano", {
      inputTokens: 100,
      cachedInputTokens: 500,
      outputTokens: 0,
    });
    // All 100 input treated as cached; no negative fresh charge.
    expect(cost).toBeCloseTo(100 * MODEL_PRICING.nano.cachedInputPerToken, 12);
  });
});

describe("calculateCredits", () => {
  it("returns 0 for zero cost", () => {
    expect(calculateCredits("nano", 0)).toBe(0);
  });

  it("returns at least 1 for any positive cost on every model", () => {
    for (const m of ["nano", "smart-nano", "mini", "smart-mini"] as const) {
      expect(calculateCredits(m, 0.0000001)).toBeGreaterThanOrEqual(1);
    }
  });

  it("applies tier multiplier", () => {
    // Cost = 0.001 USD = 1 credit base. Multipliers: nano 1, smart-nano 2, mini 5, smart-mini 10.
    expect(calculateCredits("nano", 0.001)).toBe(1);
    expect(calculateCredits("smart-nano", 0.001)).toBe(2);
    expect(calculateCredits("mini", 0.001)).toBe(5);
    expect(calculateCredits("smart-mini", 0.001)).toBe(10);
  });

  it("ceils fractional credits", () => {
    // cost 0.00015 USD on mini (5x mult) = 0.00075 / 0.001 = 0.75 → ceil → 1.
    expect(calculateCredits("mini", 0.00015)).toBe(1);
    // cost 0.0012 USD on mini = 6.0 → 6.
    expect(calculateCredits("mini", 0.0012)).toBe(6);
  });

  it("USD_PER_CREDIT is 0.001", () => {
    expect(USD_PER_CREDIT).toBe(0.001);
  });
});

describe("estimateReservationCredits", () => {
  it("reserves a worst-case credit budget pre-call", () => {
    // 1k input + 512 output on nano = real gpt-4o-mini cost
    // 1000 * 0.15/M + 512 * 0.60/M = 0.00015 + 0.0003072 = 0.0004572
    // multiplier 1, /0.001 = 0.4572, ceil → 1
    expect(estimateReservationCredits("nano", 1000, 512)).toBeGreaterThanOrEqual(1);
  });

  it("reserves more for smart-mini at the same token counts", () => {
    const nano = estimateReservationCredits("nano", 4000, 1024);
    const smartMini = estimateReservationCredits("smart-mini", 4000, 1024);
    expect(smartMini).toBeGreaterThan(nano);
  });
});
