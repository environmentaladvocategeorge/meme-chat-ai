import { deleteUserData } from "../deleteMyAccount";

const deleteFiles = jest.fn();

jest.mock("firebase-admin/storage", () => ({
  getStorage: () => ({
    bucket: () => ({ deleteFiles }),
  }),
}));

type DocRef = { path: string };

function makeDb(args: {
  conversations?: string[];
  usageEvents?: string[];
  recursiveDeleteRejects?: boolean;
}) {
  const writer = {
    delete: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const docsFor = (name: string) => {
    const ids =
      name === "conversations"
        ? (args.conversations ?? [])
        : (args.usageEvents ?? []);
    return ids.map((id) => ({ ref: { path: `${name}/${id}` } }));
  };
  return {
    collection: jest.fn((name: string) => ({
      where: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ docs: docsFor(name) }),
      })),
    })),
    doc: jest.fn((path: string): DocRef => ({ path })),
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
  });

  it("deletes profile tree, owned records, usage events, and uploaded images", async () => {
    const db = makeDb({
      conversations: ["c1", "c2"],
      usageEvents: ["u1"],
    });

    await deleteUserData("uid-1", db as never);

    expect(db.recursiveDelete).toHaveBeenCalledWith(
      { path: "profiles/uid-1" },
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
    expect(deleteFiles).toHaveBeenCalledWith({ prefix: "messageImages/uid-1/" });
  });

  it("propagates Storage cleanup failures", async () => {
    deleteFiles.mockRejectedValueOnce(new Error("storage failed"));
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
});
