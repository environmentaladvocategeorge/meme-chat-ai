import { pickIndexByRandomness } from "../pickByRandomness";

describe("pickIndexByRandomness", () => {
  it("always returns the top hit for factor 1 (exact reference)", () => {
    // No matter where the rng lands, factor 1 collapses to index 0.
    for (const r of [0, 0.25, 0.5, 0.99]) {
      expect(pickIndexByRandomness(8, 1, () => r)).toBe(0);
    }
  });

  it("returns 0 when there is at most one candidate", () => {
    expect(pickIndexByRandomness(0, 3, () => 0.99)).toBe(0);
    expect(pickIndexByRandomness(1, 3, () => 0.99)).toBe(0);
  });

  it("front-biases the pick across the window for factor 3", () => {
    // Weights for factor 3 over 8 results: [3,2,1] plus straggler 0.5 → total 6.5.
    // The helper scales rng() across that total, so pass the normalized fraction
    // for each weight band: idx0 [0,3), idx1 [3,5), idx2 [5,6), straggler [6,6.5).
    const pick = (frac: number) => pickIndexByRandomness(8, 3, () => frac);
    expect(pick(0 / 6.5)).toBe(0); // weight pos 0   → idx0
    expect(pick(2.9 / 6.5)).toBe(0); // weight pos 2.9 → idx0
    expect(pick(3.1 / 6.5)).toBe(1); // weight pos 3.1 → idx1
    expect(pick(5.1 / 6.5)).toBe(2); // weight pos 5.1 → idx2
    expect(pick(6.2 / 6.5)).toBe(3); // weight pos 6.2 → straggler at index 3
  });

  it("never returns a straggler when the window already spans all results", () => {
    // factor 3 with only 3 results: window is the whole list, no index-3 hit.
    for (const r of [0, 0.5, 0.999]) {
      expect(pickIndexByRandomness(3, 3, () => r)).toBeLessThan(3);
    }
  });

  it("clamps the factor to the number of available results", () => {
    // factor 9 but only 2 results → behaves like a 2-wide window, never OOB.
    for (const r of [0, 0.5, 0.999]) {
      expect(pickIndexByRandomness(2, 9, () => r)).toBeLessThan(2);
    }
  });
});
