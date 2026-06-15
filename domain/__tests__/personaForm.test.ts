import {
  EMPTY_PERSONA_FORM,
  isPersonaFormValid,
  LIMITS,
  normalizePersonaForm,
  personaInputToFormValues,
  PERSONA_STEPS,
  splitEmojis,
  toPersonaSavePayload,
  validatePersonaForm,
  validateStep,
  type PersonaFormValues,
} from "../personaForm";
import { PERSONA_TEMPLATES } from "../personaTemplates";

function filled(overrides: Partial<PersonaFormValues> = {}): PersonaFormValues {
  return { ...PERSONA_TEMPLATES[0].values, ...overrides };
}

describe("LIMITS parity with the backend", () => {
  // Pins the client limits to the backend userPersonaInputSchema numbers. If
  // the backend moves a limit, update both and this guard.
  it("matches the documented backend constraints", () => {
    expect(LIMITS).toMatchObject({
      displayName: 40,
      identity: 600,
      shortDescription: 160,
      voiceUser: 300,
      voiceGood: 500,
      signatureMove: 200,
      greeting: 120,
      greetingsMax: 6,
      humorType: 40,
      humorTypesMax: 8,
      humorExample: 160,
      humorExamplesMax: 6,
      slangGlosses: 1200,
      emojiMax: 20,
      toneTag: 24,
      toneTagsMax: 5,
      wordBankTerm: 60,
      wordBankMax: 40,
      mediaPill: 60,
      mediaPillsMax: 8,
      mediaLean: 200,
    });
  });
});

describe("personaInputToFormValues", () => {
  it("round-trips a fully-populated form through the save payload and back", () => {
    // toPersonaSavePayload is the forward map (form → stored input); this is its
    // inverse. A round-trip must preserve every meaningful field — including
    // wordBank, the field most recently added.
    const original = filled({
      voiceUser: "i bombed it",
      voiceGood: "we run it back",
      slangGlosses: "cooked = done for",
      signatureMove: "ends on a gym metaphor",
      wordBank: ["lowkey", "cooked", "locked in"],
      mediaPills: ["gym fail"],
      mediaLean: "loves a reaction",
      emojiPalette: "😂 💀 🔥",
    });
    const payload = toPersonaSavePayload(original);
    const rebuilt = personaInputToFormValues(payload);
    // Forward again from the rebuilt values: the payload must be identical.
    expect(toPersonaSavePayload(rebuilt)).toEqual(payload);
    expect(rebuilt.wordBank).toEqual(["lowkey", "cooked", "locked in"]);
    expect(splitEmojis(rebuilt.emojiPalette)).toEqual(["😂", "💀", "🔥"]);
  });

  it("defaults every absent optional to empty (no crash on a bare doc)", () => {
    const bare = personaInputToFormValues({
      displayName: "Solo",
      identity: "minimal",
      greetingShapes: ["hi"],
      humorTypes: ["dry"],
      humorExampleShapes: ["short"],
      emojiPalette: ["🦫"],
      publicConfig: { shortDescription: "lean", toneTags: ["chill"] },
    });
    expect(bare.voiceUser).toBe("");
    expect(bare.voiceGood).toBe("");
    expect(bare.slangGlosses).toBe("");
    expect(bare.signatureMove).toBe("");
    expect(bare.wordBank).toEqual([]);
    expect(bare.mediaPills).toEqual([]);
    expect(bare.mediaLean).toBe("");
  });

  it("never crashes on a malformed/empty blob", () => {
    expect(personaInputToFormValues(undefined)).toEqual(EMPTY_PERSONA_FORM);
    expect(personaInputToFormValues(null)).toEqual(EMPTY_PERSONA_FORM);
    expect(personaInputToFormValues("garbage")).toEqual(EMPTY_PERSONA_FORM);
  });

  it("produces a value for EVERY form field (guards against a dropped field)", () => {
    // If a new field is added to PersonaFormValues but not to the mapper, this
    // fails — preventing the silent wipe-on-edit it would otherwise cause.
    const result = personaInputToFormValues(toPersonaSavePayload(filled()));
    for (const key of Object.keys(EMPTY_PERSONA_FORM)) {
      expect(result).toHaveProperty(key);
    }
  });
});

