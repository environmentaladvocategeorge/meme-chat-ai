import { describe, expect, it } from "@jest/globals";
import { asFragmentedPrompt, assembleFragments } from "../fragments";
import { LUNA_PERSONA_SPEC, LUNA_PUBLIC_CONFIG } from "../lunaSpec";
import {
  LUNA_PERSONA_FRAGMENTS,
  LUNA_PERSONA_PROMPT_DOC,
} from "../lunaPersonaPrompt";
import { PERSONA_MEDIA_DECIDER_KEY } from "../personaMediaDeciderPrompt";

// ── Luna persona ──────────────────────────────────────────────────────────────
// Luna's contract: she renders cleanly through the shared template AND she is a
// genuine DIFFERENTIATOR from Brainrot Bot — different voice, vocab, emoji, and
// media. The differentiation assertions are deliberate: a future edit that
// accidentally drags brainrot tokens / the brainrot decider into Luna should
// fail here, because "feels like a different bot" is the whole product reason
// she exists.

const ALL_VARIANTS = [1, 2, 3].flatMap((level) =>
  [true, false].map((emojisEnabled) => ({ level, emojisEnabled })),
);

// The full assembled persona prompt for the default variant (rot 2, emoji on).
const assembled = assembleFragments(LUNA_PERSONA_FRAGMENTS, {
  level: 2,
  emojisEnabled: true,
});

describe("Luna renders through the template", () => {
  it("produces a valid fragmented prompt", () => {
    expect(asFragmentedPrompt(LUNA_PERSONA_FRAGMENTS)).not.toBeNull();
  });

  it("assembles every (rot level, emoji) variant without throwing", () => {
    for (const ctx of ALL_VARIANTS) {
      expect(assembleFragments(LUNA_PERSONA_FRAGMENTS, ctx).length).toBeGreaterThan(0);
    }
  });

  it("names Luna in the intro and carries her word bank", () => {
    expect(assembled).toContain("PERSONA: LUNA");
    expect(assembled).toContain("manifesting");
    expect(assembled).toContain("mercury retrograde");
  });

  it("uses the persona-neutral dial, not Brainrot's", () => {
    // The neutral DEFAULT_USER_ROT_LEVELS never says "Brainrot Bot".
    expect(assembled).not.toContain("Brainrot Bot");
  });
});

describe("Luna's media is her own, not Brainrot's", () => {
  it("routes through the minimal persona decider", () => {
    expect(LUNA_PERSONA_PROMPT_DOC.mediaDeciderKey).toBe(PERSONA_MEDIA_DECIDER_KEY);
  });

  it("emits media notes grounded in her public config + favorites", () => {
    const notes = LUNA_PERSONA_PROMPT_DOC.mediaNotes ?? "";
    expect(notes).toContain(LUNA_PUBLIC_CONFIG.displayName);
    expect(notes).toContain(LUNA_PUBLIC_CONFIG.shortDescription);
    // A couple of her favorite searches must surface for the decider to lead with.
    expect(notes).toContain("tarot cards");
    expect(notes).toContain("manifesting");
  });
});

describe("Luna is a real differentiator from Brainrot", () => {
  it("shares none of Brainrot's signature slang", () => {
    for (const token of [
      "skibidi",
      "rizz",
      "gyatt",
      "Tralalero",
      "Bombardiro",
      "we're cooked",
      "dogwater",
      "goblin",
    ]) {
      expect(assembled.toLowerCase()).not.toContain(token.toLowerCase());
    }
  });

  it("uses a soft cosmic emoji palette, not the chaos set", () => {
    expect(LUNA_PERSONA_SPEC.emojiPalette).toContain("🔮");
    expect(LUNA_PERSONA_SPEC.emojiPalette).toContain("🌙");
    expect(LUNA_PERSONA_SPEC.emojiPalette).not.toContain("💀");
    expect(LUNA_PERSONA_SPEC.emojiPalette).not.toContain("🔥");
  });
});
