import { deleteUserData, verifyUserDataDeleted } from "../deleteMyAccount";

const deleteFiles = jest.fn();
const getFiles = jest.fn();

jest.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({ deleteFiles, getFiles }),
  }),
}));

type DocRef = { path: string };

function makeDb(args: {
  conversations?: string[];
  usageEvents?: string[];
  userPersonas?: string[];
  recursiveDeleteRejects?: boolean;
  // Surfaces the post-delete verification should report as STILL present, to
  // simulate an incomplete wipe. Keys: "profiles" | "memories" |
  // "conversations" | "usageEvents" | "user_personas".
  residual?: string[];
}) {
  const residual = new Set(args.residual ?? []);
  const writer = {
    delete: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const idsFor = (name: string) => {
    if (name === "conversations") return args.conversations ?? [];
    if (name === "user_personas") return args.userPersonas ?? [];
    return args.usageEvents ?? [];
  };
  const docsFor = (name: string) =>
    idsFor(name).map((id) => ({ ref: { path: `${name}/${id}` } }));
  // The verify pass re-queries with .limit(1); report empty unless this
  // collection is flagged as residual.
  const verifyEmpty = (name: string) => ({ empty: !residual.has(name) });

  return {
    collection: jest.fn((name: string) => ({
      where: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: docsFor(name) }),
        limit: jest.fn(() => ({
          get: jest.fn().mockResolvedValue(verifyEmpty(name)),
        })),
      })),
    })),
    doc: jest.fn((path: string) => ({
      path,
      // profiles/{uid} and memories/{uid} verification reads.
      get: jest.fn().mockResolvedValue({
        exists: residual.has(path.split("/")[0]),
      }),
    })),
    bulkWriter: jest.fn(() => writer),
    recursiveDelete: jest.fn((ref: DocRef) =>
      args.recursiveDeleteRejects && ref.path === "profiles/uid-1"
        ? Promise.reject(new Error("firestore failed"))
        : Promise.resolve(),
    ),
    writer,
  };
}

describe("deleteUserData", () => {
  beforeEach(() => {
    deleteFiles.mockReset().mockResolvedValue(undefined);
    // Verification getFiles defaults to "nothing left" ([files, ...]).
    getFiles.mockReset().mockResolvedValue([[]]);
  });

  it("deletes profile tree, conversations, usage events, personas, and both storage prefixes", async () => {
    const db = makeDb({
      conversations: ["c1", "c2"],
      usageEvents: ["u1"],
      userPersonas: ["p1", "p2"],
    });

    await deleteUserData("uid-1", db as never);

    expect(db.recursiveDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: "profiles/uid-1" }),
      db.writer,
    );
    expect(db.recursiveDelete).toHaveBeenCalledWith(
      expect.objectContaining({ path: "memories/uid-1" }),
      db.writer,
    );
    expect(db.recursiveDelete).toHaveBeenCalledWith(
      { path: "conversations/c1" },
      db.writer,
    );
    expect(db.recursiveDelete).toHaveBeenCalledWith(
      { path: "conversations/c2" },
      db.writer,
    );
    expect(db.writer.delete).toHaveBeenCalledWith({ path: "usageEvents/u1" });
    expect(db.writer.delete).toHaveBeenCalledWith({ path: "user_personas/p1" });
    expect(db.writer.delete).toHaveBeenCalledWith({ path: "user_personas/p2" });
    expect(deleteFiles).toHaveBeenCalledWith({
      prefix: "messageImages/uid-1/",
    });
    expect(deleteFiles).toHaveBeenCalledWith({
      prefix: "personaAvatars/uid-1/",
    });
  });

  it("propagates Storage cleanup failures", async () => {
    deleteFiles.mockReset().mockRejectedValue(new Error("storage failed"));
    const db = makeDb({});

    await expect(deleteUserData("uid-1", db as never)).rejects.toThrow(
      "storage failed",
    );
  });

  it("propagates Firestore cleanup failures", async () => {
    const db = makeDb({ recursiveDeleteRejects: true });

    await expect(deleteUserData("uid-1", db as never)).rejects.toThrow(
      "firestore failed",
    );
  });

  it("throws when post-delete verification finds residual Firestore data", async () => {
    const db = makeDb({ residual: ["user_personas"] });

    await expect(deleteUserData("uid-1", db as never)).rejects.toThrow(
      /residual user data after delete.*user_personas/,
    );
  });

  it("throws when post-delete verification finds residual Storage objects", async () => {
    const db = makeDb({});
    // First two getFiles calls (verification) report a leftover avatar object.
    getFiles.mockReset().mockResolvedValue([[{ name: "personaAvatars/uid-1/x" }]]);

    await expect(deleteUserData("uid-1", db as never)).rejects.toThrow(
      /residual user data after delete/,
    );
  });
});

describe("verifyUserDataDeleted", () => {
  beforeEach(() => {
    getFiles.mockReset().mockResolvedValue([[]]);
  });

  it("resolves when nothing remains", async () => {
    const db = makeDb({});
    await expect(
      verifyUserDataDeleted("uid-1", db as never),
    ).resolves.toBeUndefined();
  });

  it("names every surface that still has data", async () => {
    const db = makeDb({ residual: ["profiles", "memories", "conversations"] });
    await expect(verifyUserDataDeleted("uid-1", db as never)).rejects.toThrow(
      /profiles.*memories.*conversations/,
    );
  });
});
