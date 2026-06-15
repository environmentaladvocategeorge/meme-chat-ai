import {
  DEFAULT_VOICE_BAD,
  isUserPersonaId,
  isUserPersonaDoc,
  newUserPersonaId,
  PLATFORM_SLANG_USAGE_NOTES,
  toPersonaSpec,
  toResolvedPersonaForStream,
  userPersonaCap,
  userPersonaInputSchema,
  MAX_USER_PERSONAS,
  type UserPersonaDoc,
  type UserPersonaInput,
} from "../userPersonas";
import { renderPersonaPromptDoc } from "../personaSpec";

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
  it("caps free at 1 and every paid tier at MAX_USER_PERSONAS", () => {
    expect(userPersonaCap("free")).toBe(1);
    expect(userPersonaCap("basic")).toBe(MAX_USER_PERSONAS);
    expect(userPersonaCap("plus")).toBe(MAX_USER_PERSONAS);
    expect(userPersonaCap("power")).toBe(MAX_USER_PERSONAS);
    expect(MAX_USER_PERSONAS).toBe(10);
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
    // User personas never swap the decider machinery.
    expect(resolved.personaPrompt.mediaDeciderKey).toBeUndefined();
  });
});
