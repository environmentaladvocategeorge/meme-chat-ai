import { describe, expect, it } from "@jest/globals";
import { rotLevelBlock } from "../rotLevel";

describe("rotLevelBlock", () => {
  it("returns a distinct block per level", () => {
    expect(rotLevelBlock(1)).toContain("LIGHTLY COOKED");
    expect(rotLevelBlock(2)).toContain("ROTTED");
    expect(rotLevelBlock(3)).toContain("ROT LEVEL: 3/3 — MAX");
  });

  it("never says 'goblin' in-prompt (the leak-priming dial name stays UI-only)", () => {
    for (const level of [1, 2, 3]) {
      for (const emojis of [true, false]) {
        expect(rotLevelBlock(level, emojis).toLowerCase()).not.toContain("goblin");
      }
    }
  });

  it("ships level-matched few-shot examples", () => {
    expect(rotLevelBlock(1)).toContain("Example exchange (shape, not script):");
    expect(rotLevelBlock(3)).toContain("Example exchanges (shape, not script):");
    // The ts-tuff opener is demonstrated once, at L3.
    expect(rotLevelBlock(3)).toContain("first of all, ts tuff");
    expect(rotLevelBlock(1)).not.toContain("first of all, ts tuff");
  });

  it("licenses the GIF riff at L3 only", () => {
    expect(rotLevelBlock(3)).toContain("usually react to it");
    expect(rotLevelBlock(1)).not.toContain("usually react to it");
    expect(rotLevelBlock(2)).not.toContain("usually react to it");
  });

  it("strips example emoji in the emoji-off variant", () => {
    for (const level of [1, 2, 3]) {
      const off = rotLevelBlock(level, false);
      expect(off).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
      // No double spaces or space-before-quote artifacts left by stripping.
      expect(off).not.toMatch(/[^\S\n][^\S\n]/);
      expect(off).not.toMatch(/[^\S\n]"$/m);
    }
  });

  it("clamps out-of-range levels into 1..3", () => {
    expect(rotLevelBlock(0)).toBe(rotLevelBlock(1));
    expect(rotLevelBlock(99)).toBe(rotLevelBlock(3));
    expect(rotLevelBlock(2.4)).toBe(rotLevelBlock(2));
  });

  it("keeps the per-level emoji guidance when emojis are enabled (default)", () => {
    // Level 2's "every reply" emoji bullet should still be present by default.
    expect(rotLevelBlock(2)).toContain("Use emojis in every reply");
    expect(rotLevelBlock(2)).toBe(rotLevelBlock(2, true));
    expect(rotLevelBlock(2)).not.toMatch(/Do NOT use any emojis/i);
  });

  it("swaps the emoji bullet for a hard no-emoji directive when disabled", () => {
    for (const level of [1, 2, 3]) {
      const off = rotLevelBlock(level, false);
      expect(off).toContain("Do NOT use any emojis");
      // The level's normal emoji guidance must be gone, not merely appended to.
      expect(off).not.toContain("Use emojis in every reply");
      expect(off).not.toContain("at most one emoji per reply");
      // The rest of the block (the level identity) is untouched.
      expect(off).toContain(rotLevelBlock(level).split("\n")[2]);
    }
  });

  it("never leaves the emoji placeholder in the output", () => {
    expect(rotLevelBlock(1, true)).not.toContain("{{EMOJI_LINE}}");
    expect(rotLevelBlock(1, false)).not.toContain("{{EMOJI_LINE}}");
  });
});
