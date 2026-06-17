import { randomReplaySampling } from "../replaySampling";

describe("randomReplaySampling", () => {
  it("returns a non-negative integer seed and no top_p", () => {
    for (const r of [0, 0.25, 0.5, 0.99, 0.999999]) {
      const sampling = randomReplaySampling(() => r);
      expect(Number.isInteger(sampling.seed)).toBe(true);
      expect(sampling.seed).toBeGreaterThanOrEqual(0);
      // gpt-5.x reasoning models reject a non-default top_p, so we never emit it.
      expect(sampling).not.toHaveProperty("topP");
    }
  });

  it("maps rng=0 to seed 0", () => {
    expect(randomReplaySampling(() => 0)).toEqual({ seed: 0 });
  });

  it("produces different seeds for different rng draws", () => {
    const a = randomReplaySampling(() => 0.1);
    const b = randomReplaySampling(() => 0.2);
    expect(a.seed).not.toBe(b.seed);
  });
});
