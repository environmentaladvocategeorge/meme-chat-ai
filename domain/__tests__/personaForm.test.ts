import {
  EMPTY_PERSONA_FORM,
  isPersonaFormValid,
  LIMITS,
  normalizePersonaForm,
  personaInputToFormValues,
  personaInputToMediaPicks,
  PERSONA_STEPS,
  splitEmojis,
  toPersonaSavePayload,
  validatePersonaForm,
  validateStep,
  type PersonaFormValues,
  type PersonaStep,
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
      mediaPillsMax: 10,
      mediaLean: 200,
    });
  });
});

describe("\"let the model decide\" flags round-trip (create/edit contract)", () => {
  // Every optional section's toggle is a persisted boolean. When ON, the save
  // payload carries the flag and OMITS the section's value; the edit load reads
  // the flag back so the toggle reflects exactly what the user chose. This pins
  // that contract for the 6 SkippableField-backed flags (the other 4 —
  // autoHumor/autoGreet/autoWordBank/autoMedia — are already covered above).
  it("captures each flag on save and restores it on edit, with the value omitted", () => {
    const form: PersonaFormValues = {
      ...EMPTY_PERSONA_FORM,
      displayName: "Skipper",
      identity: "Lets the model run the show.",
      // All optional sections delegated → fields blank, flags on.
      autoTone: true,
      autoEmoji: true,
      autoSignature: true,
      autoVoiceExamples: true,
      autoSlang: true,
      autoRotLevels: true,
      autoHumor: true,
      autoGreet: true,
      autoWordBank: true,
      autoMedia: true,
    };
    const payload = toPersonaSavePayload(form);
    // Flags sent; values omitted.
    expect(payload.autoTone).toBe(true);
    expect(payload.autoEmoji).toBe(true);
    expect(payload.autoSignature).toBe(true);
    expect(payload.autoVoiceExamples).toBe(true);
    expect(payload.autoSlang).toBe(true);
    expect(payload.autoRotLevels).toBe(true);
    expect(payload.publicConfig.toneTags).toEqual([]);
    expect(payload.emojiPalette).toBeUndefined();
    expect(payload.signatureMove).toBeUndefined();
    expect(payload.voiceExamples).toBeUndefined();
    expect(payload.slang).toBeUndefined();
    expect(payload.rotLevels).toBeUndefined();

    const rebuilt = personaInputToFormValues(payload);
    expect(rebuilt.autoTone).toBe(true);
    expect(rebuilt.autoEmoji).toBe(true);
    expect(rebuilt.autoSignature).toBe(true);
    expect(rebuilt.autoVoiceExamples).toBe(true);
    expect(rebuilt.autoSlang).toBe(true);
    expect(rebuilt.autoRotLevels).toBe(true);
    // The delegated sections come back empty (model decides, nothing authored).
    expect(rebuilt.toneTags).toEqual([]);
    expect(rebuilt.emojiPalette).toBe("");
    expect(rebuilt.signatureMove).toBe("");
    expect(rebuilt.voiceExamples).toEqual([]);
    expect(rebuilt.slangGlosses).toBe("");
    expect(rebuilt.rotLevels).toEqual(["", "", ""]);
  });

  it("leaves flags OFF when sections are authored (toggle opens in author mode on edit)", () => {
    const form: PersonaFormValues = {
      ...EMPTY_PERSONA_FORM,
      displayName: "Author",
      identity: "Authored every section.",
      toneTags: ["chill"],
      emojiPalette: "🔥",
      signatureMove: "ends on a gym metaphor",
      voiceExamples: [{ user: "hi", good: "yo there" }],
      slangGlosses: "cooked = done",
      rotLevels: ["a", "b", "c"],
    };
    const rebuilt = personaInputToFormValues(toPersonaSavePayload(form));
    for (const f of [
      "autoTone",
      "autoEmoji",
      "autoSignature",
      "autoVoiceExamples",
      "autoSlang",
      "autoRotLevels",
    ] as const) {
      expect(rebuilt[f]).toBe(false);
    }
    expect(rebuilt.toneTags).toEqual(["chill"]);
    expect(rebuilt.slangGlosses).toBe("cooked = done");
    expect(rebuilt.rotLevels).toEqual(["a", "b", "c"]);
  });
});

