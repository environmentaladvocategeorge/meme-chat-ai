// Exercises the Firestore wrapper `assembleContext` (as opposed to the pure
// `assembleFromInputs` covered in assemble.test.ts). Focus: the replay
// `excludeMessageIds` option, which must drop the named docs from the recent
// window so a regenerated user turn isn't both a history turn and the current
// turn.
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(),
  QueryDocumentSnapshot: class {},
}));

import { getFirestore } from "firebase-admin/firestore";
import { assembleContext } from "../assemble";

type RawMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  status?: "complete" | "streaming" | "error";
};

// Builds a db whose messages collection returns the given docs (newest first,
// matching the orderBy("createdAt","desc") the wrapper issues) and whose
// conversation doc carries the supplied summary fields.
function makeDb(
  messagesNewestFirst: RawMessage[],
  conversation: Record<string, unknown> = {},
) {
  const messagesCollection: Record<string, jest.Mock> = {};
  messagesCollection.orderBy = jest.fn(() => messagesCollection);
  messagesCollection.limit = jest.fn(() => messagesCollection);
  messagesCollection.get = jest.fn(async () => ({
    docs: messagesNewestFirst.map((m) => ({
      id: m.id,
      data: () => ({ role: m.role, text: m.text, status: m.status ?? "complete" }),
    })),
  }));

  const conversationRef = {
    get: jest.fn(async () => ({ data: () => conversation })),
  };

  const db = {
    doc: jest.fn(() => conversationRef),
    collection: jest.fn(() => messagesCollection),
  };
  return db;
}

const mockedGetFirestore = getFirestore as jest.Mock;

function userContents(messages: { role: string; content: unknown }[]) {
  return messages.filter((m) => m.role === "user").map((m) => m.content);
}

describe("assembleContext excludeMessageIds (replay)", () => {
  it("drops the excluded user turn from history and appends it as the current turn", async () => {
    // Newest first: the latest user turn (u2) is the one being replayed.
    const db = makeDb([
      { id: "u2", role: "user", text: "tell me a joke" },
      { id: "a1", role: "agent", text: "first reply" },
      { id: "u1", role: "user", text: "hi" },
    ]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await assembleContext({
      conversationId: "c1",
      plan: "free",
      currentUserMessage: "tell me a joke",
      excludeMessageIds: ["u2"],
    });

    const users = userContents(result.messages);
    // "tell me a joke" appears exactly once — as the trailing current turn, not
    // duplicated in history.
    expect(users.filter((c) => c === "tell me a joke")).toHaveLength(1);
    const last = result.messages[result.messages.length - 1];
    expect(last).toEqual({ role: "user", content: "tell me a joke" });
    // History still contains the earlier turns.
    expect(users).toContain("hi");
  });

  it("without exclusion the latest user turn would duplicate (control)", async () => {
    const db = makeDb([
      { id: "u2", role: "user", text: "tell me a joke" },
      { id: "u1", role: "user", text: "hi" },
    ]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await assembleContext({
      conversationId: "c1",
      plan: "free",
      currentUserMessage: "tell me a joke",
    });

    const users = userContents(result.messages);
    // Same text shows up twice: once from history, once as the current turn.
    expect(users.filter((c) => c === "tell me a joke")).toHaveLength(2);
  });

  it("never leaves a trailing empty user message after exclusion", async () => {
    const db = makeDb([{ id: "u1", role: "user", text: "only turn" }]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await assembleContext({
      conversationId: "c1",
      plan: "free",
      currentUserMessage: "only turn",
      excludeMessageIds: ["u1"],
    });

    const last = result.messages[result.messages.length - 1];
    expect(last.content).toBe("only turn");
    // No empty-string user turn anywhere.
    expect(userContents(result.messages)).not.toContain("");
  });

  it("preloaded window + conversation → zero Firestore reads", async () => {
    // The orchestrators load ONE message window per turn and hand it in as
    // `preloaded`; assembly must not touch Firestore at all in that mode.
    mockedGetFirestore.mockImplementation(() => {
      throw new Error("assembleContext must not read Firestore when preloaded");
    });

    const docs = [
      { id: "u2", role: "user", text: "replay me" },
      { id: "a1", role: "agent", text: "kept reply" },
      { id: "u1", role: "user", text: "summarized away" },
    ].map((m) => ({
      id: m.id,
      data: () => ({ role: m.role, text: m.text, status: "complete" }),
    }));

    const result = await assembleContext({
      conversationId: "c1",
      plan: "free",
      currentUserMessage: "replay me",
      excludeMessageIds: ["u2"],
      preloaded: {
        docs: docs as never,
        conversation: {
          summary: "Earlier the user said hi.",
          summaryUpToMessageId: "u1",
        },
      },
    });

    const users = userContents(result.messages);
    // Same semantics as the self-loading path: summary cutoff + exclusion.
    expect(users).not.toContain("summarized away");
    expect(users.filter((c) => c === "replay me")).toHaveLength(1);
    expect(result.messages.some((m) => m.content === "kept reply")).toBe(true);
    expect(result.summaryUsed).toBe(true);
  });

  it("still honors a summary cutoff alongside exclusion", async () => {
    const db = makeDb(
      [
        { id: "u2", role: "user", text: "replay me" },
        { id: "a1", role: "agent", text: "kept reply" },
        { id: "u1", role: "user", text: "summarized away" },
      ],
      { summary: "Earlier the user said hi.", summaryUpToMessageId: "u1" },
    );
    mockedGetFirestore.mockReturnValue(db);

    const result = await assembleContext({
      conversationId: "c1",
      plan: "free",
      currentUserMessage: "replay me",
      excludeMessageIds: ["u2"],
    });

    const users = userContents(result.messages);
    // u1 is before the cutoff → excluded by the summary logic.
    expect(users).not.toContain("summarized away");
    // u2 excluded from history but present as current; a1 kept.
    expect(users.filter((c) => c === "replay me")).toHaveLength(1);
    expect(result.messages.some((m) => m.content === "kept reply")).toBe(true);
    expect(result.summaryUsed).toBe(true);
  });
});
