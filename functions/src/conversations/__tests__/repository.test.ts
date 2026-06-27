jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(),
  FieldValue: { serverTimestamp: () => "TS" },
  // Imported as a value in repository.ts but only used in type position.
  QueryDocumentSnapshot: class {},
}));

import { getFirestore } from "firebase-admin/firestore";
import {
  appendMessage,
  createConversation,
  deleteMessage,
  finalizeAgentMessage,
  loadRecentMessages,
  loadReplayTargets,
  watchMessageDeleted,
} from "../repository";
import type { MessageImage } from "../../messages/messageImage";

const PREVIEW_URL = "https://static.klipy.com/ii/abc/20/90/preview.webp";

function mkImage(overrides: Partial<MessageImage> = {}): MessageImage {
  return {
    id: "img-1",
    source: "klipy",
    url: PREVIEW_URL,
    previewUrl: PREVIEW_URL,
    ...overrides,
  } as MessageImage;
}

type Recorded = {
  messageData?: Record<string, unknown>;
  convUpdate?: Record<string, unknown>;
  convSet?: Record<string, unknown>;
};

function makeDb(messageDocs: Array<Record<string, unknown>> = []) {
  const recorded: Recorded = {};

  const messageRef = {
    id: "msg-1",
    set: jest.fn(async (d: Record<string, unknown>) => {
      recorded.messageData = d;
    }),
  };

  const messagesCollection: Record<string, jest.Mock> = {};
  messagesCollection.doc = jest.fn(() => messageRef);
  messagesCollection.orderBy = jest.fn(() => messagesCollection);
  messagesCollection.limit = jest.fn(() => messagesCollection);
  messagesCollection.get = jest.fn(async () => ({
    docs: messageDocs.map((data, i) => ({ id: `m${i}`, data: () => data })),
  }));

  const conversationRef = {
    id: "conv-1",
    set: jest.fn(async (d: Record<string, unknown>) => {
      recorded.convSet = d;
    }),
    update: jest.fn(async (d: Record<string, unknown>) => {
      recorded.convUpdate = d;
    }),
    collection: jest.fn(() => messagesCollection),
  };

  const conversationsCollection = { doc: jest.fn(() => conversationRef) };
  const db = { collection: jest.fn(() => conversationsCollection) };

  return { db, recorded, conversationRef, messageRef };
}

const mockedGetFirestore = getFirestore as jest.Mock;

describe("appendMessage persistence", () => {
  it("stores image attachments on a user message", async () => {
    const { db, recorded } = makeDb();
    mockedGetFirestore.mockReturnValue(db);

    await appendMessage("conv-1", {
      role: "user",
      text: "look",
      status: "complete",
      images: [mkImage()],
    });

    expect(recorded.messageData?.images).toEqual([mkImage()]);
    expect(recorded.messageData?.text).toBe("look");
  });

  it("does not write an images field when there are none", async () => {
    const { db, recorded } = makeDb();
    mockedGetFirestore.mockReturnValue(db);

    await appendMessage("conv-1", {
      role: "user",
      text: "plain",
      status: "complete",
    });

    expect(recorded.messageData).not.toHaveProperty("images");
  });

  it("stores levelOfRot on a user message when provided", async () => {
    const { db, recorded } = makeDb();
    mockedGetFirestore.mockReturnValue(db);

    await appendMessage("conv-1", {
      role: "user",
      text: "look",
      status: "complete",
      levelOfRot: 3,
    });

    expect(recorded.messageData?.levelOfRot).toBe(3);
  });

  it("does not write a levelOfRot field when omitted", async () => {
    const { db, recorded } = makeDb();
    mockedGetFirestore.mockReturnValue(db);

    await appendMessage("conv-1", {
      role: "agent",
      text: "reply",
      status: "streaming",
    });

    expect(recorded.messageData).not.toHaveProperty("levelOfRot");
  });

  it("persists an image-only message (empty text) with a fallback preview", async () => {
    const { db, recorded } = makeDb();
    mockedGetFirestore.mockReturnValue(db);

    await appendMessage("conv-1", {
      role: "user",
      text: "",
      status: "complete",
      images: [mkImage()],
    });

    expect(recorded.messageData?.text).toBe("");
    expect(recorded.messageData?.images).toHaveLength(1);
    // Non-blank list preview even though the message has no text.
    expect(recorded.convUpdate?.lastMessagePreview).toBe("Sent a meme");
  });
});

