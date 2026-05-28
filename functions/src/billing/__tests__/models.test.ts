import {
  MODEL_CREDIT_MULTIPLIER,
  MODEL_IDS,
  MODEL_PRICING,
  MODEL_RANK,
  isMiniFamily,
  resolveModelId,
} from "../models";

describe("model registry", () => {
  it("MODEL_IDS lists every model the registries cover", () => {
    for (const id of MODEL_IDS) {
      expect(MODEL_PRICING[id]).toBeDefined();
      expect(MODEL_CREDIT_MULTIPLIER[id]).toBeDefined();
      expect(MODEL_RANK[id]).toBeDefined();
      expect(resolveModelId(id)).toBe("gpt-4o-mini");
    }
  });

  it("MODEL_RANK is a strict total order matching nano < smart-nano < mini < smart-mini", () => {
    expect(MODEL_RANK.nano).toBeLessThan(MODEL_RANK["smart-nano"]);
    expect(MODEL_RANK["smart-nano"]).toBeLessThan(MODEL_RANK.mini);
    expect(MODEL_RANK.mini).toBeLessThan(MODEL_RANK["smart-mini"]);
  });

  it("MODEL_CREDIT_MULTIPLIER is monotonic with MODEL_RANK", () => {
    const ordered = [...MODEL_IDS].sort((a, b) => MODEL_RANK[a] - MODEL_RANK[b]);
    for (let i = 1; i < ordered.length; i++) {
      expect(MODEL_CREDIT_MULTIPLIER[ordered[i]]).toBeGreaterThanOrEqual(
        MODEL_CREDIT_MULTIPLIER[ordered[i - 1]],
      );
    }
  });

  it("isMiniFamily flags only mini and smart-mini", () => {
    expect(isMiniFamily("nano")).toBe(false);
    expect(isMiniFamily("smart-nano")).toBe(false);
    expect(isMiniFamily("mini")).toBe(true);
    expect(isMiniFamily("smart-mini")).toBe(true);
  });

  it("all pricing fields are positive", () => {
    for (const id of MODEL_IDS) {
      const p = MODEL_PRICING[id];
      expect(p.inputPerToken).toBeGreaterThan(0);
      expect(p.cachedInputPerToken).toBeGreaterThan(0);
      expect(p.outputPerToken).toBeGreaterThan(0);
      expect(p.cachedInputPerToken).toBeLessThanOrEqual(p.inputPerToken);
    }
  });
});
