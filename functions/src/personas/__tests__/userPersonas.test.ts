import {
  DEFAULT_VOICE_BAD,
  isUserPersonaId,
  isUserPersonaDoc,
  newUserPersonaId,
  PLATFORM_SLANG_USAGE_NOTES,
  toPersonaSpec,
  toResolvedPersonaForStream,
  userPersonaCap,
  isUserPersonaCapUnlimited,
  userPersonaInputSchema,
  MAX_USER_PERSONAS,
  type UserPersonaDoc,
  type UserPersonaInput,
} from "../userPersonas";
import { renderPersonaPromptDoc } from "../personaSpec";
import {
  DEFAULT_ROT_EMOJI_LINES,
  DEFAULT_USER_ROT_LEVELS,
} from "../rotLevel";
import { assembleFragments } from "../fragments";

// A complete, in-bounds builder payload — the baseline every schema test
// mutates from.
function validInput(): UserPersonaInput {
  return {
    displayName: "Chill Capybara",
    identity: "A laid-back capybara who vibes through every crisis.",
    voiceExample: {
      user: "my code broke again",
      good: "bro the code said nah. show me the error, we fix it zen style",
    },
    signatureMove: "Ends a hype reply with one spa-day metaphor.",
    greetingShapes: ["yo what's good", "capy hours, talk to me"],
    humorTypes: ["deadpan", "wholesome chaos"],
    humorExampleShapes: ["that's rough buddy, anyway hydrate"],
    slang: {
      termGlosses: "vibe check = quick mood read. no cap = honestly.",
    },
    emojiPalette: ["🦫", "🧘", "💀"],
    media: {
      pills: ["capybara chilling", "spa day"],
      lean: "wholesome reactions, eager on cozy turns",
    },
    publicConfig: {
      shortDescription: "Zen rodent energy",
      avatarKey: "capybara",
      toneTags: ["chill"],
    },
  };
}

