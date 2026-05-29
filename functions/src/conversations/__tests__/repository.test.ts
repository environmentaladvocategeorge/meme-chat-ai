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
  loadRecentMessages,
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
  };
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

  it("uses the message text when text is present", async () => {
    const { db, recorded } = makeDb();
    mockedGetFirestore.mockReturnValue(db);

    await createConversation("user-1", "hello world", { hasImages: false });

    expect(recorded.convSet?.title).toBe("hello world");
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
