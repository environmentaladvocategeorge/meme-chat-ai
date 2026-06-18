const mockStreamAgentAnswer = jest.fn();
const mockStreamReplayTurn = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);
// Controllable so a test can make the emoji persist resolve or reject (rollback).
const mockSetMessageEmojiCallable = jest.fn();
// Captured so snapshot tests can drive the live listener's callback directly.
const mockSubscribeToMessages = jest.fn((...args: unknown[]) => () => {});
const mockSubscribeToConversationParticipants = jest.fn(
  (...args: unknown[]) => () => {},
);
const mockFetchOlderMessages = jest.fn();

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
  subscribeToMessages: (...args: unknown[]) => mockSubscribeToMessages(...args),
  subscribeToConversationParticipants: (...args: unknown[]) =>
    mockSubscribeToConversationParticipants(...args),
  fetchOlderMessages: (...args: unknown[]) => mockFetchOlderMessages(...args),
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
import type {
  MessageCursor,
  MessagesSnapshotMeta,
  StoredChatMessage,
} from "@/services/firebase/conversations";
import { SessionExpiredError } from "@/services/firebase/sessionErrors";
import {
  shallowEqualMessage,
  useChatStore,
  type ChatMessage,
} from "@/store/chat";

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
  olderMessages: [],
  olderCursor: null,
  hasMoreOlder: false,
  loadingOlder: false,
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

// ---------------------------------------------------------------------------
// Snapshot reconciliation + pagination
// ---------------------------------------------------------------------------

type SnapshotCb = (
  messages: StoredChatMessage[],
  meta: MessagesSnapshotMeta,
) => void;

// The store treats the cursor as opaque (it only hands it back to
// fetchOlderMessages), so a marker object stands in for the doc snapshot.
const fakeCursor = (id: string) => ({ id }) as unknown as MessageCursor;

const META_EMPTY: MessagesSnapshotMeta = { oldestDoc: null, hasMore: false };

function storedMsg(overrides: Partial<StoredChatMessage>): StoredChatMessage {
  return {
    id: "s1",
    role: "agent",
    text: "hi",
    status: "complete",
    createdAt: null,
    ...overrides,
  };
}

// Open a conversation and grab the live listener's callback so tests can
// drive Firestore snapshots directly through applySnapshotMessages.
function openConversation(id = "c1"): SnapshotCb {
  useChatStore.getState().loadConversation(id);
  const call = mockSubscribeToMessages.mock.calls.at(-1);
  return call![1] as SnapshotCb;
}

describe("shallowEqualMessage", () => {
  const base = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
    id: "c-1",
    serverId: "s1",
    clientMessageId: "c-1",
    role: "user",
    text: "hello",
    status: "complete",
    createdAt: null,
    ...overrides,
  });

  it("treats two value-identical messages as equal", () => {
    expect(shallowEqualMessage(base(), base())).toBe(true);
  });

  it.each([
    ["text", { text: "edited" }],
    ["reaction", { reaction: "up" as const }],
    ["emojiReaction", { emojiReaction: "🔥" }],
    ["status", { status: "error" as const }],
    ["optimistic", { optimistic: true }],
  ])("detects a changed %s", (_field, change) => {
    expect(shallowEqualMessage(base(), base(change))).toBe(false);
  });

  it("compares createdAt by instant, with both-null equal", () => {
    expect(shallowEqualMessage(base(), base())).toBe(true); // null vs null
    expect(
      shallowEqualMessage(base({ createdAt: null }), base({ createdAt: new Date(1000) })),
    ).toBe(false);
    expect(
      shallowEqualMessage(
        base({ createdAt: new Date(1000) }),
        base({ createdAt: new Date(1000) }),
      ),
    ).toBe(true);
    expect(
      shallowEqualMessage(
        base({ createdAt: new Date(1000) }),
        base({ createdAt: new Date(2000) }),
      ),
    ).toBe(false);
  });

  it("compares attachments element-wise on id + url, with absent ≡ empty", () => {
    const img = (id: string, url = "https://cdn/x.webp") => ({
      id,
      source: "klipy" as const,
      url,
      previewUrl: "https://cdn/x-p.webp",
    });

    expect(shallowEqualMessage(base({ images: [] }), base())).toBe(true);
    expect(
      shallowEqualMessage(base({ images: [img("m1")] }), base({ images: [img("m1")] })),
    ).toBe(true);
    expect(
      shallowEqualMessage(base({ images: [img("m1")] }), base({ images: [img("m2")] })),
    ).toBe(false);
    expect(
      shallowEqualMessage(
        base({ images: [img("m1")] }),
        base({ images: [img("m1", "https://cdn/other.webp")] }),
      ),
    ).toBe(false);
    expect(shallowEqualMessage(base({ images: [img("m1")] }), base())).toBe(false);
  });
});

