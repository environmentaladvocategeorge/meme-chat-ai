jest.mock("firebase-functions", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(),
  FieldValue: {
    delete: () => "DELETE",
    serverTimestamp: () => "TS",
  },
}));

import { rateMessageForUser } from "../rateMessage";

type Conversation = { uid?: string } | null;

function makeDb(opts: { conversation: Conversation; messageExists: boolean }) {
  const recorded: { update?: Record<string, unknown> } = {};

  const messageRef = {
    get: async () => ({ exists: opts.messageExists }),
    update: async (d: Record<string, unknown>) => {
      recorded.update = d;
    },
  };
  const messagesCollection = { doc: () => messageRef };
  const conversationRef = {
    get: async () => ({
      exists: opts.conversation !== null,
      data: () => opts.conversation,
    }),
    collection: () => messagesCollection,
  };
  const db = { collection: () => ({ doc: () => conversationRef }) };

  return { db: db as never, recorded };
}

const args = { conversationId: "c1", messageId: "m1", reaction: "up" as const };

describe("rateMessageForUser", () => {
  it("records a thumbs-up on an owned message", async () => {
    const { db, recorded } = makeDb({
      conversation: { uid: "user-1" },
      messageExists: true,
    });

    const result = await rateMessageForUser("user-1", args, db);

    expect(result).toEqual({ reaction: "up" });
    expect(recorded.update).toMatchObject({ reaction: "up", reactionUpdatedAt: "TS" });
  });

  it("clears a rating by deleting the field when reaction is null", async () => {
    const { db, recorded } = makeDb({
      conversation: { uid: "user-1" },
      messageExists: true,
    });

    const result = await rateMessageForUser(
      "user-1",
      { ...args, reaction: null },
      db,
    );

    expect(result).toEqual({ reaction: null });
    // FieldValue.delete() sentinel from the mock.
    expect(recorded.update?.reaction).toBe("DELETE");
  });

  it("rejects when the conversation does not exist", async () => {
    const { db } = makeDb({ conversation: null, messageExists: true });
    await expect(rateMessageForUser("user-1", args, db)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("rejects rating a conversation owned by someone else", async () => {
    const { db, recorded } = makeDb({
      conversation: { uid: "other-user" },
      messageExists: true,
    });
    await expect(rateMessageForUser("user-1", args, db)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(recorded.update).toBeUndefined();
  });

  it("rejects when the message does not exist", async () => {
    const { db } = makeDb({ conversation: { uid: "user-1" }, messageExists: false });
    await expect(rateMessageForUser("user-1", args, db)).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
