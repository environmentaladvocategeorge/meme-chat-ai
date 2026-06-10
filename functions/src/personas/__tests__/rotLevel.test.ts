import { describe, expect, it } from "@jest/globals";
import { rotLevelBlock } from "../rotLevel";

describe("rotLevelBlock", () => {
  it("returns a distinct block per level", () => {
    expect(rotLevelBlock(1)).toContain("LIGHTLY COOKED");
    expect(rotLevelBlock(2)).toContain("ROTTED");
    expect(rotLevelBlock(3)).toContain("GOBLIN MODE");
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