describe("userPersonaInputSchema", () => {
  it("accepts a complete valid input", () => {
    const parsed = userPersonaInputSchema.safeParse(validInput());
    expect(parsed.success).toBe(true);
  });

  it("accepts a minimal input without optional fields", () => {
    const input: Record<string, unknown> = validInput();
    delete input.signatureMove;
    delete input.media;
    const parsed = userPersonaInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
  });

  it("rejects first-party-only fields: houseExtras, lexicalRule, media.deciderKey", () => {
    const withExtras = { ...validInput(), houseExtras: [{ key: "x", text: "y" }] };
    expect(userPersonaInputSchema.safeParse(withExtras).success).toBe(false);

    const withLexical = { ...validInput(), lexicalRule: "always say goblin" };
    expect(userPersonaInputSchema.safeParse(withLexical).success).toBe(false);

    const base = validInput();
    const withDecider = {
      ...base,
      media: { ...base.media, deciderKey: "minimal_decider" },
    };
    expect(userPersonaInputSchema.safeParse(withDecider).success).toBe(false);
  });

  it("rejects an over-length identity", () => {
    const input = { ...validInput(), identity: "x".repeat(601) };
    expect(userPersonaInputSchema.safeParse(input).success).toBe(false);
  });

  it("accepts up to 10 media pills but rejects 11", () => {
    const ten = Array.from({ length: 10 }, (_, i) => `gym gif ${i}`);
    expect(
      userPersonaInputSchema.safeParse({ ...validInput(), media: { pills: ten } }).success,
    ).toBe(true);
    expect(
      userPersonaInputSchema.safeParse({
        ...validInput(),
        media: { pills: [...ten, "one too many"] },
      }).success,
    ).toBe(false);
  });

  it("rejects empty greetingShapes", () => {
    const input = { ...validInput(), greetingShapes: [] };
    expect(userPersonaInputSchema.safeParse(input).success).toBe(false);
  });

  it("trims string fields", () => {
    const input = { ...validInput(), displayName: "  Chill Capybara  " };
    const parsed = userPersonaInputSchema.parse(input);
    expect(parsed.displayName).toBe("Chill Capybara");
  });

  it("rejects whitespace-only required fields", () => {
    const input = { ...validInput(), identity: "   " };
    expect(userPersonaInputSchema.safeParse(input).success).toBe(false);
  });

  it("accepts input with no voiceExample and no slang (both optional, seeded server-side)", () => {
    const input: Record<string, unknown> = validInput();
    delete input.voiceExample;
    delete input.slang;
    delete input.publicConfig; // re-add a clean publicConfig below
    (input as { publicConfig: unknown }).publicConfig = {
      shortDescription: "Zen rodent energy",
      toneTags: ["chill"],
    };
    expect(userPersonaInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects the seeded-only fields voiceExample.bad and slang.usageNotes (never user-authored)", () => {
    const base = validInput();
    const withBad = {
      ...base,
      voiceExample: { user: "x", good: "y", bad: "z" },
    };
    expect(userPersonaInputSchema.safeParse(withBad).success).toBe(false);

    const withUsageNotes = {
      ...base,
      slang: { termGlosses: "a = b", usageNotes: "anything goes" },
    };
    expect(userPersonaInputSchema.safeParse(withUsageNotes).success).toBe(false);
  });

  it("accepts the plural voiceExamples array (up to 5) and an empty emoji palette", () => {
    const input: Record<string, unknown> = { ...validInput() };
    delete input.voiceExample;
    input.voiceExamples = [
      { user: "a", good: "b" },
      { user: "c", good: "d" },
    ];
    input.emojiPalette = [];
    expect(userPersonaInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects more than 5 voiceExamples", () => {
    const input: Record<string, unknown> = { ...validInput() };
    delete input.voiceExample;
    input.voiceExamples = Array.from({ length: 6 }, (_, i) => ({ user: `u${i}`, good: `g${i}` }));
    expect(userPersonaInputSchema.safeParse(input).success).toBe(false);
  });

  it("allows empty greetingShapes only when autoGreet is on", () => {
    const off = { ...validInput(), greetingShapes: [] };
    expect(userPersonaInputSchema.safeParse(off).success).toBe(false);
    const on = { ...validInput(), greetingShapes: [], autoGreet: true };
    expect(userPersonaInputSchema.safeParse(on).success).toBe(true);
  });

  it("treats avatarKey as optional (user personas upload an avatar instead)", () => {
    const input = validInput();
    const publicConfig: Record<string, unknown> = { ...input.publicConfig };
    delete publicConfig.avatarKey;
    expect(
      userPersonaInputSchema.safeParse({ ...input, publicConfig }).success,
    ).toBe(true);
  });
});

describe("userPersonaCap", () => {
  it("scales the cap per tier: free 3, basic 10, plus 100, power unlimited", () => {
    expect(userPersonaCap("free")).toBe(3);
    expect(userPersonaCap("basic")).toBe(10);
    expect(userPersonaCap("plus")).toBe(100);
    expect(userPersonaCap("power")).toBe(Number.POSITIVE_INFINITY);
    // MAX_USER_PERSONAS is the largest FINITE cap (power is unlimited).
    expect(MAX_USER_PERSONAS).toBe(100);
  });

  it("flags only the power tier as unlimited", () => {
    expect(isUserPersonaCapUnlimited("free")).toBe(false);
    expect(isUserPersonaCapUnlimited("basic")).toBe(false);
    expect(isUserPersonaCapUnlimited("plus")).toBe(false);
    expect(isUserPersonaCapUnlimited("power")).toBe(true);
  });
});

describe("user persona ids", () => {
  it("isUserPersonaId recognizes the user_ prefix", () => {
    expect(isUserPersonaId("user_abc123_x1")).toBe(true);
    expect(isUserPersonaId("brainrot_bot_default")).toBe(false);
    expect(isUserPersonaId("")).toBe(false);
  });

  it("newUserPersonaId embeds the owner uid and is user-prefixed", () => {
    const id = newUserPersonaId("uid-1");
    expect(isUserPersonaId(id)).toBe(true);
    expect(id).toContain("uid-1");
    expect(newUserPersonaId("uid-1")).not.toBe(id);
  });
});

describe("toPersonaSpec", () => {
  it("maps every user-authorable slot and forces the server-side id", () => {
    const spec = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(validInput()));
    expect(spec.id).toBe("user_uid-1_a1");
    expect(spec.displayName).toBe("Chill Capybara");
    expect(spec.identity).toContain("capybara");
    expect(spec.media?.pills).toEqual(["capybara chilling", "spa day"]);
    expect(spec.media?.lean).toContain("wholesome");
  });

  it("never carries first-party-only machinery", () => {
    const spec = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(validInput()));
    expect(spec.houseExtras).toBeUndefined();
    expect(spec.lexicalRule).toBeUndefined();
    expect(spec.media?.deciderKey).toBeUndefined();
    // And the rendered doc therefore never points at a custom decider.
    const rendered = renderPersonaPromptDoc(spec);
    expect(rendered.mediaDeciderKey).toBeUndefined();
    expect(rendered.mediaNotes).toContain("capybara chilling");
  });

  it("accepts media.picks (preview URLs for edit) but never leaks them into the prompt", () => {
    const input = {
      ...validInput(),
      media: {
        pills: ["capybara chilling", "spa day"],
        picks: [
          { name: "capybara chilling", previewUrl: "https://cdn.klipy.test/a.gif" },
          { name: "spa day", previewUrl: "https://cdn.klipy.test/b.gif" },
        ],
      },
    };
    const parsed = userPersonaInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);

    // picks is an edit-UI sidecar only — the spec (and therefore the rendered
    // prompt notes) carry the pill NAMES, never the URLs.
    const spec = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(input));
    expect(spec.media?.pills).toEqual(["capybara chilling", "spa day"]);
    expect((spec.media as Record<string, unknown>)?.picks).toBeUndefined();
    const rendered = renderPersonaPromptDoc(spec);
    expect(rendered.mediaNotes).not.toContain("cdn.klipy.test");
  });

  it("seeds the persona-dropped bad example and the platform usage boundary", () => {
    const spec = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(validInput()));
    // The positive example is the user's; the bad example and slang usage
    // boundary are server-seeded, never from input.
    expect(spec.voiceExample.good).toContain("zen style");
    expect(spec.voiceExample.bad).toBe(DEFAULT_VOICE_BAD);
    expect(spec.slang.usageNotes).toBe(PLATFORM_SLANG_USAGE_NOTES);
    expect(spec.slang.termGlosses).toContain("vibe check");
  });

  it("still produces a complete, renderable spec when voiceExample/slang are omitted", () => {
    const input = validInput();
    const bare: Record<string, unknown> = { ...input };
    delete bare.voiceExample;
    delete bare.slang;
    const spec = toPersonaSpec(
      "user_uid-1_a1",
      userPersonaInputSchema.parse(bare),
    );
    expect(spec.voiceExample.user.length).toBeGreaterThan(0);
    expect(spec.voiceExample.good.length).toBeGreaterThan(0);
    expect(spec.voiceExample.bad).toBe(DEFAULT_VOICE_BAD);
    expect(spec.slang.usageNotes).toBe(PLATFORM_SLANG_USAGE_NOTES);
    // Renders without throwing on the sparse spec.
    expect(() => renderPersonaPromptDoc(spec)).not.toThrow();
  });

  it("renders extra voice examples, an auto-greet line, and drops the emoji section when empty", () => {
    const input: Record<string, unknown> = { ...validInput() };
    delete input.voiceExample;
    input.voiceExamples = [
      { user: "first q", good: "first reply" },
      { user: "second q", good: "second reply" },
    ];
    input.emojiPalette = [];
    input.greetingShapes = [];
    input.autoGreet = true;
    const spec = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(input));
    expect(spec.voiceExample.good).toBe("first reply");
    expect(spec.voiceExtraExamples).toEqual([{ user: "second q", good: "second reply" }]);
    expect(spec.autoGreet).toBe(true);
    expect(spec.emojiPalette).toEqual([]);

    const rendered = renderPersonaPromptDoc(spec);
    const text = rendered.fragments.fragments.map((f) => ("text" in f ? f.text : "")).join("\n");
    expect(text).toContain("second reply");
    expect(text).toContain("write your own greetings");
    // No EMOJI section header when the palette is empty.
    expect(text).not.toContain("\nEMOJI\n");
  });
});

