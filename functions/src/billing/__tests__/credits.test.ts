import {
  USD_PER_CREDIT,
  calculateCostUsd,
  calculateCredits,
  estimateReservationCredits,
} from "../credits";
import { MODEL_PRICING } from "../models";

describe("calculateCostUsd", () => {
  it("computes input + output cost for nano (gpt-5.4-nano pricing)", () => {
    const cost = calculateCostUsd("nano", { inputTokens: 1000, outputTokens: 1000 });
    // 1000 * 0.20/M + 1000 * 1.25/M = 0.0002 + 0.00125 = 0.00145
    expect(cost).toBeCloseTo(0.00145, 10);
  });

  it("discounts cached input tokens", () => {
    const cost = calculateCostUsd("nano", {
      inputTokens: 1000,
      cachedInputTokens: 500,
      outputTokens: 0,
    });
    // 500 fresh @ 0.20/M + 500 cached @ 0.02/M = 0.0001 + 0.00001 = 0.00011
    expect(cost).toBeCloseTo(0.00011, 10);
  });

  it("treats reasoning tokens as output tokens", () => {
    const cost = calculateCostUsd("mini", {
      inputTokens: 0,
      outputTokens: 100,
      reasoningTokens: 100,
    });
    expect(cost).toBeCloseTo(200 * MODEL_PRICING.mini.outputPerToken, 12);
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
    expect(calculateCredits(0)).toBe(0);
  });

  it("returns at least 1 for any positive cost", () => {
    expect(calculateCredits(0.0000001)).toBeGreaterThanOrEqual(1);
  });

  it("maps cost to credits 1:1 at $0.001 per credit (no multiplier)", () => {
    expect(calculateCredits(0.001)).toBe(1);
    expect(calculateCredits(0.005)).toBe(5);
    expect(calculateCredits(0.01)).toBe(10);
  });

  it("ceils fractional credits", () => {
    expect(calculateCredits(0.00075)).toBe(1); // 0.75 → 1
    expect(calculateCredits(0.0012)).toBe(2); // 1.2 → 2
  });

  it("USD_PER_CREDIT is 0.001", () => {
    expect(USD_PER_CREDIT).toBe(0.001);
  });
});

describe("estimateReservationCredits", () => {
  it("reserves at least 1 credit pre-call", () => {
    expect(estimateReservationCredits("nano", 1000, 512)).toBeGreaterThanOrEqual(1);
  });

  it("reserves more for mini than nano at the same token counts", () => {
    const nano = estimateReservationCredits("nano", 4000, 1024);
    const mini = estimateReservationCredits("mini", 4000, 1024);
    expect(mini).toBeGreaterThan(nano);
  });
});
