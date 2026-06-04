const mockStreamAgentAnswer = jest.fn();
const mockStreamReplayTurn = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);
// Controllable so a test can make the emoji persist resolve or reject (rollback).
const mockSetMessageEmojiCallable = jest.fn();

// Mock every module that would otherwise drag in the Firebase SDK / native
// AsyncStorage at import time. SessionExpiredError is left REAL so the
// `instanceof` check inside the chat store matches what the test throws.
jest.mock("@/services/firebase/streamAgent", () => ({
  streamAgentAnswer: (...args: unknown[]) => mockStreamAgentAnswer(...args),
  streamReplayTurn: (...args: unknown[]) => mockStreamReplayTurn(...args),
}));
jest.mock("@/services/firebase/callables", () => ({
  rateMessageCallable: jest.fn(),
  setMessageEmojiCallable: (...args: unknown[]) =>
    mockSetMessageEmojiCallable(...args),
}));
jest.mock("@/services/firebase/conversations", () => ({
  subscribeToMessages: jest.fn(() => () => {}),
}));
jest.mock("@/store/storage", () => ({
  DEFAULT_ROT_LEVEL: 2,
  ChatSessionStorage: {
    read: jest.fn().mockResolvedValue({ conversationId: null, rotLevel: 2 }),
    write: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ language: "system" }) },
}));
jest.mock("@/i18n", () => ({
  resolveLanguage: () => "en",
}));
// Resolved by handleSessionExpired's dynamic import.
jest.mock("@/store/auth", () => ({
  useAuthStore: { getState: () => ({ signOut: mockSignOut }) },
}));

// Imports come after the jest.mock block (which jest hoists) so no module
// import precedes the mocks. SessionExpiredError stays REAL so the chat store's
// `instanceof` check matches what these tests throw.
import { SessionExpiredError } from "@/services/firebase/sessionErrors";
import { useChatStore } from "@/store/chat";

// A stream stand-in that yields nothing and throws `error`.
function throwingStream(error: unknown) {
  return async function* () {
    throw error;
  };
}

// A stream stand-in that yields the given events in order, then completes.
function streamOf(events: unknown[]) {
  return async function* () {
    for (const event of events) yield event;
  };
}

// The store batches delta tokens through requestAnimationFrame; node's test env
// has no RAF, so run callbacks synchronously for deterministic flushing.
function installRafPolyfill() {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: () => void) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  if (!g.requestAnimationFrame) {
    g.requestAnimationFrame = (cb: () => void) => {
      cb();
      return 0;
    };
  }
  if (!g.cancelAnimationFrame) {
    g.cancelAnimationFrame = () => {};
  }
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
}

const IDLE_STATE = {
  conversationId: null,
  messages: [],
  streamingText: "",
  streamingMeme: null,
  streamingGif: null,
  activeReplyClientId: null,
  settledReply: null,
  currentModel: null,
  quota: null,
  status: "idle" as const,
  abortController: null,
  error: null,
};

