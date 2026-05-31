import {
  ATTACHMENT_FALLBACK,
  ATTACHMENT_MAX_H,
  ATTACHMENT_MAX_W,
  ATTACHMENT_MIN_W,
  fitAttachment,
  stripCardWidth,
} from "@/domain/mediaLayout";

describe("fitAttachment", () => {
  it("falls back to a square when dimensions are missing", () => {
    expect(fitAttachment({})).toEqual({
      width: ATTACHMENT_FALLBACK,
      height: ATTACHMENT_FALLBACK,
    });
    expect(fitAttachment({ width: 0, height: 0 })).toEqual({
      width: ATTACHMENT_FALLBACK,
      height: ATTACHMENT_FALLBACK,
    });
    // A half-known size is untrustworthy → square fallback, not a divide-by-zero.
    expect(fitAttachment({ width: 300, height: undefined })).toEqual({
      width: ATTACHMENT_FALLBACK,
      height: ATTACHMENT_FALLBACK,
    });
    expect(fitAttachment({ width: 300, height: null })).toEqual({
      width: ATTACHMENT_FALLBACK,
      height: ATTACHMENT_FALLBACK,
    });
  });

  it("preserves aspect ratio for a landscape meme within bounds", () => {
    // 600×400 (3:2). Width clamps to MAX_W=220, height follows the ratio.
    const { width, height } = fitAttachment({ width: 600, height: 400 });
    expect(width).toBe(ATTACHMENT_MAX_W);
    expect(height).toBeCloseTo((220 * 400) / 600, 5);
    expect(width / height).toBeCloseTo(600 / 400, 5);
  });

  it("never upscales a small meme past its intrinsic width", () => {
    // 120×90 is already smaller than MAX_W; it should keep its own width.
    const { width, height } = fitAttachment({ width: 120, height: 90 });
    expect(width).toBe(120);
    expect(height).toBeCloseTo(90, 5);
  });

  it("clamps a tall portrait meme to the max height", () => {
    // 600×1200 (1:2). Width-first would give 220×440 — too tall — so it pivots
    // to height=MAX_H and derives width (110) from the ratio, still ≥ MIN_W.
    const { width, height } = fitAttachment({ width: 600, height: 1200 });
    expect(height).toBe(ATTACHMENT_MAX_H);
    expect(width).toBeCloseTo((ATTACHMENT_MAX_H * 600) / 1200, 5); // 110
    expect(width).toBeGreaterThanOrEqual(ATTACHMENT_MIN_W);
  });

  it("floors a sliver-thin meme to the min width (width wins over exact ratio)", () => {
    // 40×1200 is so thin that even at MAX_H the ratio-derived width (~7px) would
    // be untappable, so it's floored to MIN_W and stays at MAX_H.
    const { width, height } = fitAttachment({ width: 40, height: 1200 });
    expect(width).toBe(ATTACHMENT_MIN_W);
    expect(height).toBe(ATTACHMENT_MAX_H);
  });

  it("keeps a square meme square within bounds", () => {
    const { width, height } = fitAttachment({ width: 500, height: 500 });
    expect(width).toBe(ATTACHMENT_MAX_W);
    expect(height).toBeCloseTo(ATTACHMENT_MAX_W, 5);
  });

  it("never returns a size outside the declared box", () => {
    const cases: { width: number; height: number }[] = [
      { width: 1920, height: 1080 },
      { width: 1, height: 4000 },
      { width: 4000, height: 1 },
      { width: 333, height: 777 },
    ];
    for (const c of cases) {
      const { width, height } = fitAttachment(c);
      expect(width).toBeGreaterThanOrEqual(ATTACHMENT_MIN_W);
      expect(width).toBeLessThanOrEqual(ATTACHMENT_MAX_W);
      expect(height).toBeLessThanOrEqual(ATTACHMENT_MAX_H);
      expect(height).toBeGreaterThan(0);
    }
  });
});

describe("stripCardWidth", () => {
  const bounds = { height: 120, min: 80, max: 200 };

  it("falls back to a square (height) when dimensions are missing", () => {
    expect(stripCardWidth({}, bounds)).toBe(bounds.height);
    expect(stripCardWidth({ width: 100, height: 0 }, bounds)).toBe(bounds.height);
    expect(stripCardWidth({ width: null, height: 100 }, bounds)).toBe(bounds.height);
  });

  it("scales width from the aspect ratio at the fixed row height", () => {
    // 240×120 (2:1) at row height 120 → 240, but clamped to max=200.
    expect(stripCardWidth({ width: 240, height: 120 }, bounds)).toBe(200);
    // 180×120 (1.5:1) at row height 120 → 180, within bounds.
    expect(stripCardWidth({ width: 180, height: 120 }, bounds)).toBe(180);
  });

  it("clamps a very wide item to the max card width", () => {
    expect(stripCardWidth({ width: 1000, height: 100 }, bounds)).toBe(bounds.max);
  });

  it("clamps a very tall item up to the min card width", () => {
    expect(stripCardWidth({ width: 100, height: 1000 }, bounds)).toBe(bounds.min);
  });

  it("always returns a width within [min, max]", () => {
    const ratios = [0.1, 0.5, 1, 1.7778, 3, 10];
    for (const r of ratios) {
      const w = stripCardWidth({ width: r * 100, height: 100 }, bounds);
      expect(w).toBeGreaterThanOrEqual(bounds.min);
      expect(w).toBeLessThanOrEqual(bounds.max);
    }
  });
});
