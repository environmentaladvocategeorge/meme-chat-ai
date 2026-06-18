import {
  DEFAULT_PERSONA_ID,
  MAX_USER_PERSONAS,
  mapPersonaDoc,
  personaCap,
  resolvePersonaSlot,
  resolveSelectedPersona,
  type UserPersonaSummary,
} from "../personas";

function summary(overrides: Partial<UserPersonaSummary> = {}): UserPersonaSummary {
  return {
    id: "user_uid-1_a1",
    displayName: "Chill Capybara",
    avatarKey: "capybara",
    shortDescription: "Zen rodent energy",
    toneTags: ["chill"],
    ...overrides,
  };
}

describe("personaCap", () => {
  it("caps free at 1 and every paid tier at MAX_USER_PERSONAS (10)", () => {
    expect(personaCap("free")).toBe(1);
    expect(personaCap("basic")).toBe(MAX_USER_PERSONAS);
    expect(personaCap("plus")).toBe(MAX_USER_PERSONAS);
    expect(personaCap("power")).toBe(MAX_USER_PERSONAS);
    expect(MAX_USER_PERSONAS).toBe(10);
  });
});

describe("resolveSelectedPersona", () => {
  it("returns the default when the default id is selected", () => {
    expect(resolveSelectedPersona(DEFAULT_PERSONA_ID, [])).toEqual({ kind: "default" });
  });

  it("returns the matching user persona when one is selected and present", () => {
    const list = [summary({ id: "user_uid-1_a1" }), summary({ id: "user_uid-1_b2" })];
    const resolved = resolveSelectedPersona("user_uid-1_b2", list);
    expect(resolved).toEqual({ kind: "user", persona: list[1] });
  });

  it("falls back to the default when the selected user persona is missing (e.g. deleted elsewhere)", () => {
    const list = [summary({ id: "user_uid-1_a1" })];
    expect(resolveSelectedPersona("user_uid-1_gone", list)).toEqual({ kind: "default" });
  });

  it("falls back to the default when no personas are hydrated yet", () => {
    expect(resolveSelectedPersona("user_uid-1_a1", [])).toEqual({ kind: "default" });
  });
});

describe("resolvePersonaSlot", () => {
  const list = [summary({ id: "user_uid-1_a1" }), summary({ id: "user_uid-1_b2" })];

  it("treats a missing or default id as the default bot", () => {
    expect(resolvePersonaSlot(undefined, list)).toEqual({ kind: "default" });
    expect(resolvePersonaSlot(DEFAULT_PERSONA_ID, list)).toEqual({ kind: "default" });
  });

  it("returns the matching user persona when present", () => {
    expect(resolvePersonaSlot("user_uid-1_b2", list)).toEqual({
      kind: "user",
      persona: list[1],
    });
  });

  it("returns 'unknown' for a since-deleted bot (NOT the default)", () => {
    expect(resolvePersonaSlot("user_uid-1_gone", list)).toBe("unknown");
  });
});

describe("mapPersonaDoc", () => {
  it("maps a well-formed doc's publicConfig into a summary", () => {
    const doc = {
      ownerUid: "uid-1",
      publicConfig: {
        displayName: "Chill Capybara",
        shortDescription: "Zen rodent energy",
        avatarKey: "capybara",
        toneTags: ["chill", "wholesome"],
      },
    };
    expect(mapPersonaDoc("user_uid-1_a1", doc)).toEqual({
      id: "user_uid-1_a1",
      displayName: "Chill Capybara",
      avatarKey: "capybara",
      shortDescription: "Zen rodent energy",
      toneTags: ["chill", "wholesome"],
    });
  });

  it("maps an uploaded-avatar doc (avatarUrl, no avatarKey)", () => {
    const doc = {
      publicConfig: {
        displayName: "Gym Bro",
        shortDescription: "never skips leg day",
        avatarUrl: "https://example.com/a.jpg",
        toneTags: ["hype"],
      },
    };
    expect(mapPersonaDoc("user_uid-1_c3", doc)).toEqual({
      id: "user_uid-1_c3",
      displayName: "Gym Bro",
      avatarUrl: "https://example.com/a.jpg",
      shortDescription: "never skips leg day",
      toneTags: ["hype"],
    });
  });

  it("maps a doc with no avatar at all (monogram fallback)", () => {
    const doc = {
      publicConfig: { displayName: "Plain", shortDescription: "no pic", toneTags: [] },
    };
    expect(mapPersonaDoc("user_uid-1_d4", doc)).toEqual({
      id: "user_uid-1_d4",
      displayName: "Plain",
      shortDescription: "no pic",
      toneTags: [],
    });
  });

  it("drops a doc with a missing or malformed publicConfig", () => {
    expect(mapPersonaDoc("user_uid-1_a1", undefined)).toBeNull();
    expect(mapPersonaDoc("user_uid-1_a1", {})).toBeNull();
    expect(mapPersonaDoc("user_uid-1_a1", { publicConfig: { displayName: 5 } })).toBeNull();
    expect(
      mapPersonaDoc("user_uid-1_a1", {
        publicConfig: { displayName: "X", shortDescription: "y", avatarKey: "z", toneTags: "no" },
      }),
    ).toBeNull();
  });

  it("coerces missing toneTags to an empty array and keeps only string tags", () => {
    const doc = {
      publicConfig: {
        displayName: "X",
        shortDescription: "y",
        avatarKey: "z",
        toneTags: ["a", 5, "b"],
      },
    };
    expect(mapPersonaDoc("id", doc)?.toneTags).toEqual(["a", "b"]);
  });
});