describe("useChatStore snapshot reconciliation", () => {
  beforeEach(() => {
    useChatStore.setState({ ...IDLE_STATE });
  });

  afterEach(() => {
    // Tear down the module-level live subscription opened by loadConversation
    // so it can't leak into other suites.
    useChatStore.getState().startNewConversation();
  });

  const snapshotPair = () => [
    storedMsg({ id: "s1", role: "user", text: "q", clientMessageId: "c-1" }),
    storedMsg({ id: "s2", role: "agent", text: "a", inReplyToClientMessageId: "c-1" }),
  ];

  it("subscribes to the conversation's participant bots and stores them", () => {
    useChatStore.getState().loadConversation("c-participants");

    const call = mockSubscribeToConversationParticipants.mock.calls.at(-1);
    expect(call?.[0]).toBe("c-participants");

    // Drive the participants listener and confirm the authoritative set lands.
    const participantsCb = call?.[1] as (ids: string[]) => void;
    participantsCb(["brainrot_bot_default", "user_bot_1"]);
    expect(useChatStore.getState().participantPersonaIds).toEqual([
      "brainrot_bot_default",
      "user_bot_1",
    ]);
  });

  it("keeps referential identity for messages a snapshot re-delivers unchanged", () => {
    const cb = openConversation();

    cb(snapshotPair(), META_EMPTY);
    const first = useChatStore.getState().messages;
    cb(snapshotPair(), META_EMPTY);
    const second = useChatStore.getState().messages;

    expect(second).toHaveLength(2);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });

  it("re-creates only the message that actually changed", () => {
    const cb = openConversation();

    cb(snapshotPair(), META_EMPTY);
    const first = useChatStore.getState().messages;
    const changed = snapshotPair();
    changed[1] = { ...changed[1], emojiReaction: "🔥" };
    cb(changed, META_EMPTY);
    const second = useChatStore.getState().messages;

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1].emojiReaction).toBe("🔥");
  });

  it("keeps a pending optimistic user turn until the snapshot lands it", () => {
    const cb = openConversation();
    const optimistic: ChatMessage = {
      id: "c-9",
      clientMessageId: "c-9",
      role: "user",
      text: "in flight",
      status: "complete",
      createdAt: null,
      optimistic: true,
    };
    useChatStore.setState({ messages: [optimistic] });

    // Snapshot without the in-flight turn: the optimistic copy is appended.
    cb([storedMsg({ id: "s1", role: "user", text: "q", clientMessageId: "c-1" })], META_EMPTY);
    expect(
      useChatStore.getState().messages.map((m) => m.clientMessageId),
    ).toEqual(["c-1", "c-9"]);

    // Once the stored doc lands, the optimistic copy is dropped for it.
    cb(
      [
        storedMsg({ id: "s1", role: "user", text: "q", clientMessageId: "c-1" }),
        storedMsg({ id: "s9", role: "user", text: "in flight", clientMessageId: "c-9" }),
      ],
      META_EMPTY,
    );
    const landed = useChatStore.getState().messages;
    expect(landed.map((m) => m.clientMessageId)).toEqual(["c-1", "c-9"]);
    expect(landed[1].serverId).toBe("s9");
    expect(landed[1].optimistic).toBeUndefined();
  });

  it("hides the doc being replaced during a turn replay", () => {
    const cb = openConversation();
    useChatStore.setState({ replacingServerId: "s2" });

    cb(snapshotPair(), META_EMPTY);

    expect(useChatStore.getState().messages.map((m) => m.serverId)).toEqual(["s1"]);
  });

  it("clears the settled-reply bridge once the finalized reply lands", () => {
    const cb = openConversation();
    useChatStore.setState({
      settledReply: { clientMessageId: "c-1", text: "a" },
    });

    // A snapshot without the finalized reply leaves the bridge up…
    cb([storedMsg({ id: "s1", role: "user", text: "q", clientMessageId: "c-1" })], META_EMPTY);
    expect(useChatStore.getState().settledReply).not.toBeNull();

    // …and the snapshot that lands it (non-empty text on the same turn) drops it.
    cb(snapshotPair(), META_EMPTY);
    expect(useChatStore.getState().settledReply).toBeNull();
  });

  it("leaves the paged-in older prefix untouched", () => {
    const cb = openConversation();
    const prefix: ChatMessage[] = [
      {
        id: "old-1",
        serverId: "old-1",
        role: "user",
        text: "ancient history",
        status: "complete",
        createdAt: null,
      },
    ];
    useChatStore.setState({ olderMessages: prefix });

    cb(snapshotPair(), META_EMPTY);

    expect(useChatStore.getState().olderMessages).toBe(prefix);
  });

  it("seeds the pagination cursor from the live window only until a page is loaded", () => {
    const cb = openConversation();

    cb(snapshotPair(), { oldestDoc: fakeCursor("w1"), hasMore: true });
    expect(useChatStore.getState().olderCursor).toEqual(fakeCursor("w1"));
    expect(useChatStore.getState().hasMoreOlder).toBe(true);

    // Once a prefix exists, the prefix owns the cursor — the sliding live
    // window must not reset it.
    useChatStore.setState({
      olderMessages: [
        {
          id: "old-1",
          serverId: "old-1",
          role: "user",
          text: "x",
          status: "complete",
          createdAt: null,
        },
      ],
      olderCursor: fakeCursor("page-oldest"),
    });
    cb(snapshotPair(), { oldestDoc: fakeCursor("w2"), hasMore: true });
    expect(useChatStore.getState().olderCursor).toEqual(fakeCursor("page-oldest"));
  });

  it("reports no older history when the live window isn't full", () => {
    const cb = openConversation();
    cb(snapshotPair(), { oldestDoc: fakeCursor("w1"), hasMore: false });
    expect(useChatStore.getState().hasMoreOlder).toBe(false);
  });
});

