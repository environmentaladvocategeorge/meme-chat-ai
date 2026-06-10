import { describe, expect, it } from "@jest/globals";
import {
  asFragmentedPrompt,
  assembleFragments,
  type FragmentedPrompt,
} from "../fragments";
import { rotLevelBlock } from "../rotLevel";

function fp(fragments: FragmentedPrompt["fragments"]): FragmentedPrompt {
  return { fragmentsVersion: 1, joinWith: "\n\n", fragments };
}

describe("assembleFragments", () => {
  it("joins static fragments with the separator, in order", () => {
    const out = assembleFragments(
      fp([
        { key: "a", text: "AAA" },
        { key: "b", text: "BBB" },
        { key: "c", text: "CCC" },
      ]),
      { level: 2, emojisEnabled: true },
    );
    expect(out).toBe("AAA\n\nBBB\n\nCCC");
  });

  it("drops a requires:emojis fragment when emojis are off, keeps it when on", () => {
    const frag = fp([
      { key: "before", text: "BEFORE" },
      { key: "emoji", requires: "emojis", text: "EMOJI SECTION" },
      { key: "after", text: "AFTER" },
    ]);
    expect(assembleFragments(frag, { level: 2, emojisEnabled: true })).toBe(
      "BEFORE\n\nEMOJI SECTION\n\nAFTER",
    );
    // Dropped cleanly — no orphan separator / blank line left behind.
    expect(assembleFragments(frag, { level: 2, emojisEnabled: false })).toBe(
      "BEFORE\n\nAFTER",
    );
  });

  it("resolves a dynamic rot_level_block to rotLevelBlock(level, emoji)", () => {
    const frag = fp([
      { key: "x", text: "X" },
      { key: "rot_level_block", dynamic: "rot_level_block" },
      { key: "y", text: "Y" },
    ]);
    for (const level of [1, 2, 3]) {
      for (const emojisEnabled of [true, false]) {
        const out = assembleFragments(frag, { level, emojisEnabled });
        expect(out).toBe(`X\n\n${rotLevelBlock(level, emojisEnabled)}\n\nY`);
      }
    }
  });

  it("uses textWhenEmojisOff only when emojis are off", () => {
    const frag = fp([
      {
        key: "factual",
        text: "answer 📚 here 💀 done",
        textWhenEmojisOff: "answer here done",
      },
    ]);
    expect(assembleFragments(frag, { level: 2, emojisEnabled: true })).toBe(
      "answer 📚 here 💀 done",
    );
    expect(assembleFragments(frag, { level: 2, emojisEnabled: false })).toBe(
      "answer here done",
    );
  });

  it("falls back to text when no emoji-off variant is provided", () => {
    const frag = fp([{ key: "plain", text: "no variant" }]);
    expect(assembleFragments(frag, { level: 1, emojisEnabled: false })).toBe(
      "no variant",
    );
  });
});

describe("asFragmentedPrompt", () => {
  it("accepts a well-formed payload", () => {
    expect(
      asFragmentedPrompt({
        fragmentsVersion: 1,
        joinWith: "\n\n",
        fragments: [
          { key: "a", text: "A" },
          { key: "rot", dynamic: "rot_level_block" },
          { key: "e", requires: "emojis", text: "E", textWhenEmojisOff: "" },
        ],
      }),
    ).not.toBeNull();
  });

  it("rejects malformed payloads so the doc validator can reject the doc", () => {
    expect(asFragmentedPrompt(null)).toBeNull();
    expect(asFragmentedPrompt("string")).toBeNull();
    expect(asFragmentedPrompt({})).toBeNull();
    // missing joinWith
    expect(
      asFragmentedPrompt({ fragmentsVersion: 1, fragments: [{ key: "a", text: "A" }] }),
    ).toBeNull();
    // empty fragments
    expect(
      asFragmentedPrompt({ fragmentsVersion: 1, joinWith: "\n\n", fragments: [] }),
    ).toBeNull();
    // a non-dynamic fragment with no text
    expect(
      asFragmentedPrompt({
        fragmentsVersion: 1,
        joinWith: "\n\n",
        fragments: [{ key: "a" }],
      }),
    ).toBeNull();
    // unknown requires value
    expect(
      asFragmentedPrompt({
        fragmentsVersion: 1,
        joinWith: "\n\n",
        fragments: [{ key: "a", text: "A", requires: "premium" }],
      }),
    ).toBeNull();
  });
});
