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

import { cancelAgentReplyForUser } from "../cancelAgentReply";

type Conversation = { uid?: string } | null;
type MsgDoc = { id: string; role: "user" | "agent"; inReplyToClientMessageId?: string };

function makeDb(opts: {
  conversation: Conversation;
  // Docs in the messages subcollection, keyed by id (for the messageId path)
  // and scanned for the query (clientMessageId path).
  docs: MsgDoc[];
}) {
  const deleted: string[] = [];

  const docRef = (id: string) => ({
    get: async () => {
      const found = opts.docs.find((d) => d.id === id);
      return {
        exists: Boolean(found),
        data: () => (found ? { role: found.role } : undefined),
      };
    },
    delete: async () => {
      deleted.push(id);
    },
  });

  // Chainable where().where().get() returning the matching agent docs.
  const makeQuery = (filters: { field: string; value: unknown }[]) => ({
    where: (field: string, _op: string, value: unknown) =>
      makeQuery([...filters, { field, value }]),
    get: async () => {
      const matches = opts.docs.filter((d) =>
        filters.every((f) => {
          if (f.field === "role") return d.role === f.value;
          if (f.field === "inReplyToClientMessageId")
            return d.inReplyToClientMessageId === f.value;
          return true;
        }),
      );
      return { docs: matches.map((d) => ({ id: d.id })) };
    },
  });

  const messagesCollection = {
    doc: (id: string) => docRef(id),
    where: (field: string, _op: string, value: unknown) =>
      makeQuery([{ field, value }]),
  };
  const conversationRef = {
    get: async () => ({
      exists: opts.conversation !== null,
      data: () => opts.conversation,
    }),
    collection: () => messagesCollection,
  };
  const db = { collection: () => ({ doc: () => conversationRef }) };

  return { db: db as never, deleted };
}

describe("cancelAgentReplyForUser", () => {
  it("deletes the in-flight agent reply by messageId", async () => {
    const { db, deleted } = makeDb({
      conversation: { uid: "user-1" },
      docs: [{ id: "agent-1", role: "agent" }],
    });

    const result = await cancelAgentReplyForUser(
      "user-1",
      { conversationId: "c1", messageId: "agent-1" },
      db,
    );

    expect(result).toEqual({ deleted: 1 });
    expect(deleted).toEqual(["agent-1"]);
  });

  it("refuses to delete a non-agent message addressed by id (falls through)", async () => {
    const { db, deleted } = makeDb({
      conversation: { uid: "user-1" },
      docs: [{ id: "user-1-msg", role: "user" }],
    });

    const result = await cancelAgentReplyForUser(
      "user-1",
      { conversationId: "c1", messageId: "user-1-msg" },
      db,
    );

    expect(result).toEqual({ deleted: 0 });
    expect(deleted).toEqual([]);
  });

  it("deletes the in-flight agent reply by clientMessageId", async () => {
    const { db, deleted } = makeDb({
      conversation: { uid: "user-1" },
      docs: [
        { id: "user-msg", role: "user" },
        { id: "agent-1", role: "agent", inReplyToClientMessageId: "client-42" },
      ],
    });

    const result = await cancelAgentReplyForUser(
      "user-1",
      { conversationId: "c1", clientMessageId: "client-42" },
      db,
    );

    expect(result).toEqual({ deleted: 1 });
    expect(deleted).toEqual(["agent-1"]);
  });

  it("falls back to clientMessageId when the messageId missed", async () => {
    const { db, deleted } = makeDb({
      conversation: { uid: "user-1" },
      docs: [
        { id: "agent-new", role: "agent", inReplyToClientMessageId: "client-42" },
      ],
    });

    const result = await cancelAgentReplyForUser(
      "user-1",
      { conversationId: "c1", messageId: "stale-id", clientMessageId: "client-42" },
      db,
    );

    expect(result).toEqual({ deleted: 1 });
    expect(deleted).toEqual(["agent-new"]);
  });

  it("is idempotent: deletes nothing when the reply is already gone", async () => {
    const { db, deleted } = makeDb({
      conversation: { uid: "user-1" },
      docs: [],
    });

    const result = await cancelAgentReplyForUser(
      "user-1",
      { conversationId: "c1", messageId: "agent-1", clientMessageId: "client-42" },
      db,
    );

    expect(result).toEqual({ deleted: 0 });
    expect(deleted).toEqual([]);
  });

  it("rejects when the conversation does not exist", async () => {
    const { db } = makeDb({ conversation: null, docs: [] });
    await expect(
      cancelAgentReplyForUser("user-1", { conversationId: "c1", messageId: "m" }, db),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("rejects a conversation owned by someone else", async () => {
    const { db, deleted } = makeDb({
      conversation: { uid: "other-user" },
      docs: [{ id: "agent-1", role: "agent" }],
    });
    await expect(
      cancelAgentReplyForUser("user-1", { conversationId: "c1", messageId: "agent-1" }, db),
    ).rejects.toMatchObject({ code: "not-found" });
    expect(deleted).toEqual([]);
  });
});
