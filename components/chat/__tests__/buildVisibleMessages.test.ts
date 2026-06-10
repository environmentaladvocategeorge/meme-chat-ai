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

  it("returns persisted messages by reference (no cloning), so bubble memoization can hold", () => {
    const stored = chatMessage({ id: "u1", role: "user", text: "hello" });
    const result = buildVisibleMessages(baseInput({ messages: [stored] }));
    expect(result[0]).toBe(stored);
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

  it("appends a fixed empty placeholder with a stable reply-anchored id", () => {
    // The placeholder carries NO live stream state — the bubble subscribes to
    // streamingText/meme/gif itself, so delta flushes never rebuild this list.
    const result = buildVisibleMessages(streamingBase);
    const synthetic = result[0];

    expect(synthetic.id).toBe("agent:c1");
    expect(synthetic.role).toBe("agent");
    expect(synthetic.inReplyToClientMessageId).toBe("c1");
    expect(synthetic.status).toBe("streaming");
    expect(synthetic.text).toBe("");
    expect(synthetic.images).toBeUndefined();
    expect(synthetic.gifs).toBeUndefined();
  });

  it("produces deep-equal output across calls with the same inputs", () => {
    // Stability contract: with identical store inputs, consecutive rebuilds
    // describe the same list (referential identity for persisted messages is
    // covered above; the synthesized placeholder is at least value-stable).
    expect(buildVisibleMessages(streamingBase)).toEqual(
      buildVisibleMessages(streamingBase),
    );
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

  it("carries the settled reply's attachments through the bridge", () => {
    const result = buildVisibleMessages(
      baseInput({
        messages: [
          chatMessage({ id: "u1", role: "user", text: "q", clientMessageId: "c1" }),
        ],
        settledReply: {
          clientMessageId: "c1",
          text: "",
          images: [meme],
          gifs: [gif],
        },
      }),
    );

    expect(result[0].id).toBe("agent:c1");
    expect(result[0].images).toEqual([meme]);
    expect(result[0].gifs).toEqual([gif]);
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

  it("synthesizes a standalone, non-retryable hate-speech card not anchored to any turn", () => {
    // The flagged user message was already removed from state, so the card
    // stands alone (no inReplyToClientMessageId, no retry).
    const result = buildVisibleMessages({
      ...erroredBase,
      error: "hate_speech",
      messages: [],
      lastUserMessage: undefined,
    });

    expect(result.map((m) => m.id)).toEqual(["agent-error:hate_speech"]);
    expect(result[0].errorKind).toBe("hate_speech");
    expect(result[0].retry).toBe(false);
    expect(result[0].inReplyToClientMessageId).toBeUndefined();
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