describe("toPersonaSpec — chattiness, rot levels, slang, humor", () => {
  it("carries the chattiness dial when set, leaves it absent otherwise", () => {
    const withDial = toPersonaSpec(
      "user_uid-1_a1",
      userPersonaInputSchema.parse({ ...validInput(), chattiness: 1 }),
    );
    expect(withDial.chattiness).toBe(1);
    const without = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(validInput()));
    expect(without.chattiness).toBeUndefined();
  });

  it("gives a persona the generic default dial, never the built-in Brainrot dial", () => {
    const spec = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(validInput()));
    expect(spec.rotLevels).toEqual(DEFAULT_USER_ROT_LEVELS);
    // The default dial resolves to persona-neutral copy, not Brainrot's examples.
    const rot = assembleFragments(renderPersonaPromptDoc(spec).fragments, {
      level: 2,
      emojisEnabled: true,
    });
    expect(rot).toContain("ROT LEVEL: 2/3 — DEFAULT");
    expect(rot).not.toContain("first of all, ts tuff");
  });

  it("uses the persona's own authored rot blocks with the house emoji density", () => {
    const input = {
      ...validInput(),
      rotLevels: ["calm capy energy", "vibing capy", "MAXIMUM CAPY CHAOS"],
    };
    const spec = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(input));
    expect(spec.rotLevels?.blocks[3]).toContain("MAXIMUM CAPY CHAOS");
    // The emoji-density placeholder is appended so the on/off override slots in.
    expect(spec.rotLevels?.blocks[1]).toContain("{{EMOJI_LINE}}");
    expect(spec.rotLevels?.emojiLines).toEqual(DEFAULT_ROT_EMOJI_LINES);
  });

  it("formats the structured slang glossary into the gloss paragraph", () => {
    const input = {
      ...validInput(),
      slang: {
        terms: [
          { term: "cooked", meaning: "done for" },
          { term: "locked in", meaning: "focused" },
        ],
      },
    };
    const spec = toPersonaSpec("user_uid-1_a1", userPersonaInputSchema.parse(input));
    expect(spec.slang.termGlosses).toBe('"cooked" = done for; "locked in" = focused');
  });

  it("skips humor when autoHumor is on, leaning on the persona's own judgment", () => {
    const input: Record<string, unknown> = { ...validInput() };
    delete input.humorTypes;
    delete input.humorExampleShapes;
    input.autoHumor = true;
    const parsed = userPersonaInputSchema.parse(input);
    const spec = toPersonaSpec("user_uid-1_a1", parsed);
    expect(spec.humorTypes).toEqual([]);
    const text = renderPersonaPromptDoc(spec)
      .fragments.fragments.map((f) => ("text" in f ? f.text : ""))
      .join("\n");
    expect(text).toContain("Lean on your own sense of humor");
    expect(text).not.toContain("Humor types:");
  });

  it("rejects empty humor when autoHumor is off", () => {
    const input: Record<string, unknown> = { ...validInput(), humorTypes: [] };
    expect(userPersonaInputSchema.safeParse(input).success).toBe(false);
  });
});

