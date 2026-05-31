import { deleteConversationsForUser } from "../deleteConversations";
import { deleteUploadObjects } from "../../messages/resolveImageInputs";
import { HttpsError } from "firebase-functions/v2/https";

// Mock the Storage-cleanup helper so the test doesn't pull in openai/sharp/
// firebase-admin storage, and so we can assert exactly what gets deleted.
jest.mock("../../messages/resolveImageInputs", () => ({
  deleteUploadObjects: jest.fn().mockResolvedValue(undefined),
}));

type DocData = { uid?: string };
type MessageData = { images?: unknown[]; text?: string };

// In-memory Firestore double: enough surface for deleteConversationsForUser
// (collection/doc/get + doc.collection("messages").get + recursiveDelete +
// bulkWriter).
let store: Map<string, DocData>;
let messages: Map<string, MessageData[]>;

function makeDb() {
  const writer = { close: jest.fn().mockResolvedValue(undefined) };
  const docRef = (id: string) => ({
    id,
    path: `conversations/${id}`,
    get: async () => ({
      exists: store.has(id),
      data: () => store.get(id),
      id,
      ref: docRef(id),
    }),
    collection: (_name: string) => ({
      get: async () => ({
        docs: (messages.get(id) ?? []).map((m) => ({ data: () => m })),
      }),
    }),
  });
  const db = {
    collection: jest.fn(() => ({ doc: (id: string) => docRef(id) })),
    recursiveDelete: jest.fn().mockResolvedValue(undefined),
    bulkWriter: jest.fn(() => writer),
  };
  return { db, writer };
}

beforeEach(() => {
  store = new Map();
  messages = new Map();
  (deleteUploadObjects as jest.Mock).mockClear();
});

describe("deleteConversationsForUser", () => {
  it("deletes only conversations owned by the caller", async () => {
    store.set("c1", { uid: "owner" });

    const { db, writer } = makeDb();
    const deleted = await deleteConversationsForUser("owner", ["c1"], db as never);

    expect(deleted).toBe(1);
    expect(db.recursiveDelete).toHaveBeenCalledTimes(1);
    expect(writer.close).toHaveBeenCalledTimes(1);
  });

  it("throws when the caller is not the owner", async () => {
    store.set("c1", { uid: "someone-else" });

    const { db } = makeDb();
    await expect(
      deleteConversationsForUser("owner", ["c1"], db as never),
    ).rejects.toThrow(HttpsError);
  });

  it("skips conversations that do not exist", async () => {
    const { db } = makeDb();
    const deleted = await deleteConversationsForUser(
      "owner",
      ["missing"],
      db as never,
    );

    expect(deleted).toBe(0);
    expect(db.recursiveDelete).not.toHaveBeenCalled();
    expect(deleteUploadObjects).not.toHaveBeenCalled();
  });

  it("dedupes repeated ids in the request", async () => {
    store.set("c1", { uid: "owner" });

    const { db, writer } = makeDb();
    const deleted = await deleteConversationsForUser(
      "owner",
      ["c1", "c1"],
      db as never,
    );

    expect(deleted).toBe(1);
    expect(db.recursiveDelete).toHaveBeenCalledTimes(1);
    expect(writer.close).toHaveBeenCalledTimes(1);
  });

  it("deletes uploaded image objects from Storage before tearing down docs", async () => {
    store.set("c1", { uid: "owner" });
    messages.set("c1", [
      {
        images: [
          { source: "upload", path: "messageImages/owner/c1/a.jpg" },
          { source: "klipy", url: "https://static.klipy.com/x.png" },
        ],
      },
      { images: [{ source: "upload", path: "messageImages/owner/c1/b.jpg" }] },
      { text: "no attachments" },
    ]);

    const { db } = makeDb();
    await deleteConversationsForUser("owner", ["c1"], db as never);

    expect(deleteUploadObjects).toHaveBeenCalledWith([
      "messageImages/owner/c1/a.jpg",
      "messageImages/owner/c1/b.jpg",
    ]);
  });

  it("does not call Storage cleanup when no uploads are present", async () => {
    store.set("c1", { uid: "owner" });
    messages.set("c1", [
      { images: [{ source: "klipy", url: "https://static.klipy.com/x.png" }] },
    ]);

    const { db } = makeDb();
    await deleteConversationsForUser("owner", ["c1"], db as never);

    expect(deleteUploadObjects).not.toHaveBeenCalled();
  });
});
