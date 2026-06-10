jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(),
}));

import { getFirestore } from "firebase-admin/firestore";
import {
  buildMediaDeciderPrompt,
  buildSystemPromptForStream,
  DEFAULT_PERSONA_ID,
  MEDIA_DECIDER_KEY,
} from "../prompts";

type Doc = Record<string, unknown>;
type Collections = Record<string, Record<string, Doc>>;

function makeDb(collections: Collections) {
  const collection = (name: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        exists: Boolean(collections[name]?.[id]),
        data: () => collections[name]?.[id],
      }),
    }),
    where: (field: string, op: string, value: unknown) =>
      makeQuery(collections, name).where(field, op, value),
  });

  return { collection };
}

function makeQuery(collections: Collections, name: string) {
  let docs = Object.values(collections[name] ?? {});

  const query = {
    where(field: string, op: string, value: unknown) {
      if (op !== "==") throw new Error(`unsupported-op-${op}`);
      docs = docs.filter((doc) => doc[field] === value);
      return query;
    },
    orderBy(field: string, direction: "asc" | "desc") {
      docs = docs.slice().sort((a, b) => {
        const left = Number(a[field] ?? 0);
        const right = Number(b[field] ?? 0);
        return direction === "desc" ? right - left : left - right;
      });
      return query;
    },
    limit(count: number) {
      docs = docs.slice(0, count);
      return query;
    },
    async get() {
      return {
        docs: docs.map((doc) => ({
          data: () => doc,
        })),
      };
    },
  };

  return query;
}

// Wraps prompt text as a minimal valid fragments payload — every prompt doc
// carries its body this way; there is no monolithic `content` field anymore.
function fragmentsOf(...texts: string[]) {
  return {
    fragmentsVersion: 1,
    joinWith: "\n\n",
    fragments: texts.map((text, i) => ({ key: `f${i}`, text })),
  };
}

function persona(id: string, overrides: Partial<Doc> = {}): Doc {
  return {
    id,
    name: id === DEFAULT_PERSONA_ID ? "Brainrot Bot" : "Other",
    slug: id,
    description: "Persona description",
    isDefault: id === DEFAULT_PERSONA_ID,
    isEnabled: true,
    addedBy: "test",
    publicConfig: {
      displayName: id === DEFAULT_PERSONA_ID ? "Brainrot Bot" : "Other",
      shortDescription: "Short",
      avatarKey: id,
      toneTags: ["test"],
    },
    ...overrides,
  };
}

function personaPrompt(id: string, personaId: string, body: string, createdAt = 1): Doc {
  return {
    id,
    personaId,
    name: id,
    version: "1.0.0",
    // Body text + the dynamic rot-level block, like the real Firestore doc.
    fragments: {
      fragmentsVersion: 1,
      joinWith: "\n\n",
      fragments: [
        { key: "body", text: body },
        { key: "rot_level_block", dynamic: "rot_level_block" },
      ],
    },
    isActive: true,
    createdAt,
    addedBy: "test",
    notes: "test",
  };
}

function platformPrompt(
  guardrails = "PLATFORM",
  createdAt = 1,
  mediaContent?: string,
): Doc {
  return {
    id: "platform_guardrails_v1",
    name: "Platform Guardrails",
    key: "platform_guardrails",
    version: "1.0.0",
    fragments: fragmentsOf(guardrails),
    ...(mediaContent !== undefined ? { mediaContent } : {}),
    isActive: true,
    createdAt,
    addedBy: "test",
    notes: "test",
  };
}

// The media-decider instruction doc (separate platform_prompts record, keyed
// media_decider) — the picker body/bank, distinct from the guardrails.
function deciderPrompt(body = "DECIDER-BODY", createdAt = 1): Doc {
  return {
    id: "media_decider_v1",
    name: "Media Decider",
    key: MEDIA_DECIDER_KEY,
    version: "1.0.0",
    fragments: fragmentsOf(body),
    isActive: true,
    createdAt,
    addedBy: "test",
    notes: "test",
  };
}

function setDb(collections: Collections) {
  jest.mocked(getFirestore).mockReturnValue(makeDb(collections) as never);
}

