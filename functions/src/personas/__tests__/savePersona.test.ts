jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(),
  FieldValue: { serverTimestamp: () => "SERVER_TS" },
  Timestamp: { fromMillis: (ms: number) => ({ ms }) },
}));
jest.mock("../../moderation/logFlaggedContent", () => ({
  logFlaggedContent: jest.fn().mockResolvedValue(undefined),
}));

import { HttpsError } from "firebase-functions/v2/https";
import { logFlaggedContent } from "../../moderation/logFlaggedContent";
import type { PersonaModerationResult } from "../../moderation/personaModeration";
import {
  deletePersonaForUser,
  savePersonaForUser,
  type SavePersonaDeps,
} from "../savePersona";
import type { UserPersonaInput } from "../userPersonas";

type Doc = Record<string, unknown>;

// In-memory user_personas backing a minimal Firestore surface: doc get/set/
// delete, an ownerUid equality query, and transactions whose tx.get accepts
// either shape — everything savePersona touches.
function makeDb(initial: Record<string, Doc>) {
  const docs = new Map(Object.entries(initial));
  const setCalls: Array<{ id: string; data: Doc }> = [];
  const deleteCalls: string[] = [];

  const makeRef = (id: string) => ({
    kind: "ref" as const,
    id,
    get: async () => snapOf(id),
    set: async (data: Doc) => {
      docs.set(id, data);
      setCalls.push({ id, data });
    },
    delete: async () => {
      docs.delete(id);
      deleteCalls.push(id);
    },
  });

  const snapOf = (id: string) => ({
    exists: docs.has(id),
    data: () => docs.get(id),
  });

  const makeQuery = (filters: Array<[string, unknown]>) => ({
    kind: "query" as const,
    where: (field: string, op: string, value: unknown) => {
      if (op !== "==") throw new Error(`unsupported-op-${op}`);
      return makeQuery([...filters, [field, value]]);
    },
    get: async () => {
      const matched = [...docs.values()].filter((d) =>
        filters.every(([f, v]) => d[f] === v),
      );
      return { docs: matched.map((d) => ({ data: () => d })), size: matched.length };
    },
  });

  const db = {
    collection: (name: string) => {
      if (name !== "user_personas") throw new Error(`unexpected-collection-${name}`);
      return {
        doc: (id: string) => makeRef(id),
        where: (field: string, op: string, value: unknown) =>
          makeQuery([]).where(field, op, value),
      };
    },
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const tx = {
        get: async (refOrQuery: { kind: "ref" | "query"; id?: string; get: () => Promise<unknown> }) =>
          refOrQuery.get(),
        set: (ref: { id: string }, data: Doc) => {
          docs.set(ref.id, data);
          setCalls.push({ id: ref.id, data });
        },
      };
      return fn(tx);
    },
  };

  return { db, docs, setCalls, deleteCalls };
}

function validInput(): UserPersonaInput {
  return {
    displayName: "Chill Capybara",
    identity: "A laid-back capybara who vibes through every crisis.",
    voiceExample: {
      user: "my code broke again",
      bad: "I'm sorry to hear that. Let's break it down step by step.",
      good: "bro the code said nah. show me the error, we fix it zen style",
    },
    greetingShapes: ["yo what's good"],
    humorTypes: ["deadpan"],
    humorExampleShapes: ["that's rough buddy, anyway hydrate"],
    slang: {
      termGlosses: "vibe check = quick mood read.",
      usageNotes: "Roast choices, never identities.",
    },
    emojiPalette: ["🦫"],
    media: { pills: ["capybara chilling"], lean: "wholesome reactions" },
    publicConfig: {
      shortDescription: "Zen rodent energy",
      avatarKey: "capybara",
      toneTags: ["chill"],
    },
  };
}

const passResult: PersonaModerationResult = {
  pass: true,
  certainty: 0.91,
  gates: [
    { gate: "openai_moderation", pass: true, certainty: 0.95 },
    { gate: "hate_speech", pass: true, certainty: 1 },
    { gate: "nano_sanity", pass: true, certainty: 0.91 },
  ],
  retryable: false,
  nanoUsage: null,
};