describe("createConversation title fallback", () => {
  it("uses 'Sent a meme' for an image-only opener", async () => {
    const { db, recorded } = makeDb();
    mockedGetFirestore.mockReturnValue(db);

    await createConversation("user-1", "", { hasImages: true });

    expect(recorded.convSet?.title).toBe("Sent a meme");
    expect(recorded.convSet?.firstUserMessage).toBe("");
  });

  it("uses a neutral placeholder for a text opener (never the raw message)", async () => {
    const { db, recorded } = makeDb();
    mockedGetFirestore.mockReturnValue(db);

    await createConversation("user-1", "hello world", { hasImages: false });

    // The raw message is NOT used as the title (it would leak slurs/profanity
    // into the chat list when a turn is blocked before the bot replies).
    expect(recorded.convSet?.title).toBe("New Chat 💬");
    // ...but the raw text is still kept for AI titling input.
    expect(recorded.convSet?.firstUserMessage).toBe("hello world");
  });
});

describe("loadRecentMessages read path", () => {
  it("returns attachments on stored user messages", async () => {
    const { db } = makeDb([
      { role: "user", text: "look", status: "complete", images: [mkImage()] },
      { role: "agent", text: "nice", status: "complete" },
    ]);
    mockedGetFirestore.mockReturnValue(db);

    const messages = await loadRecentMessages("conv-1");
    // docs are reversed by loadRecentMessages (desc → asc).
    const userMsg = messages.find((m) => m.role === "user");
    expect(userMsg?.images).toEqual([mkImage()]);
  });

  it("keeps an image-only message (empty text) in the read path", async () => {
    const { db } = makeDb([
      { role: "user", text: "", status: "complete", images: [mkImage()] },
    ]);
    mockedGetFirestore.mockReturnValue(db);

    const messages = await loadRecentMessages("conv-1");
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("");
    expect(messages[0].images).toHaveLength(1);
  });

  it("drops a message with neither text nor images", async () => {
    const { db } = makeDb([{ role: "user", text: "", status: "complete" }]);
    mockedGetFirestore.mockReturnValue(db);

    const messages = await loadRecentMessages("conv-1");
    expect(messages).toHaveLength(0);
  });
});

// Docs as Firestore returns them for loadReplayTargets: newest-first, each with
// an explicit id and arbitrary stored fields.
type IdDoc = { id: string } & Record<string, unknown>;

function makeReplayDb(docsNewestFirst: IdDoc[]) {
  const deleted: string[] = [];

  const messageDocRef = (id: string) => ({
    delete: jest.fn(async () => {
      deleted.push(id);
    }),
  });

  const messagesCollection: Record<string, jest.Mock> = {};
  messagesCollection.orderBy = jest.fn(() => messagesCollection);
  messagesCollection.limit = jest.fn(() => messagesCollection);
  messagesCollection.get = jest.fn(async () => ({
    docs: docsNewestFirst.map(({ id, ...data }) => ({ id, data: () => data })),
  }));
  messagesCollection.doc = jest.fn((id: string) => messageDocRef(id));

  // Spy on conversation-level writes so a test can assert that deletion is
  // side-effect-free (no preview/quota/ledger mutation rides along).
  const convUpdate = jest.fn(async () => undefined);
  const convSet = jest.fn(async () => undefined);
  const conversationRef = {
    collection: jest.fn(() => messagesCollection),
    update: convUpdate,
    set: convSet,
  };
  const conversationsCollection = { doc: jest.fn(() => conversationRef) };
  const db = { collection: jest.fn(() => conversationsCollection) };

  return { db, deleted, convUpdate, convSet };
}