describe("persona prompt resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses Brainrot Bot default when no personaId is provided", async () => {
    setDb({
      platform_prompts: { platform_guardrails_v1: platformPrompt("PLATFORM") },
      personas: { [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID) },
      persona_prompts: {
        brainrot_bot_default_v1: personaPrompt("brainrot_bot_default_v1", DEFAULT_PERSONA_ID, "BRAINROT"),
      },
    });

    const result = await buildSystemPromptForStream();

    expect(result.persona.id).toBe(DEFAULT_PERSONA_ID);
    // Platform guardrails first, then the persona prompt, then the active
    // rot-level block (level 2 by default, from the dynamic fragment).
    expect(result.systemPrompt).toContain(
      "PLATFORM\n\nActive persona prompt:\nBRAINROT",
    );
    expect(result.systemPrompt).toContain("ROT LEVEL: 2/3 — ROTTED DEFAULT");
  });

  it("resolves a valid enabled personaId", async () => {
    setDb({
      platform_prompts: { platform_guardrails_v1: platformPrompt("PLATFORM") },
      personas: {
        [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID),
        other: persona("other", { isDefault: false }),
      },
      persona_prompts: {
        other_v1: personaPrompt("other_v1", "other", "OTHER"),
        brainrot_bot_default_v1: personaPrompt("brainrot_bot_default_v1", DEFAULT_PERSONA_ID, "BRAINROT"),
      },
    });

    const result = await buildSystemPromptForStream("other");

    expect(result.persona.id).toBe("other");
    expect(result.systemPrompt).toContain("Active persona prompt:\nOTHER");
  });

  it("falls back to the default persona for an invalid personaId", async () => {
    setDb({
      platform_prompts: { platform_guardrails_v1: platformPrompt("PLATFORM") },
      personas: { [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID) },
      persona_prompts: {
        brainrot_bot_default_v1: personaPrompt("brainrot_bot_default_v1", DEFAULT_PERSONA_ID, "BRAINROT"),
      },
    });

    const result = await buildSystemPromptForStream("missing");

    expect(result.persona.id).toBe(DEFAULT_PERSONA_ID);
    expect(result.systemPrompt).toContain("BRAINROT");
  });

  it("falls back to the default persona for a disabled personaId", async () => {
    setDb({
      platform_prompts: { platform_guardrails_v1: platformPrompt("PLATFORM") },
      personas: {
        [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID),
        disabled: persona("disabled", { isDefault: false, isEnabled: false }),
      },
      persona_prompts: {
        disabled_v1: personaPrompt("disabled_v1", "disabled", "DISABLED"),
        brainrot_bot_default_v1: personaPrompt("brainrot_bot_default_v1", DEFAULT_PERSONA_ID, "BRAINROT"),
      },
    });

    const result = await buildSystemPromptForStream("disabled");

    expect(result.persona.id).toBe(DEFAULT_PERSONA_ID);
    expect(result.systemPrompt).not.toContain("DISABLED");
  });

  it("throws when no active platform prompt exists — Firestore is the source of truth", async () => {
    setDb({
      platform_prompts: {},
      personas: { [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID) },
      persona_prompts: {
        brainrot_bot_default_v1: personaPrompt("brainrot_bot_default_v1", DEFAULT_PERSONA_ID, "BRAINROT"),
      },
    });

    await expect(buildSystemPromptForStream()).rejects.toThrow(
      /platform_guardrails/,
    );
  });

  it("throws when no active persona prompt exists", async () => {
    setDb({
      platform_prompts: { platform_guardrails_v1: platformPrompt("PLATFORM") },
      personas: { [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID) },
      persona_prompts: {},
    });

    await expect(buildSystemPromptForStream()).rejects.toThrow(
      /no active persona prompt/,
    );
  });

  it("throws when no enabled persona exists at all", async () => {
    setDb({
      platform_prompts: { platform_guardrails_v1: platformPrompt("PLATFORM") },
      personas: {},
      persona_prompts: {},
    });

    await expect(buildSystemPromptForStream()).rejects.toThrow(
      /no enabled persona/,
    );
  });

  it("rejects a persona prompt doc whose fragments are malformed", async () => {
    const bad = personaPrompt("bad", DEFAULT_PERSONA_ID, "BAD");
    (bad as { fragments: unknown }).fragments = { fragmentsVersion: 1 };
    setDb({
      platform_prompts: { platform_guardrails_v1: platformPrompt("PLATFORM") },
      personas: { [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID) },
      persona_prompts: { bad },
    });

    await expect(buildSystemPromptForStream()).rejects.toThrow(
      /no active persona prompt/,
    );
  });

  it("composes platform guardrails before persona prompt", async () => {
    setDb({
      platform_prompts: {
        old_platform: platformPrompt("OLD", 1),
        new_platform: platformPrompt("NEW", 2),
      },
      personas: { [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID) },
      persona_prompts: {
        old_prompt: personaPrompt("old_prompt", DEFAULT_PERSONA_ID, "OLD-PERSONA", 1),
        new_prompt: personaPrompt("new_prompt", DEFAULT_PERSONA_ID, "NEW-PERSONA", 2),
      },
    });

    const result = await buildSystemPromptForStream();

    expect(result.systemPrompt.indexOf("NEW")).toBeLessThan(
      result.systemPrompt.indexOf("NEW-PERSONA"),
    );
    expect(result.systemPrompt).not.toContain("OLD-PERSONA");
  });

  it("persona path uses the guardrails fragments, never `mediaContent`", async () => {
    setDb({
      platform_prompts: {
        platform_guardrails_v1: platformPrompt("PERSONA-GUARDS", 1, "MEDIA-GUARDS"),
      },
      personas: { [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID) },
      persona_prompts: {
        p: personaPrompt("p", DEFAULT_PERSONA_ID, "BRAINROT"),
      },
    });

    const result = await buildSystemPromptForStream();
    expect(result.systemPrompt).toContain("PERSONA-GUARDS");
    expect(result.systemPrompt).not.toContain("MEDIA-GUARDS");
  });

  it("returns only safe persona metadata next to the backend-only prompt", async () => {
    setDb({
      platform_prompts: { platform_guardrails_v1: platformPrompt("SECRET PLATFORM") },
      personas: { [DEFAULT_PERSONA_ID]: persona(DEFAULT_PERSONA_ID) },
      persona_prompts: {
        brainrot_bot_default_v1: personaPrompt(
          "brainrot_bot_default_v1",
          DEFAULT_PERSONA_ID,
          "SECRET PERSONA",
        ),
      },
    });

    const result = await buildSystemPromptForStream();
    const personaJson = JSON.stringify(result.persona);

    expect(personaJson).not.toContain("SECRET PLATFORM");
    expect(personaJson).not.toContain("SECRET PERSONA");
    expect(result.systemPrompt).toContain("SECRET PLATFORM");
    expect(result.systemPrompt).toContain("SECRET PERSONA");
  });
});