describe("step gating: each optional section must be authored OR delegated", () => {
  const ready = (): PersonaFormValues => ({
    ...EMPTY_PERSONA_FORM,
    displayName: "Bot",
    shortDescription: "tagline",
    identity: "who they are",
  });

  const cases: {
    step: PersonaStep;
    field: keyof PersonaFormValues;
    flag: keyof PersonaFormValues;
    authored: Partial<PersonaFormValues>;
  }[] = [
    { step: "vibe", field: "toneTags", flag: "autoTone", authored: { toneTags: ["chill"] } },
    { step: "emoji", field: "emojiPalette", flag: "autoEmoji", authored: { emojiPalette: "🔥" } },
    { step: "catchphrase", field: "signatureMove", flag: "autoSignature", authored: { signatureMove: "does a thing" } },
    { step: "voiceExamples", field: "voiceExamples", flag: "autoVoiceExamples", authored: { voiceExamples: [{ user: "hi", good: "yo" }] } },
    { step: "slang", field: "slangGlosses", flag: "autoSlang", authored: { slangGlosses: "cooked = done" } },
    { step: "rotLevels", field: "rotLevels", flag: "autoRotLevels", authored: { rotLevels: ["a", "b", "c"] } },
    { step: "reactions", field: "mediaPills", flag: "autoMedia", authored: { mediaPills: ["lol"] } },
  ];

  it("blocks (required) when a section is neither authored nor delegated", () => {
    for (const c of cases) {
      expect(validateStep(c.step, ready())[c.field]).toBe("required");
    }
  });

  it("passes when the section's 'let the bot decide' flag is on", () => {
    for (const c of cases) {
      const v: PersonaFormValues = { ...ready() };
      (v as Record<string, unknown>)[c.flag] = true;
      expect(validateStep(c.step, v)[c.field]).toBeUndefined();
    }
  });

  it("passes when the section is authored", () => {
    for (const c of cases) {
      expect(validateStep(c.step, { ...ready(), ...c.authored })[c.field]).toBeUndefined();
    }
  });

  it("rot levels need all three blocks (partial still blocks)", () => {
    expect(validateStep("rotLevels", { ...ready(), rotLevels: ["a", "", "c"] }).rotLevels).toBe("required");
  });
});

describe("media: picked favorites and 'let the bot decide when' coexist", () => {
  // The reactions step decouples WHICH gifs (favorites) from WHEN it sends:
  // a user can pick favorites AND turn on autoMedia ("let the bot decide when")
  // at the same time. Both must survive into the payload — the favorites are
  // the decider's primary pool, autoMedia tells it to send proactively.
  it("sends both pills and auto:true when the user picked favorites and delegated timing", () => {
    const form: PersonaFormValues = {
      ...EMPTY_PERSONA_FORM,
      displayName: "Gym Bro Greg",
      identity: "hype gym bro",
      mediaPills: ["gym celebration gif", "gigachad"],
      autoMedia: true,
    };
    const payload = toPersonaSavePayload(form);
    expect(payload.media).toEqual({
      pills: ["gym celebration gif", "gigachad"],
      auto: true,
    });
  });

  it("a picked-favorites persona satisfies the reactions step with autoMedia off", () => {
    const v: PersonaFormValues = {
      ...EMPTY_PERSONA_FORM,
      mediaPills: ["gym celebration gif"],
      autoMedia: false,
    };
    expect(validateStep("reactions", v).mediaPills).toBeUndefined();
  });
});

describe("media picks (preview URLs) round-trip so the editor shows real thumbnails", () => {
  const form: PersonaFormValues = {
    ...EMPTY_PERSONA_FORM,
    displayName: "Gym Bro Greg",
    identity: "hype gym bro",
    mediaPills: ["gym celebration gif", "gigachad"],
  };
  const picks = [
    { name: "gym celebration gif", previewUrl: "https://cdn.klipy.test/a.gif" },
    { name: "gigachad", previewUrl: "https://cdn.klipy.test/b.gif" },
  ];

  it("carries the picks (name + previewUrl) into the payload alongside the pill names", () => {
    const payload = toPersonaSavePayload(form, picks);
    expect(payload.media?.pills).toEqual(["gym celebration gif", "gigachad"]);
    expect(payload.media?.picks).toEqual(picks);
  });

  it("omits picks when none are supplied (legacy / no-thumbnail save)", () => {
    const payload = toPersonaSavePayload(form);
    expect(payload.media?.pills).toEqual(["gym celebration gif", "gigachad"]);
    expect(payload.media?.picks).toBeUndefined();
  });

  it("reads stored picks back with their URLs (the edit-thumbnail fix)", () => {
    const stored = toPersonaSavePayload(form, picks);
    expect(personaInputToMediaPicks(stored)).toEqual(picks);
  });

  it("falls back to names with empty previews for a persona saved before picks existed", () => {
    const legacy = toPersonaSavePayload(form); // no picks stored
    expect(personaInputToMediaPicks(legacy)).toEqual([
      { name: "gym celebration gif", previewUrl: "" },
      { name: "gigachad", previewUrl: "" },
    ]);
  });

  it("returns [] when the persona has no media at all", () => {
    expect(personaInputToMediaPicks({})).toEqual([]);
    expect(personaInputToMediaPicks(undefined)).toEqual([]);
  });
});

