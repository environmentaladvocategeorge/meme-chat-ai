jest.mock("firebase-functions", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(),
}));

import { getFirestore } from "firebase-admin/firestore";
import { deleteConversationsForUser } from "../deleteConversations";

type Doc = { uid?: string } & Record<string, unknown>;

// Minimal Firestore stand-in that records every collection it touches, so we
// can assert deletion never reaches the billing collections.
function makeDb(conversations: Record<string, Doc>) {
  const touchedCollections = new Set<string>();
  const deletedPaths: string[] = [];

  const db = {
    collection(name: string) {
      touchedCollections.add(name);
      return {
        doc(id: string) {
          const ref = { path: `${name}/${id}` };
          return {
            ...ref,
            get: async () => ({
              exists: Object.prototype.hasOwnProperty.call(conversations, id),
              data: () => conversations[id],
            }),
          };
        },
      };
    },
    async recursiveDelete(ref: { path: string }) {
      deletedPaths.push(ref.path);
    },
  };

  return { db, touchedCollections, deletedPaths };
}

const asDb = (db: unknown) => db as ReturnType<typeof getFirestore>;

describe("deleteConversationsForUser", () => {
  it("deletes the caller's conversations and dedupes ids", async () => {
    const { db, deletedPaths } = makeDb({
      c1: { uid: "user-1" },
      c2: { uid: "user-1" },
    });

    const deleted = await deleteConversationsForUser(
      "user-1",
      ["c1", "c2", "c1"],
      asDb(db),
    );

    expect(deleted).toBe(2);
    expect(deletedPaths).toEqual(["conversations/c1", "conversations/c2"]);
  });

  it("skips conversations that don't exist", async () => {
    const { db, deletedPaths } = makeDb({ c1: { uid: "user-1" } });

    const deleted = await deleteConversationsForUser(
      "user-1",
      ["c1", "missing"],
      asDb(db),
    );

    expect(deleted).toBe(1);
    expect(deletedPaths).toEqual(["conversations/c1"]);
  });

  it("rejects deleting a conversation owned by someone else", async () => {
    const { db, deletedPaths } = makeDb({ c1: { uid: "other-user" } });

    await expect(
      deleteConversationsForUser("user-1", ["c1"], asDb(db)),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(deletedPaths).toEqual([]);
  });

  it("never touches billing collections (no quota refund / bypass)", async () => {
    const { db, touchedCollections } = makeDb({
      c1: { uid: "user-1" },
      c2: { uid: "user-1" },
    });

    await deleteConversationsForUser("user-1", ["c1", "c2"], asDb(db));

    expect([...touchedCollections]).toEqual(["conversations"]);
    expect(touchedCollections.has("profiles")).toBe(false);
    expect(touchedCollections.has("usageEvents")).toBe(false);
  });
});
