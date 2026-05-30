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
});
