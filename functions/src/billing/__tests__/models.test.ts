import { MODEL_IDS, MODEL_PRICING, resolveModelId } from "../models";

describe("model registry", () => {
  it("MODEL_IDS covers pricing and is itself the gpt-5.4 model string", () => {
    for (const id of MODEL_IDS) {
      expect(MODEL_PRICING[id]).toBeDefined();
      expect(id).toMatch(/^gpt-5\.4/);
      // ModelId IS the OpenAI string, so resolveModelId is an identity passthrough.
      expect(resolveModelId(id)).toBe(id);
    }
  });

  it("the model ladder is nano < mini < full on input and output price", () => {
    expect(MODEL_PRICING["gpt-5.4-mini"].inputPerToken).toBeGreaterThan(
      MODEL_PRICING["gpt-5.4-nano"].inputPerToken,
    );
    expect(MODEL_PRICING["gpt-5.4-mini"].outputPerToken).toBeGreaterThan(
      MODEL_PRICING["gpt-5.4-nano"].outputPerToken,
    );
    expect(MODEL_PRICING["gpt-5.4"].inputPerToken).toBeGreaterThan(
      MODEL_PRICING["gpt-5.4-mini"].inputPerToken,
    );
    expect(MODEL_PRICING["gpt-5.4"].outputPerToken).toBeGreaterThan(
      MODEL_PRICING["gpt-5.4-mini"].outputPerToken,
    );
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
