import { streamReplayRequestSchema } from "../streamReplayRequest";

describe("streamReplayRequestSchema", () => {
  it("accepts a minimal valid replay request", () => {
    const result = streamReplayRequestSchema.safeParse({
      conversationId: "conv-1",
      agentMessageId: "msg-1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional language", () => {
    const result = streamReplayRequestSchema.safeParse({
      conversationId: "conv-1",
      agentMessageId: "msg-1",
      language: "es",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing conversationId", () => {
    const result = streamReplayRequestSchema.safeParse({ agentMessageId: "msg-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing agentMessageId", () => {
    const result = streamReplayRequestSchema.safeParse({ conversationId: "conv-1" });
    expect(result.success).toBe(false);
  });

  it("rejects empty-string ids", () => {
    expect(
      streamReplayRequestSchema.safeParse({ conversationId: "", agentMessageId: "m" })
        .success,
    ).toBe(false);
    expect(
      streamReplayRequestSchema.safeParse({ conversationId: "c", agentMessageId: "  " })
        .success,
    ).toBe(false);
  });

  it("rejects a too-short language code", () => {
    const result = streamReplayRequestSchema.safeParse({
      conversationId: "conv-1",
      agentMessageId: "msg-1",
      language: "e",
    });
    expect(result.success).toBe(false);
  });
});
