import { messageKey, type RenderMessage } from "@/components/chat/types";

function msg(overrides: Partial<RenderMessage>): RenderMessage {
  return {
    id: "fallback-id",
    role: "agent",
    text: "hi",
    status: "complete",
    ...overrides,
  } as RenderMessage;
}

describe("messageKey", () => {
  it("keys an agent reply by the user turn it answers (lifecycle continuity)", () => {
    // The streaming placeholder, the settle bridge, and the finalized message
    // all carry the same inReplyToClientMessageId, so they resolve to ONE key
    // and the bubble never remounts.
    const streaming = msg({
      id: "agent:client-7",
      inReplyToClientMessageId: "client-7",
      status: "streaming",
    });
    const finalized = msg({
      id: "server-doc-id",
      serverId: "server-doc-id",
      inReplyToClientMessageId: "client-7",
      status: "complete",
    });

    expect(messageKey(streaming)).toBe("agent:client-7");
    expect(messageKey(finalized)).toBe("agent:client-7");
    expect(messageKey(streaming)).toBe(messageKey(finalized));
  });

  it("falls back to the raw id for an agent message with no reply linkage", () => {
    expect(messageKey(msg({ id: "loose-agent", role: "agent" }))).toBe(
      "loose-agent",
    );
  });

  it("keys user messages by their own id (never by reply linkage)", () => {
    const user = msg({
      id: "user-3",
      role: "user",
      inReplyToClientMessageId: "client-7",
    });
    expect(messageKey(user)).toBe("user-3");
  });
});