describe("media decider prompt resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("composes mediaContent guardrails + decider fragments + rot line (not persona guardrails)", async () => {
    setDb({
      platform_prompts: {
        platform_guardrails_v1: platformPrompt("PERSONA-GUARDS", 1, "MEDIA-GUARDS"),
        media_decider_v1: deciderPrompt("DECIDER-BODY"),
      },
    });

    const out = await buildMediaDeciderPrompt(2);
    expect(out).toContain("MEDIA-GUARDS");
    expect(out).toContain("DECIDER-BODY");
    expect(out).toContain("Current rot level: 2/3");
    // The decider must NOT receive the persona path's guardrails.
    expect(out).not.toContain("PERSONA-GUARDS");
    // Order: guardrails before the decider body.
    expect(out.indexOf("MEDIA-GUARDS")).toBeLessThan(out.indexOf("DECIDER-BODY"));
  });

  it("varies the rot line by level", async () => {
    setDb({
      platform_prompts: {
        platform_guardrails_v1: platformPrompt("P", 1, "M"),
        media_decider_v1: deciderPrompt("D"),
      },
    });
    expect(await buildMediaDeciderPrompt(1)).toContain("Current rot level: 1/3");
    expect(await buildMediaDeciderPrompt(3)).toContain("Current rot level: 3/3");
  });

  it("throws when the platform doc is missing", async () => {
    setDb({ platform_prompts: { media_decider_v1: deciderPrompt("D") } });
    await expect(buildMediaDeciderPrompt()).rejects.toThrow(/mediaContent/);
  });

  it("throws when the mediaContent field is absent", async () => {
    // Platform doc exists but carries only the persona guardrails fragments.
    setDb({
      platform_prompts: {
        platform_guardrails_v1: platformPrompt("PERSONA-ONLY"),
        media_decider_v1: deciderPrompt("D"),
      },
    });
    await expect(buildMediaDeciderPrompt()).rejects.toThrow(/mediaContent/);
  });

  it("throws when the decider doc is missing", async () => {
    setDb({
      platform_prompts: {
        platform_guardrails_v1: platformPrompt("P", 1, "MEDIA-GUARDS"),
      },
    });
    await expect(buildMediaDeciderPrompt()).rejects.toThrow(
      /media_decider/,
    );
  });
});