describe("useChatStore sendMessage auth handling", () => {
  beforeEach(() => {
    mockStreamAgentAnswer.mockReset();
    mockSignOut.mockClear();
    useChatStore.setState(IDLE_STATE);
  });

  it("treats a SessionExpiredError as a terminal auth failure, not a retryable error", async () => {
    mockStreamAgentAnswer.mockImplementation(
      throwingStream(new SessionExpiredError()),
    );

    await useChatStore.getState().sendMessage("hi");
    // handleSessionExpired runs via a fire-and-forget dynamic import.
    await flushMicrotasks();

    const state = useChatStore.getState();
    // No retryable error bubble: status returns to idle with no error string.
    expect(state.status).toBe("idle");
    expect(state.error).toBeNull();
    expect(state.streamingText).toBe("");
    expect(state.activeReplyClientId).toBeNull();
    // Routed to re-auth.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("treats any other stream failure as a generic, retryable error", async () => {
    mockStreamAgentAnswer.mockImplementation(throwingStream(new Error("boom")));

    await useChatStore.getState().sendMessage("hi");
    await flushMicrotasks();

    const state = useChatStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("boom");
    // The user's turn stays so the error card can offer a resend.
    expect(state.messages.some((m) => m.role === "user")).toBe(true);
    // A generic error must NOT sign the user out.
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe("useChatStore replayTurn", () => {
  // A conversation with one user turn and the agent reply we'll regenerate.
  const SEEDED = {
    ...IDLE_STATE,
    conversationId: "c1",
    messages: [
      {
        id: "u1",
        clientMessageId: "u1",
        role: "user" as const,
        text: "tell me a joke",
        status: "complete" as const,
      },
      {
        id: "a1",
        serverId: "a1",
        role: "agent" as const,
        text: "old joke",
        inReplyToClientMessageId: "u1",
        status: "complete" as const,
      },
    ],
  };

  beforeAll(installRafPolyfill);

  beforeEach(() => {
    mockStreamReplayTurn.mockReset();
    mockSignOut.mockClear();
    useChatStore.setState({ ...SEEDED, replacingServerId: null });
  });

  it("optimistically drops the old reply and streams a fresh one for the same turn", async () => {
    mockStreamReplayTurn.mockImplementation(
      streamOf([
        { type: "model", id: "nano" },
        { type: "delta", text: "fresh joke" },
        { type: "done" },
      ]),
    );

    await useChatStore.getState().replayTurn("a1");
    await flushMicrotasks();

    const state = useChatStore.getState();
    // Called with the agent message id + conversation.
    expect(mockStreamReplayTurn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: "c1", agentMessageId: "a1" }),
    );
    // Old reply is gone from the local list; status settled back to idle.
    expect(state.messages.some((m) => m.serverId === "a1")).toBe(false);
    expect(state.status).toBe("idle");
    // The regenerated text rides the settled-reply bridge keyed by the user turn.
    expect(state.settledReply?.clientMessageId).toBe("u1");
    expect(state.settledReply?.text).toBe("fresh joke");
    // The hide-flag is cleared so the snapshot reconciles normally.
    expect(state.replacingServerId).toBeNull();
  });

  it("does nothing when another turn is already streaming", async () => {
    useChatStore.setState({ status: "streaming" });
    await useChatStore.getState().replayTurn("a1");
    expect(mockStreamReplayTurn).not.toHaveBeenCalled();
  });

  it("restores the old reply on quota_exceeded (nothing deleted server-side)", async () => {
    mockStreamReplayTurn.mockImplementation(
      streamOf([{ type: "quota_exceeded", reason: "monthly", resetAt: null }]),
    );

    await useChatStore.getState().replayTurn("a1");
    await flushMicrotasks();

    const state = useChatStore.getState();
    expect(state.quota).toEqual({ reason: "monthly", resetAt: null });
    expect(state.status).toBe("idle");
    // replacingServerId cleared → the still-present Firestore doc can re-render.
    expect(state.replacingServerId).toBeNull();
  });

  it("treats a SessionExpiredError on replay as a terminal auth failure", async () => {
    mockStreamReplayTurn.mockImplementation(
      throwingStream(new SessionExpiredError()),
    );

    await useChatStore.getState().replayTurn("a1");
    await flushMicrotasks();

    const state = useChatStore.getState();
    expect(state.status).toBe("idle");
    expect(state.error).toBeNull();
    expect(state.replacingServerId).toBeNull();
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it("treats any other replay failure as a generic, retryable error", async () => {
    mockStreamReplayTurn.mockImplementation(throwingStream(new Error("boom")));

    await useChatStore.getState().replayTurn("a1");
    await flushMicrotasks();

    const state = useChatStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("boom");
    expect(state.replacingServerId).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});

describe("useChatStore setMessageEmoji", () => {
  // A finalized agent reply we can react to. `emojiReaction` is varied per test.
  const seed = (emojiReaction?: string) => ({
    ...IDLE_STATE,
    conversationId: "c1",
    messages: [
      {
        id: "a1",
        serverId: "a1",
        role: "agent" as const,
        text: "lol",
        status: "complete" as const,
        ...(emojiReaction ? { emojiReaction } : {}),
      },
    ],
  });

  const emojiOf = (serverId: string) =>
    useChatStore.getState().messages.find((m) => m.serverId === serverId)
      ?.emojiReaction;

  beforeEach(() => {
    mockSetMessageEmojiCallable.mockReset().mockResolvedValue({
      success: true,
      emoji: null,
    });
    useChatStore.setState(seed());
  });

  it("optimistically applies the emoji and persists it with the resolved value", () => {
    useChatStore.getState().setMessageEmoji("a1", "🔥");

    // Reflected locally before the server confirms.
    expect(emojiOf("a1")).toBe("🔥");
    expect(mockSetMessageEmojiCallable).toHaveBeenCalledWith({
      conversationId: "c1",
      messageId: "a1",
      emoji: "🔥",
    });
  });

  it("toggles the active emoji off (persists null) when it's tapped again", () => {
    useChatStore.setState(seed("🔥"));

    useChatStore.getState().setMessageEmoji("a1", "🔥");

    expect(emojiOf("a1")).toBeUndefined();
    expect(mockSetMessageEmojiCallable).toHaveBeenCalledWith({
      conversationId: "c1",
      messageId: "a1",
      emoji: null,
    });
  });

  it("switches to a different emoji rather than clearing", () => {
    useChatStore.setState(seed("🔥"));

    useChatStore.getState().setMessageEmoji("a1", "😂");

    expect(emojiOf("a1")).toBe("😂");
    expect(mockSetMessageEmojiCallable).toHaveBeenCalledWith(
      expect.objectContaining({ emoji: "😂" }),
    );
  });

  it("rolls back to the previous emoji when the persist call fails", async () => {
    useChatStore.setState(seed("🫡"));
    mockSetMessageEmojiCallable.mockRejectedValue(new Error("offline"));

    useChatStore.getState().setMessageEmoji("a1", "💀");
    // Optimistic value shows first…
    expect(emojiOf("a1")).toBe("💀");

    await flushMicrotasks();
    // …then reverts to what was there before once the callable rejects.
    expect(emojiOf("a1")).toBe("🫡");
  });

  it("is a no-op with no active conversation", () => {
    useChatStore.setState({ ...seed(), conversationId: null });

    useChatStore.getState().setMessageEmoji("a1", "🔥");

    expect(mockSetMessageEmojiCallable).not.toHaveBeenCalled();
  });

  it("is a no-op when the target message isn't in the list", () => {
    useChatStore.getState().setMessageEmoji("missing", "🔥");

    expect(mockSetMessageEmojiCallable).not.toHaveBeenCalled();
    expect(emojiOf("a1")).toBeUndefined();
  });
});