describe("useChatStore loadOlderMessages", () => {
  const tailMessage: ChatMessage = {
    id: "c-tail",
    serverId: "s-tail",
    clientMessageId: "c-tail",
    role: "user",
    text: "latest",
    status: "complete",
    createdAt: null,
  };

  beforeEach(() => {
    mockFetchOlderMessages.mockReset();
    useChatStore.setState({
      ...IDLE_STATE,
      conversationId: "c1",
      messages: [tailMessage],
      olderCursor: fakeCursor("window-oldest"),
      hasMoreOlder: true,
    });
  });

  it("prepends the fetched page and advances the cursor", async () => {
    mockFetchOlderMessages.mockResolvedValue({
      messages: [
        storedMsg({ id: "o1", role: "user", text: "old q" }),
        storedMsg({ id: "o2", role: "agent", text: "old a" }),
      ],
      cursor: fakeCursor("o1"),
      hasMore: true,
    });

    await useChatStore.getState().loadOlderMessages();

    const state = useChatStore.getState();
    expect(mockFetchOlderMessages).toHaveBeenCalledWith(
      "c1",
      fakeCursor("window-oldest"),
    );
    expect(state.olderMessages.map((m) => m.serverId)).toEqual(["o1", "o2"]);
    expect(state.olderCursor).toEqual(fakeCursor("o1"));
    expect(state.hasMoreOlder).toBe(true);
    expect(state.loadingOlder).toBe(false);
    // The live tail is untouched.
    expect(state.messages).toEqual([tailMessage]);
  });

  it("prepends a second page BEFORE the existing prefix (oldest-first order)", async () => {
    useChatStore.setState({
      olderMessages: [
        {
          id: "o3",
          serverId: "o3",
          role: "agent",
          text: "previous page",
          status: "complete",
          createdAt: null,
        },
      ],
    });
    mockFetchOlderMessages.mockResolvedValue({
      messages: [storedMsg({ id: "o1", role: "user", text: "older still" })],
      cursor: fakeCursor("o1"),
      hasMore: true,
    });

    await useChatStore.getState().loadOlderMessages();

    expect(
      useChatStore.getState().olderMessages.map((m) => m.serverId),
    ).toEqual(["o1", "o3"]);
  });

  it("marks history exhausted on a short page", async () => {
    mockFetchOlderMessages.mockResolvedValue({
      messages: [storedMsg({ id: "o1", text: "the very first" })],
      cursor: fakeCursor("o1"),
      hasMore: false,
    });

    await useChatStore.getState().loadOlderMessages();

    expect(useChatStore.getState().hasMoreOlder).toBe(false);
  });

  it("ignores a duplicate call while a page is already in flight", async () => {
    let resolvePage: (value: unknown) => void = () => {};
    mockFetchOlderMessages.mockImplementation(
      () => new Promise((resolve) => (resolvePage = resolve)),
    );

    const first = useChatStore.getState().loadOlderMessages();
    const second = useChatStore.getState().loadOlderMessages();
    resolvePage({ messages: [], cursor: null, hasMore: false });
    await Promise.all([first, second]);

    expect(mockFetchOlderMessages).toHaveBeenCalledTimes(1);
  });

  it("dedupes messages already present in the prefix or the live tail", async () => {
    useChatStore.setState({
      olderMessages: [
        {
          id: "o2",
          serverId: "o2",
          role: "agent",
          text: "already paged",
          status: "complete",
          createdAt: null,
        },
      ],
    });
    mockFetchOlderMessages.mockResolvedValue({
      messages: [
        storedMsg({ id: "o1", text: "genuinely new" }),
        storedMsg({ id: "o2", text: "already paged" }), // straddles page boundary
        storedMsg({ id: "s-tail", role: "user", text: "latest" }), // straddles live window
      ],
      cursor: fakeCursor("o1"),
      hasMore: true,
    });

    await useChatStore.getState().loadOlderMessages();

    expect(
      useChatStore.getState().olderMessages.map((m) => m.serverId),
    ).toEqual(["o1", "o2"]);
  });

  it("no-ops when there is nothing older or no cursor yet", async () => {
    useChatStore.setState({ hasMoreOlder: false });
    await useChatStore.getState().loadOlderMessages();

    useChatStore.setState({ hasMoreOlder: true, olderCursor: null });
    await useChatStore.getState().loadOlderMessages();

    expect(mockFetchOlderMessages).not.toHaveBeenCalled();
  });

  it("releases the loading flag and keeps the cursor on failure (scroll retries)", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockFetchOlderMessages.mockRejectedValue(new Error("offline"));

    await useChatStore.getState().loadOlderMessages();

    const state = useChatStore.getState();
    expect(state.loadingOlder).toBe(false);
    expect(state.hasMoreOlder).toBe(true);
    expect(state.olderCursor).toEqual(fakeCursor("window-oldest"));
    warn.mockRestore();
  });

  it("resets pagination state on loadConversation and startNewConversation", () => {
    const filled = {
      olderMessages: [
        {
          id: "o1",
          serverId: "o1",
          role: "user" as const,
          text: "x",
          status: "complete" as const,
          createdAt: null,
        },
      ],
      olderCursor: fakeCursor("o1"),
      hasMoreOlder: true,
      loadingOlder: true,
    };

    useChatStore.setState(filled);
    useChatStore.getState().loadConversation("c2");
    let state = useChatStore.getState();
    expect(state.olderMessages).toEqual([]);
    expect(state.olderCursor).toBeNull();
    expect(state.hasMoreOlder).toBe(false);
    expect(state.loadingOlder).toBe(false);

    useChatStore.setState(filled);
    useChatStore.getState().startNewConversation();
    state = useChatStore.getState();
    expect(state.olderMessages).toEqual([]);
    expect(state.olderCursor).toBeNull();
    expect(state.hasMoreOlder).toBe(false);
    expect(state.loadingOlder).toBe(false);
  });
});
