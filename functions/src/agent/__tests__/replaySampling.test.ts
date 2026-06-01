import { randomReplaySampling } from "../replaySampling";

describe("randomReplaySampling", () => {
  it("keeps top_p within [0.85, 1.0] and seed a non-negative integer", () => {
    for (const r of [0, 0.25, 0.5, 0.99, 0.999999]) {
      const { topP, seed } = randomReplaySampling(() => r);
      expect(topP).toBeGreaterThanOrEqual(0.85);
      expect(topP).toBeLessThanOrEqual(1.0);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });

  it("maps rng=0 to the lower top_p bound and seed 0", () => {
    expect(randomReplaySampling(() => 0)).toEqual({ topP: 0.85, seed: 0 });
  });

  it("produces different seeds for different rng draws", () => {
    // Each call consumes two draws (top_p then seed); a strictly increasing
    // sequence guarantees the two calls land on different seed inputs.
    const seq = [0.1, 0.2, 0.3, 0.4];
    let i = 0;
    const rng = () => seq[i++];
    const a = randomReplaySampling(rng);
    const b = randomReplaySampling(rng);
    expect(a.seed).not.toBe(b.seed);
  });
});
