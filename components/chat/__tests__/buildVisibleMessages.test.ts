import {
  buildVisibleMessages,
  type BuildVisibleMessagesInput,
} from "@/components/chat/buildVisibleMessages";
import type { MessageGif } from "@/domain/gifs";
import type { MessageImage } from "@/domain/memes";
import type { ChatMessage } from "@/store/chat";

function chatMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: "id",
    role: "user",
    text: "",
    status: "complete",
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<BuildVisibleMessagesInput> = {},
): BuildVisibleMessagesInput {
  return {
    messages: [],
    status: "idle",
    activeReplyClientId: null,
    streamingText: "",
    streamingMeme: null,
    streamingGif: null,
    settledReply: null,
    error: null,
    lastUserMessage: undefined,
    ...overrides,
  };
}

const meme: MessageImage = {
  id: "m1",
  source: "klipy",
  url: "https://cdn/x.webp",
  previewUrl: "https://cdn/x-p.webp",
};
const gif: MessageGif = {
  id: "g1",
  source: "klipy-gif",
  url: "https://cdn/x.gif",
  previewUrl: "https://cdn/x-poster.webp",
  frameSourceUrl: "https://cdn/x-frames.webp",
};

describe("buildVisibleMessages — filtering & ordering", () => {
  it("drops empty placeholders and returns newest-first (inverted list)", () => {
    const result = buildVisibleMessages(
      baseInput({
        messages: [
          chatMessage({ id: "u1", role: "user", text: "hello" }),
          chatMessage({ id: "empty", role: "agent", text: "" }), // dropped
          chatMessage({ id: "a1", role: "agent", text: "hi there" }),
        ],
      }),
    );

    expect(result.map((m) => m.id)).toEqual(["a1", "u1"]);
  });

  it("keeps an image-only user turn that has no text", () => {
    const result = buildVisibleMessages(
      baseInput({
        messages: [chatMessage({ id: "u1", role: "user", images: [meme] })],
      }),
    );
    expect(result.map((m) => m.id)).toEqual(["u1"]);
  });

  it("keeps an errored agent bubble even with empty text", () => {
    const result = buildVisibleMessages(
      baseInput({
        messages: [chatMessage({ id: "err", role: "agent", status: "error" })],
      }),
    );
    expect(result.map((m) => m.id)).toEqual(["err"]);
  });
});

describe("buildVisibleMessages — streaming reply", () => {
  const streamingBase = baseInput({
    status: "streaming",
    activeReplyClientId: "c1",
    messages: [
      chatMessage({ id: "u1", role: "user", text: "hey", clientMessageId: "c1" }),
    ],
  });

  it("appends a thinking placeholder with a stable reply-anchored id", () => {
    const result = buildVisibleMessages(streamingBase);
    const synthetic = result[0];

    expect(synthetic.id).toBe("agent:c1");
    expect(synthetic.role).toBe("agent");
    expect(synthetic.inReplyToClientMessageId).toBe("c1");
    expect(synthetic.status).toBe("streaming");
    expect(synthetic.thinking).toBe(true);
  });

  it("stops thinking once any text has streamed in", () => {
    const result = buildVisibleMessages({
      ...streamingBase,
      streamingText: "partial answer",
    });
    expect(result[0].thinking).toBe(false);
    expect(result[0].text).toBe("partial answer");
  });

  it("carries a streamed meme/gif and stops thinking even with no text", () => {
    const result = buildVisibleMessages({
      ...streamingBase,
      streamingMeme: meme,
      streamingGif: gif,
    });
    expect(result[0].thinking).toBe(false);
    expect(result[0].images).toEqual([meme]);
    expect(result[0].gifs).toEqual([gif]);
  });

  it("does not synthesize a streaming bubble without an active reply id", () => {
    const result = buildVisibleMessages({
      ...streamingBase,
      activeReplyClientId: null,
    });
    expect(result.map((m) => m.id)).toEqual(["u1"]);
  });
});

describe("buildVisibleMessages — settle bridge", () => {
  it("bridges a just-settled reply not yet in the snapshot", () => {
    const result = buildVisibleMessages(
      baseInput({
        messages: [
          chatMessage({ id: "u1", role: "user", text: "q", clientMessageId: "c1" }),
        ],
        settledReply: { clientMessageId: "c1", text: "settled answer" },
      }),
    );

    expect(result[0].id).toBe("agent:c1");
    expect(result[0].text).toBe("settled answer");
    expect(result[0].status).toBe("complete");
  });

  it("does not duplicate when the finalized reply is already stored", () => {
    const result = buildVisibleMessages(
      baseInput({
        messages: [
          chatMessage({ id: "u1", role: "user", text: "q", clientMessageId: "c1" }),
          chatMessage({
            id: "server1",
            role: "agent",
            text: "settled answer",
            inReplyToClientMessageId: "c1",
          }),
        ],
        settledReply: { clientMessageId: "c1", text: "settled answer" },
      }),
    );

    // Only the real stored message + the user turn — no synthetic "agent:c1".
    expect(result.map((m) => m.id)).toEqual(["server1", "u1"]);
  });

  it("ignores the settle bridge while a stream is still active", () => {
    const result = buildVisibleMessages(
      baseInput({
        status: "streaming",
        activeReplyClientId: "c1",
        messages: [
          chatMessage({ id: "u1", role: "user", text: "q", clientMessageId: "c1" }),
        ],
        settledReply: { clientMessageId: "c1", text: "settled answer" },
      }),
    );

    // Streaming branch wins: the bubble is the streaming placeholder, not the
    // settled-complete bridge.
    expect(result[0].id).toBe("agent:c1");
    expect(result[0].status).toBe("streaming");
  });
});

describe("buildVisibleMessages — error card", () => {
  const erroredBase = baseInput({
    status: "error",
    messages: [
      chatMessage({ id: "u1", role: "user", text: "q", clientMessageId: "c1" }),
    ],
    lastUserMessage: chatMessage({
      id: "u1",
      role: "user",
      text: "q",
      clientMessageId: "c1",
    }),
  });

  it("synthesizes a retryable generic error card answering the last turn", () => {
    const result = buildVisibleMessages({ ...erroredBase, error: "network" });
    const card = result[0];

    expect(card.id).toBe("agent-error:u1");
    expect(card.role).toBe("agent");
    expect(card.status).toBe("error");
    expect(card.inReplyToClientMessageId).toBe("c1");
    expect(card.errorKind).toBe("generic");
    expect(card.retry).toBe(true);
  });

  it("marks a signed-out error as non-retryable", () => {
    const result = buildVisibleMessages({ ...erroredBase, error: "signed-out" });
    expect(result[0].errorKind).toBe("signed-out");
    expect(result[0].retry).toBe(false);
  });

  it("does not synthesize a card when the backend already persisted one", () => {
    const result = buildVisibleMessages({
      ...erroredBase,
      error: "network",
      messages: [
        chatMessage({ id: "u1", role: "user", text: "q", clientMessageId: "c1" }),
        chatMessage({ id: "a-err", role: "agent", text: "oops", status: "error" }),
      ],
    });

    expect(result.map((m) => m.id)).toEqual(["a-err", "u1"]);
  });

  it("does not synthesize a card when there is no user turn to anchor it", () => {
    const result = buildVisibleMessages({
      ...erroredBase,
      error: "network",
      messages: [],
      lastUserMessage: undefined,
    });
    expect(result).toEqual([]);
  });
});
