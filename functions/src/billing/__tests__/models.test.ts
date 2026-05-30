import {
  MODEL_IDS,
  MODEL_PRICING,
  UTILITY_MODEL,
  resolveModelId,
} from "../models";

describe("model registry", () => {
  it("MODEL_IDS covers pricing and resolves to a gpt-5.4 model", () => {
    for (const id of MODEL_IDS) {
      expect(MODEL_PRICING[id]).toBeDefined();
      expect(resolveModelId(id)).toMatch(/^gpt-5\.4-/);
    }
  });

  it("maps nano → gpt-5.4-nano and mini → gpt-5.4-mini", () => {
    expect(resolveModelId("nano")).toBe("gpt-5.4-nano");
    expect(resolveModelId("mini")).toBe("gpt-5.4-mini");
  });

  it("mini is pricier than nano on input and output", () => {
    expect(MODEL_PRICING.mini.inputPerToken).toBeGreaterThan(
      MODEL_PRICING.nano.inputPerToken,
    );
    expect(MODEL_PRICING.mini.outputPerToken).toBeGreaterThan(
      MODEL_PRICING.nano.outputPerToken,
    );
  });

  it("utility model is gpt-5-nano (system-billed, never user-facing)", () => {
    expect(UTILITY_MODEL).toBe("gpt-5-nano");
  });

  it("all pricing fields are positive and cached <= input", () => {
    for (const id of MODEL_IDS) {
      const p = MODEL_PRICING[id];
      expect(p.inputPerToken).toBeGreaterThan(0);
      expect(p.cachedInputPerToken).toBeGreaterThan(0);
      expect(p.outputPerToken).toBeGreaterThan(0);
      expect(p.cachedInputPerToken).toBeLessThanOrEqual(p.inputPerToken);
    }
  });
});