describe("loadReplayTargets", () => {
  const USER = {
    id: "u1",
    role: "user",
    text: "tell me a joke",
    status: "complete",
    clientMessageId: "client-1",
    levelOfRot: 3,
  };
  const AGENT = {
    id: "a1",
    role: "agent",
    text: "here you go",
    status: "complete",
    inReplyToClientMessageId: "client-1",
  };

  it("returns the agent record, its linked user turn, and isLatest=true", async () => {
    const { db } = makeReplayDb([AGENT, USER]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await loadReplayTargets("conv-1", "a1");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.isLatest).toBe(true);
    expect(result.agent.id).toBe("a1");
    expect(result.agent.role).toBe("agent");
    expect(result.user?.id).toBe("u1");
    expect(result.user?.text).toBe("tell me a joke");
    expect(result.user?.levelOfRot).toBe(3);
  });

  it("reports isLatest=false when a newer message exists after the agent reply", async () => {
    const NEWER_USER = { id: "u2", role: "user", text: "next", status: "complete" };
    const { db } = makeReplayDb([NEWER_USER, AGENT, USER]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await loadReplayTargets("conv-1", "a1");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.isLatest).toBe(false);
  });

  it("falls back to the nearest preceding user turn when no inReplyTo link exists", async () => {
    const agentNoLink = { ...AGENT, inReplyToClientMessageId: undefined };
    const { db } = makeReplayDb([agentNoLink, USER]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await loadReplayTargets("conv-1", "a1");

    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.user?.id).toBe("u1");
  });

  it("returns found:false when the agent message id is absent", async () => {
    const { db } = makeReplayDb([USER]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await loadReplayTargets("conv-1", "missing");
    expect(result.found).toBe(false);
  });

  it("returns found:false when the target id is a user message, not an agent", async () => {
    const { db } = makeReplayDb([AGENT, USER]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await loadReplayTargets("conv-1", "u1");
    expect(result.found).toBe(false);
  });

  it("carries the user turn's attachments through the record", async () => {
    const userWithImage = {
      ...USER,
      images: [mkImage()],
    };
    const { db } = makeReplayDb([AGENT, userWithImage]);
    mockedGetFirestore.mockReturnValue(db);

    const result = await loadReplayTargets("conv-1", "a1");
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.user?.images).toEqual([mkImage()]);
  });
});

// Fake for finalizeAgentMessage: the message doc supports .update() (optionally
// throwing), and the conversation doc records its own update. Mirrors the
// real call order: messages/{id}.update(...) then conversations/{id}.update(...).
function makeFinalizeDb(opts: { messageUpdateError?: unknown } = {}) {
  const recorded: {
    messageUpdate?: Record<string, unknown>;
    convUpdate?: Record<string, unknown>;
  } = {};
  const messageRef = {
    update: jest.fn(async (d: Record<string, unknown>) => {
      if (opts.messageUpdateError) throw opts.messageUpdateError;
      recorded.messageUpdate = d;
    }),
  };
  const messagesCollection = { doc: jest.fn(() => messageRef) };
  const conversationRef = {
    update: jest.fn(async (d: Record<string, unknown>) => {
      recorded.convUpdate = d;
    }),
    collection: jest.fn(() => messagesCollection),
  };
  const conversationsCollection = { doc: jest.fn(() => conversationRef) };
  const db = { collection: jest.fn(() => conversationsCollection) };
  return { db, recorded, conversationRef, messageRef };
}

describe("finalizeAgentMessage", () => {
  it("writes the final text + complete status + preview and returns saved:true", async () => {
    const { db, recorded } = makeFinalizeDb();
    mockedGetFirestore.mockReturnValue(db);

    const result = await finalizeAgentMessage("conv-1", "a1", "the final reply");

    expect(result).toEqual({ saved: true });
    expect(recorded.messageUpdate).toMatchObject({
      text: "the final reply",
      status: "complete",
    });
    expect(recorded.convUpdate?.lastMessagePreview).toBe("the final reply");
  });

  it("persists attachments + a 'Sent a meme' preview for an attachment-only reply", async () => {
    const { db, recorded } = makeFinalizeDb();
    mockedGetFirestore.mockReturnValue(db);

    await finalizeAgentMessage("conv-1", "a1", "", [mkImage()]);

    expect(recorded.messageUpdate?.images).toHaveLength(1);
    expect(recorded.convUpdate?.lastMessagePreview).toBe("Sent a meme");
  });

  it("returns saved:false on NOT_FOUND (an explicit pause deleted the doc) and touches nothing else", async () => {
    const notFound = Object.assign(new Error("NOT_FOUND"), { code: 5 });
    const { db, recorded, conversationRef } = makeFinalizeDb({
      messageUpdateError: notFound,
    });
    mockedGetFirestore.mockReturnValue(db);

    const result = await finalizeAgentMessage("conv-1", "a1", "ignored");

    expect(result).toEqual({ saved: false });
    // The conversation preview/timestamp must NOT be written for a vanished doc.
    expect(conversationRef.update).not.toHaveBeenCalled();
    expect(recorded.convUpdate).toBeUndefined();
  });

  it("rethrows a non-NOT_FOUND write failure", async () => {
    const boom = Object.assign(new Error("internal"), { code: 13 });
    const { db } = makeFinalizeDb({ messageUpdateError: boom });
    mockedGetFirestore.mockReturnValue(db);

    await expect(finalizeAgentMessage("conv-1", "a1", "x")).rejects.toThrow("internal");
  });
});

// Fake for watchMessageDeleted: captures the onSnapshot callback so a test can
// emit snapshots, and returns a recognizable unsubscribe.
function makeWatchDb() {
  let onNext: ((snap: { exists: boolean }) => void) | null = null;
  const unsub = jest.fn();
  const messageRef = {
    onSnapshot: jest.fn((next: (snap: { exists: boolean }) => void) => {
      onNext = next;
      return unsub;
    }),
  };
  const messagesCollection = { doc: jest.fn(() => messageRef) };
  const conversationRef = { collection: jest.fn(() => messagesCollection) };
  const conversationsCollection = { doc: jest.fn(() => conversationRef) };
  const db = { collection: jest.fn(() => conversationsCollection) };
  return { db, emit: (snap: { exists: boolean }) => onNext?.(snap), unsub };
}

describe("watchMessageDeleted", () => {
  it("fires onDeleted only when the doc stops existing, and returns the unsubscribe", () => {
    const { db, emit, unsub } = makeWatchDb();
    mockedGetFirestore.mockReturnValue(db);
    const onDeleted = jest.fn();

    const stop = watchMessageDeleted("conv-1", "a1", onDeleted);

    emit({ exists: true }); // initial snapshot: the doc we just created
    expect(onDeleted).not.toHaveBeenCalled();

    emit({ exists: false }); // the pause deleted it — the cancel signal
    expect(onDeleted).toHaveBeenCalledTimes(1);

    expect(stop).toBe(unsub);
  });
});

describe("deleteMessage", () => {
  it("deletes the targeted message doc", async () => {
    const { db, deleted } = makeReplayDb([]);
    mockedGetFirestore.mockReturnValue(db);

    await deleteMessage("conv-1", "a1");
    expect(deleted).toEqual(["a1"]);
  });

  // Billing guard: replay's deletion of the old agent reply must NOT refund or
  // restore anything. There is no refund primitive in the ledger, and the
  // deletion is a pure doc removal — it writes nothing to the conversation doc
  // (no preview, no quota/credit mutation).
  it("is side-effect-free: no conversation/ledger writes accompany the delete", async () => {
    const { db, deleted, convUpdate, convSet } = makeReplayDb([]);
    mockedGetFirestore.mockReturnValue(db);

    await deleteMessage("conv-1", "a1");

    expect(deleted).toEqual(["a1"]);
    expect(convUpdate).not.toHaveBeenCalled();
    expect(convSet).not.toHaveBeenCalled();
  });
});