describe("personaInputToFormValues", () => {
  it("round-trips a fully-populated form through the save payload and back", () => {
    // toPersonaSavePayload is the forward map (form → stored input); this is its
    // inverse. A round-trip must preserve every meaningful field — including
    // wordBank, the field most recently added.
    const original = filled({
      voiceExamples: [{ user: "i bombed it", good: "we run it back" }],
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
    expect(bare.voiceExamples).toEqual([]);
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
    expect(validateStep("greetings", EMPTY_PERSONA_FORM)).toEqual({
      greetingShapes: "required",
    });
    expect(validateStep("wordBank", EMPTY_PERSONA_FORM)).toEqual({
      wordBank: "too_few",
    });
    expect(validateStep("review", EMPTY_PERSONA_FORM)).toEqual({});
  });

  it("passes each step for a complete (template) form", () => {
    for (const step of PERSONA_STEPS) {
      expect(validateStep(step, filled())).toEqual({});
    }
  });

  it("greetings are optional when autoGreet is on", () => {
    expect(
      validateStep("greetings", { ...EMPTY_PERSONA_FORM, autoGreet: true }),
    ).toEqual({});
    // ...but still required when it's off.
    expect(validateStep("greetings", { ...EMPTY_PERSONA_FORM, autoGreet: false })).toEqual({
      greetingShapes: "required",
    });
  });

  it("flags too many voice-example pairs", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ user: `u${i}`, good: `g${i}` }));
    expect(
      validateStep("voiceExamples", filled({ voiceExamples: six })).voiceExamples,
    ).toBe("too_many");
  });

  it("flags over-length / over-count even on a non-required step", () => {
    expect(validateStep("identity", filled({ displayName: "x".repeat(41) })).displayName).toBe(
      "too_long",
    );
    expect(
      validateStep("vibe", filled({ toneTags: ["a", "b", "c", "d", "e", "f"] })).toneTags,
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
    expect(payload.humorTypes?.length ?? 0).toBeGreaterThan(0);
  });

  it("omits empty optionals (no voiceExamples/slang/signature/media keys)", () => {
    const bare = filled({
      voiceExamples: [],
      slangGlosses: "",
      signatureMove: "",
      mediaPills: [],
      mediaLean: "",
      humorExampleShapes: [],
    });
    const payload = toPersonaSavePayload(bare);
    expect(payload).not.toHaveProperty("voiceExamples");
    expect(payload).not.toHaveProperty("slang");
    expect(payload).not.toHaveProperty("signatureMove");
    expect(payload).not.toHaveProperty("media");
    // humorExampleShapes is backend-required (>=1) — falls back, never empty.
    expect(payload.humorExampleShapes?.length ?? 0).toBeGreaterThan(0);
  });

  it("includes only the voiceExample pairs with BOTH sides filled", () => {
    expect(
      toPersonaSavePayload(filled({ voiceExamples: [{ user: "hi", good: "" }] })),
    ).not.toHaveProperty("voiceExamples");
    expect(
      toPersonaSavePayload(
        filled({
          voiceExamples: [
            { user: "hi", good: "yo" },
            { user: "x", good: "" },
          ],
        }),
      ).voiceExamples,
    ).toEqual([{ user: "hi", good: "yo" }]);
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

describe("chattiness, autoHumor, rotLevels", () => {
  it("humor is optional when autoHumor is on", () => {
    expect(
      validateStep("humor", { ...EMPTY_PERSONA_FORM, autoHumor: true }),
    ).toEqual({});
    expect(
      validateStep("humor", { ...EMPTY_PERSONA_FORM, autoHumor: false }),
    ).toEqual({ humorTypes: "required" });
  });

  it("omits the chattiness dial at the default, sends it otherwise", () => {
    expect(toPersonaSavePayload(filled())).not.toHaveProperty("chattiness");
    expect(toPersonaSavePayload(filled({ chattiness: 3 }))).not.toHaveProperty("chattiness");
    expect(toPersonaSavePayload(filled({ chattiness: 1 })).chattiness).toBe(1);
    expect(toPersonaSavePayload(filled({ chattiness: 5 })).chattiness).toBe(5);
  });

  it("sends the autoHumor flag and drops humor types when on", () => {
    const payload = toPersonaSavePayload(filled({ autoHumor: true }));
    expect(payload.autoHumor).toBe(true);
    expect(payload).not.toHaveProperty("humorTypes");
    expect(payload).not.toHaveProperty("humorExampleShapes");
  });

  it("sends rot blocks only when all three are authored (and not delegated)", () => {
    // autoRotLevels OFF + empty/partial → not sent; OFF + all three → sent.
    expect(
      toPersonaSavePayload(filled({ autoRotLevels: false })),
    ).not.toHaveProperty("rotLevels");
    expect(
      toPersonaSavePayload(filled({ autoRotLevels: false, rotLevels: ["one", "", "three"] })),
    ).not.toHaveProperty("rotLevels");
    expect(
      toPersonaSavePayload(filled({ autoRotLevels: false, rotLevels: ["one", "two", "three"] }))
        .rotLevels,
    ).toEqual(["one", "two", "three"]);
  });

  it("round-trips the new fields through the payload and back", () => {
    const form = filled({
      chattiness: 2,
      autoHumor: false,
      autoRotLevels: false,
      rotLevels: ["lvl one", "lvl two", "lvl three"],
    });
    const rebuilt = personaInputToFormValues(toPersonaSavePayload(form));
    expect(rebuilt.chattiness).toBe(2);
    expect(rebuilt.rotLevels).toEqual(["lvl one", "lvl two", "lvl three"]);
    // Default dial round-trips as the default (absent → default).
    const def = personaInputToFormValues(toPersonaSavePayload(filled({ chattiness: 3 })));
    expect(def.chattiness).toBe(3);
  });
});