describe("validateStep", () => {
  it("flags the required fields of each step on an empty form", () => {
    expect(validateStep("identity", EMPTY_PERSONA_FORM)).toEqual({
      displayName: "required",
      shortDescription: "required",
    });
    expect(validateStep("whoAreThey", EMPTY_PERSONA_FORM)).toEqual({
      identity: "required",
    });
    expect(validateStep("humor", EMPTY_PERSONA_FORM)).toEqual({
      humorTypes: "required",
    });
    expect(validateStep("tone", EMPTY_PERSONA_FORM)).toEqual({});
    expect(validateStep("voice", EMPTY_PERSONA_FORM)).toEqual({
      greetingShapes: "required",
      emojiPalette: "required",
    });
    expect(validateStep("review", EMPTY_PERSONA_FORM)).toEqual({});
  });

  it("passes each step for a complete (template) form", () => {
    for (const step of PERSONA_STEPS) {
      expect(validateStep(step, filled())).toEqual({});
    }
  });

  it("flags over-length / over-count even on a non-required step", () => {
    expect(validateStep("identity", filled({ displayName: "x".repeat(41) })).displayName).toBe(
      "too_long",
    );
    expect(
      validateStep("tone", filled({ toneTags: ["a", "b", "c", "d", "e", "f"] })).toneTags,
    ).toBe("too_many");
  });
});

describe("validatePersonaForm / isPersonaFormValid", () => {
  it("is invalid when empty, valid when complete", () => {
    expect(isPersonaFormValid(EMPTY_PERSONA_FORM)).toBe(false);
    expect(isPersonaFormValid(filled())).toBe(true);
    expect(Object.keys(validatePersonaForm(filled()))).toHaveLength(0);
  });
});

describe("toPersonaSavePayload", () => {
  it("maps required fields and shapes publicConfig without avatarKey", () => {
    const payload = toPersonaSavePayload(filled());
    expect(payload.displayName).toBe("Chaos Goblin");
    expect(payload.publicConfig.shortDescription.length).toBeGreaterThan(0);
    expect(payload.publicConfig).not.toHaveProperty("avatarKey");
    expect(payload.humorTypes.length).toBeGreaterThan(0);
  });

  it("omits empty optionals (no voiceExample/slang/signature/media keys)", () => {
    const bare = filled({
      voiceUser: "",
      voiceGood: "",
      slangGlosses: "",
      signatureMove: "",
      mediaPills: [],
      mediaLean: "",
      humorExampleShapes: [],
    });
    const payload = toPersonaSavePayload(bare);
    expect(payload).not.toHaveProperty("voiceExample");
    expect(payload).not.toHaveProperty("slang");
    expect(payload).not.toHaveProperty("signatureMove");
    expect(payload).not.toHaveProperty("media");
    // humorExampleShapes is backend-required (>=1) — falls back, never empty.
    expect(payload.humorExampleShapes.length).toBeGreaterThan(0);
  });

  it("includes voiceExample only when BOTH user and good are present", () => {
    expect(toPersonaSavePayload(filled({ voiceUser: "hi", voiceGood: "" }))).not.toHaveProperty(
      "voiceExample",
    );
    expect(
      toPersonaSavePayload(filled({ voiceUser: "hi", voiceGood: "yo" })).voiceExample,
    ).toEqual({ user: "hi", good: "yo" });
  });

  it("trims free-text fields", () => {
    const payload = toPersonaSavePayload(filled({ displayName: "  Spacey  " }));
    expect(payload.displayName).toBe("Spacey");
  });

  it("splits the typed emoji string into the backend array", () => {
    expect(toPersonaSavePayload(filled({ emojiPalette: "😂💀🔥" })).emojiPalette).toEqual([
      "😂",
      "💀",
      "🔥",
    ]);
  });
});

describe("normalizePersonaForm", () => {
  it("coerces missing/wrong-typed fields to a complete form", () => {
    expect(normalizePersonaForm(undefined)).toEqual(EMPTY_PERSONA_FORM);
    const partial = normalizePersonaForm({ displayName: "X", toneTags: ["a", 5, "b"], identity: 9 });
    expect(partial.displayName).toBe("X");
    expect(partial.toneTags).toEqual(["a", "b"]);
    expect(partial.identity).toBe("");
  });

  it("coalesces a legacy string[] emojiPalette into the new string field", () => {
    expect(normalizePersonaForm({ emojiPalette: ["😂", "💀"] }).emojiPalette).toBe("😂💀");
    expect(normalizePersonaForm({ emojiPalette: "😂🔥" }).emojiPalette).toBe("😂🔥");
  });
});

describe("splitEmojis", () => {
  it("splits a run of simple emojis", () => {
    expect(splitEmojis("😂💀🔥")).toEqual(["😂", "💀", "🔥"]);
  });

  it("separates on whitespace and ignores empty input", () => {
    expect(splitEmojis("😂 💀  🔥")).toEqual(["😂", "💀", "🔥"]);
    expect(splitEmojis("   ")).toEqual([]);
    expect(splitEmojis("")).toEqual([]);
  });

  it("keeps variation selectors and skin-tone modifiers attached to their base", () => {
    expect(splitEmojis("🌧️💀")).toEqual(["🌧️", "💀"]);
    expect(splitEmojis("👍🏽🔥")).toEqual(["👍🏽", "🔥"]);
  });

  it("keeps a ZWJ sequence as one token", () => {
    expect(splitEmojis("👨‍👩‍👧🔥")).toEqual(["👨‍👩‍👧", "🔥"]);
  });
});