function validDoc(): UserPersonaDoc {
  const input = userPersonaInputSchema.parse(validInput());
  const rendered = renderPersonaPromptDoc(toPersonaSpec("user_uid-1_a1", input));
  return {
    id: "user_uid-1_a1",
    ownerUid: "uid-1",
    input,
    publicConfig: {
      displayName: input.displayName,
      shortDescription: input.publicConfig.shortDescription,
      avatarKey: input.publicConfig.avatarKey,
      toneTags: input.publicConfig.toneTags,
    },
    fragments: rendered.fragments,
    ...(rendered.mediaNotes ? { mediaNotes: rendered.mediaNotes } : {}),
    isEnabled: true,
    moderation: { certainty: 0.92, gates: ["openai_moderation", "hate_speech", "nano_sanity"] },
  };
}

describe("isUserPersonaDoc", () => {
  it("accepts a valid stored doc", () => {
    expect(isUserPersonaDoc(validDoc())).toBe(true);
  });

  it("rejects docs with missing or malformed core fields", () => {
    expect(isUserPersonaDoc(undefined)).toBe(false);
    expect(isUserPersonaDoc({})).toBe(false);
    expect(isUserPersonaDoc({ ...validDoc(), ownerUid: 5 })).toBe(false);
    expect(isUserPersonaDoc({ ...validDoc(), isEnabled: "yes" })).toBe(false);
    expect(isUserPersonaDoc({ ...validDoc(), fragments: { fragmentsVersion: 1 } })).toBe(false);
    const noPublic = validDoc() as Record<string, unknown>;
    delete noPublic.publicConfig;
    expect(isUserPersonaDoc(noPublic)).toBe(false);
  });

  it("rejects a malformed mediaNotes but accepts an absent one", () => {
    expect(isUserPersonaDoc({ ...validDoc(), mediaNotes: 5 })).toBe(false);
    const noNotes = validDoc() as Record<string, unknown>;
    delete noNotes.mediaNotes;
    expect(isUserPersonaDoc(noNotes)).toBe(true);
  });

  it("accepts a doc with an uploaded avatar and no avatarKey", () => {
    const doc = validDoc();
    const publicConfig = { ...doc.publicConfig } as Record<string, unknown>;
    delete publicConfig.avatarKey;
    publicConfig.avatarUrl = "https://example.com/a.jpg";
    publicConfig.avatarPath = "personaAvatars/uid-1/a.jpg";
    expect(isUserPersonaDoc({ ...doc, publicConfig })).toBe(true);
  });

  it("rejects a doc whose avatarUrl is malformed", () => {
    const doc = validDoc();
    const publicConfig = { ...doc.publicConfig, avatarUrl: 5 };
    expect(isUserPersonaDoc({ ...doc, publicConfig })).toBe(false);
  });
});

describe("toResolvedPersonaForStream", () => {
  it("synthesizes the Persona + PersonaPrompt pair the stream path expects", () => {
    const doc = validDoc();
    const resolved = toResolvedPersonaForStream(doc);

    expect(resolved.persona.id).toBe(doc.id);
    expect(resolved.persona.isDefault).toBe(false);
    expect(resolved.persona.isEnabled).toBe(true);
    expect(resolved.persona.publicConfig).toEqual(doc.publicConfig);

    expect(resolved.personaPrompt.personaId).toBe(doc.id);
    expect(resolved.personaPrompt.fragments).toBe(doc.fragments);
    expect(resolved.personaPrompt.isActive).toBe(true);
    expect(resolved.personaPrompt.mediaNotes).toBe(doc.mediaNotes);
    // User personas run the persona-tuned decider (favorites-first, no brainrot
    // bank). The key is set here in resolution, never stored on the doc / from
    // user input, so the first-party-only contract holds.
    expect(resolved.personaPrompt.mediaDeciderKey).toBe("media_decider_persona");
  });
});