const contentFailResult: PersonaModerationResult = {
  pass: false,
  certainty: 0.97,
  gates: [
    { gate: "openai_moderation", pass: false, certainty: 0.97, reason: "sexual" },
  ],
  retryable: false,
  nanoUsage: null,
};

const retryableFailResult: PersonaModerationResult = {
  pass: false,
  certainty: 0,
  gates: [
    {
      gate: "openai_moderation",
      pass: false,
      certainty: 0,
      reason: "openai_moderation_error",
    },
  ],
  retryable: true,
  nanoUsage: null,
};

// An existing stored persona owned by `ownerUid`, count-relevant for caps.
function storedPersona(id: string, ownerUid: string): Doc {
  return { id, ownerUid, isEnabled: true };
}

function makeDeps(
  initial: Record<string, Doc>,
  moderationResult: PersonaModerationResult = passResult,
) {
  const { db, docs, setCalls, deleteCalls } = makeDb(initial);
  const moderate = jest.fn().mockResolvedValue(moderationResult);
  const deps: SavePersonaDeps = { db: db as never, moderate };
  return { deps, moderate, docs, setCalls, deleteCalls };
}

async function expectHttpsError(
  promise: Promise<unknown>,
  code: string,
  message?: string,
): Promise<HttpsError> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(HttpsError);
  const httpsError = caught as HttpsError;
  expect(httpsError.code).toBe(code);
  if (message) expect(httpsError.message).toBe(message);
  return httpsError;
}

