import { describe, expect, it } from "@jest/globals";
import { asFragmentedPrompt, assembleFragments } from "../fragments";
import {
  renderPersonaPrompt,
  renderPersonaPromptDoc,
  type PersonaSpec,
} from "../personaSpec";

// ── Persona template mechanics ────────────────────────────────────────────────
// Behavior of renderPersonaPrompt itself, on a synthetic spec — slot wiring,
// optional-slot omission, houseExtras placement, emoji-off derivation, and the
// layout contract. Brainrot-specific byte identity is brainrotSpecRender.test.ts.

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

// A minimal valid spec. The voice example carries emoji on purpose so the
// derived emoji-off variant path is exercised by default.
function makeSpec(overrides: Partial<PersonaSpec> = {}): PersonaSpec {
  return {
    id: "test_persona",
    displayName: "Test Bot",
    identity: "You're a test persona for unit tests.",
    voiceExample: {
      user: "what is a unit test",
      bad: "A unit test is **a test of a unit**.\n- It tests units",
      good: "a unit test checks one piece in isolation 🔬 no network, no database.\n\nwrite one per behavior and you sleep at night 💀",
    },
    greetingShapes: ["hey, what are we testing", "sup, drop the stack trace"],
    humorTypes: ["deadpan confidence", "fake-serious analysis"],
    humorExampleShapes: ["this code is held together by one passing test."],
    slang: {
      termGlosses: `"red" = a failing test, not an emergency.`,
      usageNotes: `flaky/brittle can roast tests, never people.`,
    },
    emojiPalette: ["🔬", "💀"],
    ...overrides,
  };
}

const fragmentByKey = (spec: PersonaSpec, key: string) => {
  const fragment = renderPersonaPrompt(spec).fragments.find((f) => f.key === key);
  if (!fragment) throw new Error(`fragment ${key} missing`);
  return fragment;
};

describe("slot wiring", () => {
  it("renders the intro header from the uppercased display name", () => {
    expect(fragmentByKey(makeSpec(), "persona_intro").text).toContain(
      "PERSONA: TEST BOT",
    );
  });

  it("references the display name (not Brainrot Bot) in the voice contract", () => {
    const text = fragmentByKey(makeSpec(), "voice_contract").text ?? "";
    expect(text).toContain("The real answer IS Test Bot,");
    expect(text).toContain("are still Test Bot;");
    expect(text).not.toContain("Brainrot Bot");
  });

  it("quotes and joins greeting shapes with slashes", () => {
    expect(fragmentByKey(makeSpec(), "greetings").text).toContain(
      `Shapes, not scripts: "hey, what are we testing" / "sup, drop the stack trace".`,
    );
  });

  it("comma-joins humor types and quotes example shapes one per line", () => {
    const text = fragmentByKey(makeSpec(), "voice_humor").text ?? "";
    expect(text).toContain(
      "Humor types: deadpan confidence, fake-serious analysis.",
    );
    expect(text).toContain(
      `Example shapes:\n"this code is held together by one passing test."`,
    );
  });

  it("space-joins the emoji palette inside the emoji-gated fragment", () => {
    const fragment = fragmentByKey(makeSpec(), "emoji");
    expect(fragment.requires).toBe("emojis");
    expect(fragment.text).toContain("use these or others that fit: 🔬 💀.");
  });
});

describe("optional slots", () => {
  it("inserts lexicalRule as its own paragraph before the voice example", () => {
    const rule = "Never say the word pineapple.";
    const text = fragmentByKey(makeSpec({ lexicalRule: rule }), "voice_contract").text ?? "";
    expect(text).toContain(`\n\n${rule}\n\nUser: "what is a unit test"`);
  });

  it("omitting lexicalRule leaves no gap (single blank line into the example)", () => {
    const text = fragmentByKey(makeSpec(), "voice_contract").text ?? "";
    expect(text).toContain(`parentheses.\n\nUser: "what is a unit test"`);
    expect(text).not.toContain("\n\n\n");
  });

  it("appends signatureMove to the HOW YOU TEXT paragraph with one space", () => {
    const move = "If the user asks for chaos, reply with one cursed sentence.";
    expect(fragmentByKey(makeSpec({ signatureMove: move }), "how_you_text").text).toContain(
      `not a reason to list. ${move}`,
    );
  });

  it("omitting signatureMove ends the paragraph at the list rule", () => {
    expect(fragmentByKey(makeSpec(), "how_you_text").text).toMatch(
      /not a reason to list\.$/,
    );
  });
});

describe("houseExtras", () => {
  it("inserts extras after the shared sections and keeps rot_level_block last", () => {
    const rendered = renderPersonaPrompt(
      makeSpec({
        houseExtras: [{ key: "house_quirk", text: "HOUSE QUIRK\n\nExtra bit." }],
      }),
    );
    const keys = rendered.fragments.map((f) => f.key);
    expect(keys[keys.length - 2]).toBe("house_quirk");
    expect(keys[keys.length - 1]).toBe("rot_level_block");
  });

  it("absent houseExtras adds no fragments", () => {
    const keys = renderPersonaPrompt(makeSpec()).fragments.map((f) => f.key);
    expect(keys).toStrictEqual([
      "persona_intro",
      "examples_shape",
      "voice_contract",
      "how_you_text",
      "roasting",
      "greetings",
      "voice_humor",
      "slang",
      "anti_repetition",
      "media",
      "emoji",
      "rot_level_block",
    ]);
  });
});

