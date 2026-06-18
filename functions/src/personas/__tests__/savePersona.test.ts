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
  // Every collection name the code under test reaches for — lets a test assert
  // that delete never touches `conversations`.
  const collectionsTouched: string[] = [];

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
      collectionsTouched.push(name);
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

  return { db, docs, setCalls, deleteCalls, collectionsTouched };
}

function validInput(): UserPersonaInput {
  return {
    displayName: "Chill Capybara",
    identity: "A laid-back capybara who vibes through every crisis.",
    voiceExample: {
      user: "my code broke again",
      good: "bro the code said nah. show me the error, we fix it zen style",
    },
    greetingShapes: ["yo what's good"],
    humorTypes: ["deadpan"],
    humorExampleShapes: ["that's rough buddy, anyway hydrate"],
    slang: {
      termGlosses: "vibe check = quick mood read.",
    },
    emojiPalette: ["🦫"],
    media: { pills: ["capybara chilling"], lean: "wholesome reactions" },
    publicConfig: {
      shortDescription: "Zen rodent energy",
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
  const { db, docs, setCalls, deleteCalls, collectionsTouched } = makeDb(initial);
  const moderate = jest.fn().mockResolvedValue(moderationResult);
  const deleteObject = jest.fn().mockResolvedValue(undefined);
  const deps: SavePersonaDeps = { db: db as never, moderate, deleteObject };
  return { deps, moderate, deleteObject, docs, setCalls, deleteCalls, collectionsTouched };
}

// A stored persona that already carries an uploaded avatar (edit fixtures).
function storedPersonaWithAvatar(id: string, ownerUid: string): Doc {
  return {
    ...storedPersona(id, ownerUid),
    createdAt: "ORIGINAL_TS",
    publicConfig: {
      displayName: "Old",
      shortDescription: "old",
      toneTags: [],
      avatarUrl: "https://example.com/personaAvatars/uid-1/old.jpg",
      avatarPath: "personaAvatars/uid-1/old.jpg",
    },
  };
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

  it("stores an uploaded avatar and moderates its url alongside the text", async () => {
    const { deps, moderate, setCalls } = makeDeps({});
    const avatar = {
      url: "https://example.com/personaAvatars/uid-1/a.jpg",
      path: "personaAvatars/uid-1/a.jpg",
    };

    const result = await savePersonaForUser(
      "uid-1",
      "free",
      { persona: validInput(), avatar },
      deps,
    );

    // The image url is threaded to the moderation call as the 2nd arg.
    expect(moderate.mock.calls[0][1]).toBe(avatar.url);
    const written = setCalls[0].data as { publicConfig: Record<string, unknown> };
    expect(written.publicConfig.avatarUrl).toBe(avatar.url);
    expect(written.publicConfig.avatarPath).toBe(avatar.path);
    expect(result.publicConfig.avatarUrl).toBe(avatar.url);
  });

  it("rejects an avatar path outside the caller's namespace before moderating", async () => {
    const { deps, moderate, setCalls } = makeDeps({});

    await expectHttpsError(
      savePersonaForUser(
        "uid-1",
        "free",
        {
          persona: validInput(),
          avatar: { url: "https://example.com/x.jpg", path: "personaAvatars/uid-2/x.jpg" },
        },
        deps,
      ),
      "invalid-argument",
      "invalid_avatar",
    );
    expect(moderate).not.toHaveBeenCalled();
    expect(setCalls).toHaveLength(0);
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

  it("enforces per-tier caps: basic stops at 10 where plus still has room", async () => {
    // Nine stored — basic (cap 10) still allows the 10th.
    const nine = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [
        `user_uid-1_${i}`,
        storedPersona(`user_uid-1_${i}`, "uid-1"),
      ]),
    );
    await expect(
      savePersonaForUser("uid-1", "basic", { persona: validInput() }, makeDeps(nine).deps),
    ).resolves.toBeDefined();

    // Ten stored — basic is full and rejects, but plus (cap 30) still creates.
    const ten = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `user_uid-1_${i}`,
        storedPersona(`user_uid-1_${i}`, "uid-1"),
      ]),
    );
    await expectHttpsError(
      savePersonaForUser("uid-1", "basic", { persona: validInput() }, makeDeps(ten).deps),
      "resource-exhausted",
      "persona_limit_reached",
    );
    await expect(
      savePersonaForUser("uid-1", "plus", { persona: validInput() }, makeDeps(ten).deps),
    ).resolves.toBeDefined();
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

  it("removes the stored avatar on edit when removeAvatar is set, deleting the object", async () => {
    const { deps, deleteObject, setCalls } = makeDeps({
      "user_uid-1_a1": storedPersonaWithAvatar("user_uid-1_a1", "uid-1"),
    });

    await savePersonaForUser(
      "uid-1",
      "free",
      { persona: validInput(), personaId: "user_uid-1_a1", removeAvatar: true },
      deps,
    );

    const written = setCalls[0].data as { publicConfig: Record<string, unknown> };
    expect(written.publicConfig).not.toHaveProperty("avatarUrl");
    expect(written.publicConfig).not.toHaveProperty("avatarPath");
    expect(deleteObject).toHaveBeenCalledWith("personaAvatars/uid-1/old.jpg");
  });

  it("ignores removeAvatar when a new avatar is uploaded (upload wins)", async () => {
    const { deps, deleteObject, setCalls } = makeDeps({
      "user_uid-1_a1": storedPersonaWithAvatar("user_uid-1_a1", "uid-1"),
    });
    const avatar = {
      url: "https://example.com/personaAvatars/uid-1/new.jpg",
      path: "personaAvatars/uid-1/new.jpg",
    };

    await savePersonaForUser(
      "uid-1",
      "free",
      { persona: validInput(), personaId: "user_uid-1_a1", avatar, removeAvatar: true },
      deps,
    );

    const written = setCalls[0].data as { publicConfig: Record<string, unknown> };
    expect(written.publicConfig.avatarUrl).toBe(avatar.url);
    // The replaced old object is still cleaned up.
    expect(deleteObject).toHaveBeenCalledWith("personaAvatars/uid-1/old.jpg");
  });

  it("deletes the old avatar object when a new avatar replaces it", async () => {
    const { deps, deleteObject, setCalls } = makeDeps({
      "user_uid-1_a1": storedPersonaWithAvatar("user_uid-1_a1", "uid-1"),
    });
    const avatar = {
      url: "https://example.com/personaAvatars/uid-1/new.jpg",
      path: "personaAvatars/uid-1/new.jpg",
    };

    await savePersonaForUser(
      "uid-1",
      "free",
      { persona: validInput(), personaId: "user_uid-1_a1", avatar },
      deps,
    );

    const written = setCalls[0].data as { publicConfig: Record<string, unknown> };
    expect(written.publicConfig.avatarPath).toBe(avatar.path);
    expect(deleteObject).toHaveBeenCalledWith("personaAvatars/uid-1/old.jpg");
  });

  it("carries the stored avatar forward (and deletes nothing) on a plain edit", async () => {
    const { deps, deleteObject, setCalls } = makeDeps({
      "user_uid-1_a1": storedPersonaWithAvatar("user_uid-1_a1", "uid-1"),
    });

    await savePersonaForUser(
      "uid-1",
      "free",
      { persona: validInput(), personaId: "user_uid-1_a1" },
      deps,
    );

    const written = setCalls[0].data as { publicConfig: Record<string, unknown> };
    expect(written.publicConfig.avatarUrl).toBe("https://example.com/personaAvatars/uid-1/old.jpg");
    expect(written.publicConfig.avatarPath).toBe("personaAvatars/uid-1/old.jpg");
    expect(deleteObject).not.toHaveBeenCalled();
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

  it("also deletes the uploaded avatar object when the persona has one", async () => {
    const { deps } = makeDeps({
      "user_uid-1_a1": {
        ...storedPersona("user_uid-1_a1", "uid-1"),
        publicConfig: { avatarPath: "personaAvatars/uid-1/a.jpg" },
      },
    });
    const deleteObject = jest.fn().mockResolvedValue(undefined);

    await deletePersonaForUser("uid-1", "user_uid-1_a1", deps.db, deleteObject);

    expect(deleteObject).toHaveBeenCalledWith("personaAvatars/uid-1/a.jpg");
  });

  it("leaves conversations untouched so the deleted bot renders as a ? coin, not a blank row", async () => {
    const { deps, deleteCalls, collectionsTouched } = makeDeps({
      "user_uid-1_a1": storedPersona("user_uid-1_a1", "uid-1"),
    });

    await deletePersonaForUser("uid-1", "user_uid-1_a1", deps.db);

    // Regression: delete must NOT strip the id from conversations'
    // participantPersonaIds. It only ever touches user_personas; the client
    // resolves the now-missing persona to a "?" coin in both the chat and the
    // history avatar stack. Stripping it emptied single-bot conversations and
    // left the history row with no avatar at all.
    expect(deleteCalls).toEqual(["user_uid-1_a1"]);
    expect(collectionsTouched).toEqual(["user_personas"]);
    expect(collectionsTouched).not.toContain("conversations");
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