describe("savePersonaForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a persona: rendered doc written, id returned, moderation metadata stored", async () => {
    const { deps, setCalls } = makeDeps({});

    const result = await savePersonaForUser("uid-1", "free", { persona: validInput() }, deps);

    expect(result.personaId.startsWith("user_uid-1_")).toBe(true);
    expect(result.publicConfig.displayName).toBe("Chill Capybara");

    expect(setCalls).toHaveLength(1);
    const written = setCalls[0].data;
    expect(written.id).toBe(result.personaId);
    expect(written.ownerUid).toBe("uid-1");
    expect(written.isEnabled).toBe(true);
    expect(written.createdAt).toBe("SERVER_TS");
    expect(written.updatedAt).toBe("SERVER_TS");
    expect(written.moderation).toEqual({
      certainty: 0.91,
      gates: ["openai_moderation", "hate_speech", "nano_sanity"],
    });
    // Rendered at save time: fragments present, media notes carried, and no
    // decider swap — user personas can't reach that machinery.
    const fragments = written.fragments as { fragments: Array<{ key: string }> };
    expect(fragments.fragments.some((f) => f.key === "persona_intro")).toBe(true);
    expect(written.mediaNotes).toContain("capybara chilling");
    expect(written).not.toHaveProperty("mediaDeciderKey");
  });

  it("rejects an invalid payload without moderating", async () => {
    const { deps, moderate } = makeDeps({});

    await expectHttpsError(
      savePersonaForUser("uid-1", "free", { persona: { displayName: "x" } }, deps),
      "invalid-argument",
      "invalid_request",
    );
    expect(moderate).not.toHaveBeenCalled();
  });

  it("enforces the free-tier cap of 1 without burning a moderation call", async () => {
    const { deps, moderate } = makeDeps({
      existing: storedPersona("user_uid-1_old", "uid-1"),
    });

    const err = await expectHttpsError(
      savePersonaForUser("uid-1", "free", { persona: validInput() }, deps),
      "resource-exhausted",
      "persona_limit_reached",
    );
    expect((err.details as { cap: number }).cap).toBe(1);
    expect(moderate).not.toHaveBeenCalled();
  });

  it("enforces the paid cap of 10 and allows the 10th create", async () => {
    const nine = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `user_uid-1_${i}`,
        storedPersona(`user_uid-1_${i}`, "uid-1"),
      ]),
    );
    const ok = makeDeps(nine);
    await expect(
      savePersonaForUser("uid-1", "plus", { persona: validInput() }, ok.deps),
    ).resolves.toBeDefined();

    const ten = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `user_uid-1_${i}`,
        storedPersona(`user_uid-1_${i}`, "uid-1"),
      ]),
    );
    const full = makeDeps(ten);
    await expectHttpsError(
      savePersonaForUser("uid-1", "plus", { persona: validInput() }, full.deps),
      "resource-exhausted",
      "persona_limit_reached",
    );
  });

  it("someone else's personas never count against the cap", async () => {
    const { deps } = makeDeps({
      other: storedPersona("user_uid-2_a", "uid-2"),
    });

    await expect(
      savePersonaForUser("uid-1", "free", { persona: validInput() }, deps),
    ).resolves.toBeDefined();
  });

  it("rejects a content-moderation failure, logs the flag, writes nothing", async () => {
    const { deps, setCalls } = makeDeps({}, contentFailResult);

    const err = await expectHttpsError(
      savePersonaForUser("uid-1", "free", { persona: validInput() }, deps),
      "invalid-argument",
      "persona_rejected",
    );
    expect((err.details as { gate: string }).gate).toBe("openai_moderation");

    expect(setCalls).toHaveLength(0);
    expect(logFlaggedContent).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: "uid-1",
        reason: "persona_moderation",
        context: "persona",
        detail: "openai_moderation:sexual",
      }),
    );
  });

  it("maps a retryable moderation failure to unavailable and never flags", async () => {
    const { deps, setCalls } = makeDeps({}, retryableFailResult);

    await expectHttpsError(
      savePersonaForUser("uid-1", "free", { persona: validInput() }, deps),
      "unavailable",
      "moderation_unavailable",
    );
    expect(setCalls).toHaveLength(0);
    expect(logFlaggedContent).not.toHaveBeenCalled();
  });

  it("overwrites an owned persona in place, exempt from the cap, preserving createdAt", async () => {
    const { deps, setCalls } = makeDeps({
      "user_uid-1_a1": {
        ...storedPersona("user_uid-1_a1", "uid-1"),
        createdAt: "ORIGINAL_TS",
      },
    });

    // Free user at their cap of 1 — editing the existing persona must pass.
    const result = await savePersonaForUser(
      "uid-1",
      "free",
      { persona: validInput(), personaId: "user_uid-1_a1" },
      deps,
    );

    expect(result.personaId).toBe("user_uid-1_a1");
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].id).toBe("user_uid-1_a1");
    expect(setCalls[0].data.createdAt).toBe("ORIGINAL_TS");
    expect(setCalls[0].data.updatedAt).toBe("SERVER_TS");
  });

  it("refuses to overwrite someone else's persona without moderating", async () => {
    const { deps, moderate } = makeDeps({
      "user_uid-2_a1": storedPersona("user_uid-2_a1", "uid-2"),
    });

    await expectHttpsError(
      savePersonaForUser(
        "uid-1",
        "plus",
        { persona: validInput(), personaId: "user_uid-2_a1" },
        deps,
      ),
      "not-found",
      "persona_not_found",
    );
    expect(moderate).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a missing or non-user persona id", async () => {
    const missing = makeDeps({});
    await expectHttpsError(
      savePersonaForUser(
        "uid-1",
        "plus",
        { persona: validInput(), personaId: "user_uid-1_gone" },
        missing.deps,
      ),
      "not-found",
      "persona_not_found",
    );

    const firstParty = makeDeps({});
    await expectHttpsError(
      savePersonaForUser(
        "uid-1",
        "plus",
        { persona: validInput(), personaId: "brainrot_bot_default" },
        firstParty.deps,
      ),
      "not-found",
      "persona_not_found",
    );
  });
});

describe("deletePersonaForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deletes an owned persona", async () => {
    const { deps, deleteCalls } = makeDeps({
      "user_uid-1_a1": storedPersona("user_uid-1_a1", "uid-1"),
    });

    await deletePersonaForUser("uid-1", "user_uid-1_a1", deps.db);

    expect(deleteCalls).toEqual(["user_uid-1_a1"]);
  });

  it("rejects deleting someone else's or a missing persona", async () => {
    const { deps, deleteCalls } = makeDeps({
      "user_uid-2_a1": storedPersona("user_uid-2_a1", "uid-2"),
    });

    await expectHttpsError(
      deletePersonaForUser("uid-1", "user_uid-2_a1", deps.db),
      "not-found",
      "persona_not_found",
    );
    await expectHttpsError(
      deletePersonaForUser("uid-1", "user_uid-1_gone", deps.db),
      "not-found",
      "persona_not_found",
    );
    expect(deleteCalls).toEqual([]);
  });
});
