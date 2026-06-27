let mockAvailable = true;
const mockCallable = jest.fn();
const mockHttpsCallable = jest.fn((..._args: unknown[]) => mockCallable);

jest.mock("firebase/functions", () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

jest.mock("../app", () => ({
  getFirebaseServices: () =>
    mockAvailable
      ? { available: true, services: { functions: { __fns: true } } }
      : { available: false, reason: "missing-config" },
}));

import { cancelAgentReplyCallable, rateMessageCallable } from "../callables";

beforeEach(() => {
  mockAvailable = true;
  mockCallable.mockReset();
});

describe("callable wrappers", () => {
  it("targets the right function, forwards args, and unwraps .data", async () => {
    mockCallable.mockResolvedValue({ data: { success: true, deleted: 1 } });

    const out = await cancelAgentReplyCallable({ conversationId: "c1", messageId: "a1" });

    expect(mockHttpsCallable).toHaveBeenCalledWith({ __fns: true }, "cancelAgentReply");
    expect(mockCallable).toHaveBeenCalledWith({ conversationId: "c1", messageId: "a1" });
    expect(out).toEqual({ success: true, deleted: 1 });
  });

  it("unwraps .data for a different callable + target name", async () => {
    mockCallable.mockResolvedValue({ data: { success: true, reaction: "up" } });

    const out = await rateMessageCallable({
      conversationId: "c1",
      messageId: "m1",
      reaction: "up",
    });

    expect(mockHttpsCallable).toHaveBeenCalledWith({ __fns: true }, "rateMessage");
    expect(out).toEqual({ success: true, reaction: "up" });
  });

  it("throws firebase-unavailable and never builds a callable when Firebase is down", async () => {
    mockAvailable = false;

    await expect(
      cancelAgentReplyCallable({ conversationId: "c1", messageId: "a1" }),
    ).rejects.toThrow("firebase-unavailable");
    expect(mockHttpsCallable).not.toHaveBeenCalled();
  });
});