describe("emoji-off derivation", () => {
  it("derives textWhenEmojisOff only for fragments whose text has emoji", () => {
    const rendered = renderPersonaPrompt(makeSpec());
    for (const fragment of rendered.fragments) {
      if (fragment.dynamic || fragment.requires === "emojis") {
        expect(fragment.textWhenEmojisOff).toBeUndefined();
      } else if (EMOJI_RE.test(fragment.text ?? "")) {
        expect(fragment.textWhenEmojisOff).toBeDefined();
      } else {
        // No emoji → no variant key at all (a fabricated variant would bloat
        // the doc and drift from the canonical text).
        expect("textWhenEmojisOff" in fragment).toBe(false);
      }
    }
  });

  it("removes emoji without touching surrounding prose spacing", () => {
    const variant = fragmentByKey(makeSpec(), "voice_contract").textWhenEmojisOff ?? "";
    expect(variant).toContain(
      "a unit test checks one piece in isolation no network, no database.",
    );
    expect(variant).toContain("you sleep at night");
    expect(variant).not.toMatch(EMOJI_RE);
    // Spacing before quotes/punctuation survives (the rot blocks' stripper
    // tightens these; this derivation must not).
    expect(variant).toContain(`User: "what is a unit test"`);
  });
});

describe("renderPersonaPromptDoc / media slot", () => {
  it("renders fragments-only when the spec has no media config", () => {
    const doc = renderPersonaPromptDoc(makeSpec());
    expect(doc.fragments).toStrictEqual(renderPersonaPrompt(makeSpec()));
    // Field truly absent, not undefined — the push script treats absent as
    // "delete from the live doc".
    expect("mediaDeciderKey" in doc).toBe(false);
    expect("mediaNotes" in doc).toBe(false);
  });

  it("renders the decider key and quoted pills + lean into the notes", () => {
    const doc = renderPersonaPromptDoc(
      makeSpec({
        media: {
          deciderKey: "minimal_decider",
          pills: ["confused math lady", "office handshake"],
          lean: "mostly deadpan reactions, attach eagerly on hype turns",
        },
      }),
    );
    expect(doc.mediaDeciderKey).toBe("minimal_decider");
    expect(doc.mediaNotes).toContain(
      "PERSONA MEDIA PREFERENCES (vibe only — every rule above still wins)",
    );
    expect(doc.mediaNotes).toContain(`"confused math lady", "office handshake"`);
    expect(doc.mediaNotes).toContain(
      "Media vibe: mostly deadpan reactions, attach eagerly on hype turns.",
    );
  });

  it("pills alone render notes without a vibe line", () => {
    const doc = renderPersonaPromptDoc(
      makeSpec({ media: { pills: ["sad cat"] } }),
    );
    expect(doc.mediaNotes).toContain(`"sad cat"`);
    expect(doc.mediaNotes).not.toContain("Media vibe:");
    expect("mediaDeciderKey" in doc).toBe(false);
  });

  it("blank pills and lean render no notes at all", () => {
    const doc = renderPersonaPromptDoc(
      makeSpec({ media: { pills: ["  ", ""], lean: "   " } }),
    );
    expect("mediaNotes" in doc).toBe(false);
  });

  it("a deciderKey alone renders without notes", () => {
    const doc = renderPersonaPromptDoc(
      makeSpec({ media: { deciderKey: "minimal_decider" } }),
    );
    expect(doc.mediaDeciderKey).toBe("minimal_decider");
    expect("mediaNotes" in doc).toBe(false);
  });
});

describe("assembly contract", () => {
  const VARIANTS = [1, 2, 3].flatMap((level) =>
    [true, false].map((emojisEnabled) => ({ level, emojisEnabled })),
  );

  it("rendered output passes the Firestore-read validation gate", () => {
    expect(asFragmentedPrompt(renderPersonaPrompt(makeSpec()))).not.toBeNull();
  });

  it("assembles for all six (rot, emoji) variants; emoji-off is emoji-free", () => {
    const rendered = renderPersonaPrompt(makeSpec());
    for (const ctx of VARIANTS) {
      const assembled = assembleFragments(rendered, ctx);
      expect(assembled.length).toBeGreaterThan(0);
      if (!ctx.emojisEnabled) {
        expect(assembled).not.toMatch(
          /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u,
        );
      }
    }
  });

  it("is deterministic per variant: same (level, emoji) ctx renders identically", () => {
    const rendered = renderPersonaPrompt(makeSpec());
    const a = assembleFragments(rendered, { level: 2, emojisEnabled: true });
    const b = assembleFragments(rendered, { level: 2, emojisEnabled: true });
    expect(a).toBe(b);
  });
});
