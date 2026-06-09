import { describe, expect, it } from "@jest/globals";
import {
  applyRotLevel,
  ROT_LEVEL_PLACEHOLDER,
  rotLevelBlock,
} from "../content";

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

describe("applyRotLevel", () => {
  it("replaces the placeholder in place", () => {
    const prompt = `intro\n\n${ROT_LEVEL_PLACEHOLDER}\n\noutro`;
    const out = applyRotLevel(prompt, 3);
    expect(out).not.toContain(ROT_LEVEL_PLACEHOLDER);
    expect(out).toContain("GOBLIN MODE");
    expect(out.startsWith("intro")).toBe(true);
    expect(out.endsWith("outro")).toBe(true);
  });

  it("appends the block when no placeholder is present", () => {
    const out = applyRotLevel("just a persona", 1);
    expect(out.startsWith("just a persona")).toBe(true);
    expect(out).toContain("LIGHTLY COOKED");
  });

  it("never leaves a raw placeholder behind", () => {
    expect(applyRotLevel(`x ${ROT_LEVEL_PLACEHOLDER} y`, 2)).not.toContain(
      ROT_LEVEL_PLACEHOLDER,
    );
  });

  it("threads the emoji toggle into the substituted block", () => {
    const prompt = `intro\n\n${ROT_LEVEL_PLACEHOLDER}\n\noutro`;
    const off = applyRotLevel(prompt, 2, false);
    expect(off).toContain("Do NOT use any emojis");
    expect(off).not.toContain("Use emojis in every reply");
    // Default arg keeps emojis on.
    expect(applyRotLevel(prompt, 2)).toContain("Use emojis in every reply");
  });
});
