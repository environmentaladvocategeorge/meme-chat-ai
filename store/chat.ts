import type { MessageGif } from "@/domain/gifs";
import type { MessageImage } from "@/domain/memes";
import type { MessageSticker } from "@/domain/stickers";
import {
  cancelAgentReplyCallable,
  rateMessageCallable,
  setMessageEmojiCallable,
} from "@/services/firebase/callables";
import {
  fetchOlderMessages,
  newConversationId,
  subscribeToConversationParticipants,
  subscribeToMessages,
  type MessageCursor,
  type MessagesSnapshotMeta,
  type StoredChatMessage,
} from "@/services/firebase/conversations";
import { streamAgentAnswer, streamReplayTurn } from "@/services/firebase/streamAgent";
import { SessionExpiredError } from "@/services/firebase/sessionErrors";
import { ChatSessionStorage, DEFAULT_ROT_LEVEL } from "@/store/storage";
import { useSettingsStore } from "@/store/settings";
import { usePersonaStore } from "@/store/personas";
import { DEFAULT_PERSONA_ID } from "@/domain/personas";
import { resolveLanguage } from "@/i18n";
import { create } from "zustand";

export type MessageReaction = "up" | "down";

export type ChatMessage = {
  id: string;
  serverId?: string;
  clientMessageId?: string;
  inReplyToClientMessageId?: string;
  role: "user" | "agent";
  text: string;
  // Image attachments on a user turn (Klipy memes). Empty/absent for agent
  // turns and text-only user turns.
  images?: MessageImage[];
  // GIF attachment on a turn (max one). On a user turn it's a sent GIF; on an
  // agent turn it's a get_gif result.
  gifs?: MessageGif[];
  // Sticker attachments on a user turn (up to MAX_MESSAGE_STICKERS). User-send-
  // only — agent turns never carry stickers. Combinable with images + a gif.
  stickers?: MessageSticker[];
  // Thumbs rating on an agent reply (persisted server-side).
  reaction?: MessageReaction;
  // Emoji reaction on an agent reply (persisted server-side). Independent of the
  // thumbs rating — a message can have both.
  emojiReaction?: string;
  // Brainrot intensity selected for a user turn (1–3). Absent on agent turns.
  levelOfRot?: number;
  // The persona that generated this agent reply (id). Drives the per-message bot
  // avatar shown once a conversation has 2+ participants. Absent on user turns
  // and on default-bot turns from before personas were tracked.
  personaId?: string;
  status: "complete" | "streaming" | "error";
  createdAt?: Date | null;
  optimistic?: boolean;
};

type ChatStatus = "idle" | "streaming" | "error";

export type QuotaInfo = {
  reason: string;
  resetAt: string | null;
};

type SettledReply = {
  // The clientMessageId of the user turn this agent reply answers. Matches
  // the stored agent message's `inReplyToClientMessageId`.
  clientMessageId: string;
  text: string;
  // A meme the agent attached, carried through the settle window so it stays
  // visible until the finalized Firestore message (which also has it) lands.
  images?: MessageImage[];
  // A GIF the agent attached, carried through the same settle window.
  gifs?: MessageGif[];
};

type ChatState = {
  conversationId: string | null;
  // Sticky brainrot dial (1–3), applied to every turn. Persisted locally so it
  // survives an app restart; hydrated via `hydrateSession`.
  rotLevel: number;
  // Sticky local-only answering prefs, applied to every turn and sent in the
  // stream payload. Persisted on device (never to the cloud), hydrated via
  // `hydrateSession`. Both default to true.
  respondWithEmojis: boolean;
  respondWithMedia: boolean;
  // The LIVE tail of the conversation: the most recent window of stored
  // messages (mirrored from the capped Firestore listener) plus optimistic
  // sends. All streaming/settled/optimistic logic operates on this list only.
  messages: ChatMessage[];
  // Static prefix of older messages paged in on demand (oldest-first). The
  // rendered thread is [...olderMessages, ...messages]; the prefix is never
  // touched by snapshot reconciliation.
  olderMessages: ChatMessage[];
  // Cursor for the next older page: the oldest already-loaded doc. Seeded
  // from the live window's oldest doc, then advanced by each fetched page.
  olderCursor: MessageCursor | null;
  hasMoreOlder: boolean;
  loadingOlder: boolean;
  // Authoritative set of bots that have ever sent in this conversation (live
  // from the conversation doc). Drives the per-message bot avatar once 2+ bots
  // are involved, even when an earlier bot's replies have scrolled out of the
  // live window. Empty until a conversation is loaded.
  participantPersonaIds: string[];
  // Page older history in (no-op while already loading or when exhausted).
  loadOlderMessages: () => Promise<void>;
  streamingText: string;
  // A meme the agent attached to the in-flight reply (via the backend get_meme
  // tool), shown on the streaming bubble until the reply settles.
  streamingMeme: MessageImage | null;
  // A GIF the agent attached to the in-flight reply (via get_gif), same role as
  // streamingMeme.
  streamingGif: MessageGif | null;
  // Firestore id of the in-flight agent reply, captured from the SSE `message`
  // (role agent) event. Lets Pause delete the exact doc and lets a dropped
  // stream wait on the right reply. Cleared when streaming ends.
  streamingAgentServerId: string | null;
  // serverId of an agent reply locally suppressed after a Pause, until the
  // server-side delete reaches the live snapshot — so a streaming/finalized doc
  // doesn't flash back in before it's gone. Mirrors replacingServerId.
  cancelledServerId: string | null;
  // Set when the live stream drops UNEXPECTEDLY (network/background/timeout)
  // while the backend is still finalizing the reply. Instead of showing an
  // error, we keep the typing bubble and defer to the Firestore listener, which
  // delivers the finished reply (or its error) and clears this. A grace timer is
  // the fallback. Null during normal streaming.
  awaitingPersistedReply: {
    clientMessageId: string | null;
    agentServerId: string | null;
  } | null;
  // clientMessageId of a user turn whose reply errored LOCALLY (a transport
  // drop / background kill before we learned the reply's server id, so it never
  // entered awaitingPersistedReply). The finish-&-save backend can still
  // finalize that reply; when it lands in the snapshot we heal the stuck error
  // instead of showing both the reply and "that didn't go through". Set only by
  // the catch error branch; null whenever status is anything other than the
  // error it armed.
  erroredReplyClientId: string | null;
  // clientMessageId of the user turn whose agent reply is currently
  // streaming. Used to give the in-flight agent bubble a STABLE identity
  // (`agent:<clientMessageId>`) that matches the stored Firestore message
  // once it's finalized — so the bubble never unmounts/remounts (which was
  // causing the post-stream flicker + replayed entrance animation).
  activeReplyClientId: string | null;
  // After the stream's `done` event we keep the final text here, keyed by
  // the user turn, until the finalized agent message lands in the Firestore
  // snapshot. This bridges the gap between `done` (sent before the backend
  // writes the final text) and the snapshot, so the reply never blinks out.
  settledReply: SettledReply | null;
  // serverId of an agent reply currently being regenerated (turn replay). The
  // backend deletes that doc shortly after the stream starts, but until the
  // deletion reaches the live snapshot we hide it locally so the old reply
  // doesn't flash back beneath the new streaming bubble. Cleared when the
  // replay settles.
  replacingServerId: string | null;
  // Internal model ID returned by the backend in the `model` SSE event
  // (e.g. "smart-nano", "smart-mini"). Cleared when streaming ends.
  currentModel: string | null;
  // Set when the backend rejects a request with quota_exceeded. UI clears
  // this when the user acknowledges the modal.
  quota: QuotaInfo | null;
  status: ChatStatus;
  abortController: AbortController | null;
  error: string | null;
  sendMessage: (
    text: string,
    images?: MessageImage[],
    gif?: MessageGif | null,
    stickers?: MessageSticker[],
    levelOfRot?: number,
  ) => Promise<void>;
  // Regenerate an agent reply: delete it server-side and stream a fresh answer
  // for the same user turn (with randomized sampling). `agentServerId` is the
  // stored agent message's id. No-op while another turn is streaming.
  replayTurn: (agentServerId: string) => Promise<void>;
  // Optimistically set/toggle a thumbs rating on an agent message, then persist
  // it. Tapping the already-active thumb clears the rating.
  rateMessage: (serverId: string, reaction: MessageReaction) => void;
  // Optimistically set/toggle an emoji reaction on an agent message, then
  // persist it. Tapping the already-active emoji clears it.
  setMessageEmoji: (serverId: string, emoji: string) => void;
  loadConversation: (id: string) => void;
  startNewConversation: () => void;
  // Explicit Pause: durably delete the in-flight agent reply server-side (so it
  // can never re-appear via the listener) and clear local streaming state.
  pauseStreaming: () => void;
  // Local-only detach used when leaving the conversation (load/new): abort the
  // stream and clear local state, but let the backend finish + persist the reply
  // (finish & save) so it's there on return. Does NOT delete server-side.
  cancelStreaming: () => void;
  dismissQuota: () => void;
  // Update the sticky rot level and persist it.
  setRotLevel: (level: number) => void;
  // Toggle the local-only answering prefs and persist them.
  setRespondWithEmojis: (value: boolean) => void;
  setRespondWithMedia: (value: boolean) => void;
  // Restore the persisted rot level and (optionally) re-open the last
  // conversation. Called once when the chat screen mounts on app open.
  hydrateSession: (options?: { autoLoadConversation?: boolean }) => Promise<void>;
};

let unsubscribeMessages: (() => void) | null = null;
let unsubscribeParticipants: (() => void) | null = null;
let optimisticCounter = 0;

// Fallback timeout for the "awaiting persisted reply" state (a dropped stream
// whose reply the backend is still finalizing). Normally the Firestore listener
// resolves it the moment the reply lands; this only fires in the rare case the
// reply never persists (e.g. the backend died after creating the doc), turning
// an endless typing bubble into a retryable error. Generous on purpose — a slow
// reply must not trip it, since the backend writes the doc only at finalize.
const AWAIT_GRACE_MS = 60_000;
let awaitTimer: ReturnType<typeof setTimeout> | null = null;

function clearAwaitTimer() {
  if (awaitTimer !== null) {
    clearTimeout(awaitTimer);
    awaitTimer = null;
  }
}

// Transport-level stream failures (the SSE socket dropped mid-flight) as opposed
// to a real backend error. A transport drop while the backend is still
// finalizing should defer to Firestore, not show an error — see sendMessage's
// catch. ("aborted" reaching the catch means the OS tore the XHR down, since our
// own aborts are caught by the `controller.signal.aborted` branch first.)
const TRANSPORT_DROP_CODES = new Set([
  "stream-network-error",
  "stream-timeout",
  "aborted",
]);

function isTransportDrop(code: string): boolean {
  return TRANSPORT_DROP_CODES.has(code);
}

// True when a content-bearing agent reply for `clientMessageId` is present in
// `messages` — matched by the reply's server id when we know it, else by the
// user turn it answers (inReplyToClientMessageId, which the backend stamps onto
// every reply). Shared by the stream-drop catch and the snapshot heal so both
// agree on what "the reply actually landed" means. An empty placeholder or a
// status:"error" reply has no content and does NOT count as landed.
function replyLanded(
  messages: ChatMessage[],
  clientMessageId: string,
  agentServerId: string | null,
): boolean {
  return messages.some(
    (message) =>
      message.role === "agent" &&
      ((agentServerId != null && message.serverId === agentServerId) ||
        message.inReplyToClientMessageId === clientMessageId) &&
      (message.status === "complete" ||
        message.text.length > 0 ||
        (message.images?.length ?? 0) > 0 ||
        (message.gifs?.length ?? 0) > 0),
  );
}

type SetState = (
  partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
) => void;

// Arm the awaiting-reply fallback: if the reply still hasn't landed after the
// grace window, surface a retryable error instead of a stuck typing bubble.
function startAwaitTimer(set: SetState, get: () => ChatState) {
  clearAwaitTimer();
  awaitTimer = setTimeout(() => {
    awaitTimer = null;
    if (!get().awaitingPersistedReply) return;
    set({
      awaitingPersistedReply: null,
      erroredReplyClientId: null,
      status: "error",
      streamingText: "",
      streamingMeme: null,
      streamingGif: null,
      streamingAgentServerId: null,
      activeReplyClientId: null,
      settledReply: null,
      abortController: null,
      currentModel: null,
      error: "generic",
    });
  }, AWAIT_GRACE_MS);
}

// Delta batching — accumulate SSE token chunks and flush once per animation
// frame instead of calling set() on every individual token. Reduces re-renders
// from ~800 per response down to ~10, keeping the JS thread free for touches.
let deltaBuffer = "";
let deltaRafId: ReturnType<typeof requestAnimationFrame> | null = null;

function flushDeltaBuffer(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
) {
  if (deltaBuffer.length === 0) return;
  const chunk = deltaBuffer;
  deltaBuffer = "";
  deltaRafId = null;
  set((state: ChatState) => ({
    streamingText: `${state.streamingText}${chunk}`,
  }));
}

function cancelDeltaFlush() {
  if (deltaRafId !== null) {
    cancelAnimationFrame(deltaRafId);
    deltaRafId = null;
  }
  deltaBuffer = "";
}

// End-of-stream flush: cancel the pending RAF and drain any buffered tokens
// synchronously, so the final streamingText is complete before it's read —
// the RAF may not have fired yet if the stream ended fast.
function flushDeltaBufferSync(
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
) {
  if (deltaRafId !== null) {
    cancelAnimationFrame(deltaRafId);
    deltaRafId = null;
  }
  if (deltaBuffer.length > 0) {
    const remaining = deltaBuffer;
    deltaBuffer = "";
    set((state: ChatState) => ({
      streamingText: `${state.streamingText}${remaining}`,
    }));
  }
}

function createClientMessageId() {
  optimisticCounter += 1;
  return [
    "client",
    Date.now().toString(36),
    optimisticCounter.toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join("-");
}

function cleanupSubscription() {
  unsubscribeMessages?.();
  unsubscribeMessages = null;
  unsubscribeParticipants?.();
  unsubscribeParticipants = null;
}

// Start (or restart) the live participants subscription for a conversation,
// feeding the authoritative bot set into state. Additive + best-effort: if it
// never fires, multiBot falls back to the message-derived personas.
function startParticipantsSubscription(
  id: string,
  set: (partial: Partial<ChatState>) => void,
) {
  unsubscribeParticipants?.();
  unsubscribeParticipants = subscribeToConversationParticipants(id, (ids) => {
    set({ participantPersonaIds: ids });
  });
}

// The stream reported a terminal auth failure (token rejected even after a
// forced refresh, or the refresh token itself is dead). Retrying is pointless,
// so hand off to the auth store to sign out — onAuthStateChanged then routes
// the app to the sign-in screen. Imported lazily to avoid a static import cycle
// (store/auth imports this chat store at module load).
async function handleSessionExpired(): Promise<void> {
  try {
    const { useAuthStore } = await import("@/store/auth");
    await useAuthStore.getState().signOut();
  } catch (err) {
    console.warn("[chat] session-expired sign-out failed:", err);
  }
}

function fromStoredMessage(message: StoredChatMessage): ChatMessage {
  return {
    ...message,
    id: message.clientMessageId ?? message.id,
    serverId: message.id,
  };
}

// Attachment arrays are equal when they pair up element-wise on id + url —
// the only fields whose change should repaint a bubble. Both-absent (or
// absent vs. empty) counts as equal.
function sameAttachments(
  a: { id: string; url: string }[] | undefined,
  b: { id: string; url: string }[] | undefined,
): boolean {
  const aLen = a?.length ?? 0;
  const bLen = b?.length ?? 0;
  if (aLen !== bLen) return false;
  for (let i = 0; i < aLen; i++) {
    if (a![i].id !== b![i].id || a![i].url !== b![i].url) return false;
  }
  return true;
}

// Field-by-field equality over ChatMessage, used to keep a previous message
// object (and thus its bubble's memo) when a Firestore snapshot re-delivers it
// unchanged. Explicit on this hot path — no generic deep-equal.
export function shallowEqualMessage(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.id === b.id &&
    a.serverId === b.serverId &&
    a.clientMessageId === b.clientMessageId &&
    a.inReplyToClientMessageId === b.inReplyToClientMessageId &&
    a.role === b.role &&
    a.text === b.text &&
    a.reaction === b.reaction &&
    a.emojiReaction === b.emojiReaction &&
    a.levelOfRot === b.levelOfRot &&
    a.personaId === b.personaId &&
    a.status === b.status &&
    a.optimistic === b.optimistic &&
    // Both-null/absent counts as equal; otherwise compare the instant.
    (a.createdAt?.getTime() ?? null) === (b.createdAt?.getTime() ?? null) &&
    sameAttachments(a.images, b.images) &&
    sameAttachments(a.gifs, b.gifs) &&
    sameAttachments(a.stickers, b.stickers)
  );
}

function applySnapshotMessages(
  messages: StoredChatMessage[],
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
) {
  if (messages.length === 0 && get().status === "streaming") return;
  // Reuse the previous object for any message the snapshot re-delivers
  // unchanged, so its (memoized) bubble doesn't re-render. Only messages that
  // actually changed get a fresh object.
  const prevByServerId = new Map(
    get().messages.flatMap((m) => (m.serverId ? [[m.serverId, m] as const] : [])),
  );
  // While a reply is being regenerated, hide its (soon-to-be-deleted) doc so it
  // doesn't flash back beneath the new streaming bubble before the server-side
  // deletion reaches this snapshot. Same for a reply the user just Paused
  // (cancelledServerId): suppress it locally until its delete lands.
  const replacingServerId = get().replacingServerId;
  const cancelledServerId = get().cancelledServerId;
  const storedMessages = messages
    .filter(
      (message) =>
        message.id !== replacingServerId && message.id !== cancelledServerId,
    )
    .map((message) => {
      const converted = fromStoredMessage(message);
      const prev = prevByServerId.get(message.id);
      return prev && shallowEqualMessage(prev, converted) ? prev : converted;
    });
  const storedClientMessageIds = new Set(
    storedMessages.flatMap((message) =>
      message.clientMessageId ? [message.clientMessageId] : [],
    ),
  );
  const pendingOptimisticUsers = get().messages.filter(
    (message) => {
      if (message.optimistic !== true || message.role !== "user") return false;
      return !message.clientMessageId || !storedClientMessageIds.has(message.clientMessageId);
    },
  );

  // Once the finalized agent message lands in the snapshot (matched by the
  // user turn it replies to, with non-empty text) the settled-reply bridge
  // has served its purpose — drop it so we stop overlaying.
  const settled = get().settledReply;
  const settledLanded =
    settled !== null &&
    storedMessages.some(
      (message) =>
        message.role === "agent" &&
        message.inReplyToClientMessageId === settled.clientMessageId &&
        message.text.length > 0,
    );

  // A dropped stream is waiting on the backend to finalize its reply. When that
  // reply lands here, resolve the wait: a finished reply ends cleanly (no error
  // card), an errored one shows the error. An empty `streaming` placeholder is
  // dropped by the snapshot mapper, so a present agent reply always means done.
  const awaiting = get().awaitingPersistedReply;
  let awaitingResolution: Partial<ChatState> | null = null;
  if (awaiting) {
    const reply = storedMessages.find(
      (message) =>
        message.role === "agent" &&
        ((awaiting.agentServerId != null &&
          message.serverId === awaiting.agentServerId) ||
          (awaiting.clientMessageId != null &&
            message.inReplyToClientMessageId === awaiting.clientMessageId)),
    );
    const hasContent =
      reply != null &&
      (reply.status === "complete" ||
        reply.text.length > 0 ||
        (reply.images?.length ?? 0) > 0 ||
        (reply.gifs?.length ?? 0) > 0);
    if (reply && reply.status === "error") {
      clearAwaitTimer();
      awaitingResolution = {
        awaitingPersistedReply: null,
        erroredReplyClientId: null,
        status: "error",
        activeReplyClientId: null,
        settledReply: null,
        streamingText: "",
        streamingMeme: null,
        streamingGif: null,
        streamingAgentServerId: null,
        abortController: null,
        currentModel: null,
        error: "generic",
      };
    } else if (hasContent) {
      clearAwaitTimer();
      awaitingResolution = {
        awaitingPersistedReply: null,
        status: "idle",
        activeReplyClientId: null,
        settledReply: null,
        streamingText: "",
        streamingMeme: null,
        streamingGif: null,
        streamingAgentServerId: null,
        abortController: null,
        currentModel: null,
        error: null,
      };
    }
  }

  // A turn that errored locally (a transport drop / background kill before we
  // learned the reply's server id, so it never entered awaitingPersistedReply)
  // can still have its reply finalized by the finish-&-save backend. When that
  // finished, content-bearing reply lands here, clear the stuck error so the
  // feed doesn't show both the reply and "that didn't go through". A persisted
  // *error* reply (empty, status "error") doesn't match, so a genuine failure
  // keeps its error card.
  const erroredClientId = get().erroredReplyClientId;
  let erroredHeal: Partial<ChatState> | null = null;
  if (get().status === "error" && erroredClientId) {
    const healed = replyLanded(storedMessages, erroredClientId, null);
    if (healed) {
      erroredHeal = {
        status: "idle",
        error: null,
        erroredReplyClientId: null,
      };
    }
  }

  // Drop the local suppression of a Paused reply once its server-side delete has
  // reached this snapshot (the doc is no longer present).
  const clearCancelled =
    cancelledServerId !== null &&
    !messages.some((message) => message.id === cancelledServerId);

  set({
    messages: [...storedMessages, ...pendingOptimisticUsers],
    ...(settledLanded ? { settledReply: null } : null),
    ...(clearCancelled ? { cancelledServerId: null } : null),
    ...(awaitingResolution ?? null),
    ...(erroredHeal ?? null),
  });
}

// Snapshot handler for the live listener: reconcile the tail, then seed the
// pagination cursor from the window's oldest doc. The seed only runs until the
// first older page is loaded (or while one is in flight) — after that the
// paged-in prefix owns the cursor.
function handleMessagesSnapshot(
  messages: StoredChatMessage[],
  meta: MessagesSnapshotMeta,
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
) {
  applySnapshotMessages(messages, get, set);
  if (get().olderMessages.length === 0 && !get().loadingOlder) {
    set({
      olderCursor: meta.oldestDoc,
      hasMoreOlder: meta.hasMore && meta.oldestDoc !== null,
    });
  }
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversationId: null,
  rotLevel: DEFAULT_ROT_LEVEL,
  respondWithEmojis: true,
  respondWithMedia: true,
  messages: [],
  olderMessages: [],
  olderCursor: null,
  hasMoreOlder: false,
  loadingOlder: false,
  participantPersonaIds: [],
  streamingText: "",
  streamingMeme: null,
  streamingGif: null,
  streamingAgentServerId: null,
  cancelledServerId: null,
  awaitingPersistedReply: null,
  erroredReplyClientId: null,
  activeReplyClientId: null,
  settledReply: null,
  replacingServerId: null,
  currentModel: null,
  quota: null,
  status: "idle",
  abortController: null,
  error: null,

  sendMessage: async (text, images = [], gif = null, stickers = [], levelOfRot) => {
    const trimmed = text.trim();
    // Attachment-only turns are allowed: require text OR a meme OR a gif OR a
    // sticker.
    if (
      (trimmed.length === 0 &&
        images.length === 0 &&
        !gif &&
        stickers.length === 0) ||
      get().status === "streaming"
    ) {
      return;
    }

    const controller = new AbortController();
    const clientMessageId = createClientMessageId();
    const localUserMessage: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      role: "user",
      text: trimmed,
      images: images.length > 0 ? images : undefined,
      gifs: gif ? [gif] : undefined,
      stickers: stickers.length > 0 ? stickers : undefined,
      levelOfRot,
      status: "complete",
      createdAt: new Date(),
      optimistic: true,
    };

    // For a BRAND-NEW chat, mint the conversation id up front instead of waiting
    // for the backend's `conversation` event. This lets us subscribe to the reply
    // stream immediately AND persist the id now, so a first message that gets
    // backgrounded mid-flight is never orphaned: the live listener (or a relaunch
    // via the saved session) still finds the finished reply once the finish-&-save
    // backend writes it. The backend creates the conversation with this exact id
    // (see ensureConversation); older behavior (null id → server-assigned) is gone
    // from the client but still supported server-side.
    const mintedConversationId =
      get().conversationId == null ? newConversationId() : null;
    const conversationId = get().conversationId ?? mintedConversationId;

    clearAwaitTimer();
    set((state) => ({
      messages: [...state.messages, localUserMessage],
      ...(mintedConversationId
        ? { conversationId: mintedConversationId }
        : null),
      streamingText: "",
      streamingMeme: null,
      streamingGif: null,
      streamingAgentServerId: null,
      awaitingPersistedReply: null,
      erroredReplyClientId: null,
      activeReplyClientId: clientMessageId,
      settledReply: null,
      currentModel: null,
      quota: null,
      status: "streaming",
      abortController: controller,
      error: null,
    }));

    if (mintedConversationId) {
      // Remember the session now so a cold relaunch reopens this conversation.
      void ChatSessionStorage.write({ conversationId: mintedConversationId });
      // Subscribe to the reply stream immediately. The doc doesn't exist yet, so
      // the first read is denied; subscribeToMessages retries through that until
      // the backend creates it (see its permission-denied backoff). Participants
      // stay on the `conversation`-event path — that listener isn't retry-wrapped,
      // and it's cosmetic (per-message avatars), so subscribing it before the doc
      // exists would just kill it silently.
      if (!unsubscribeMessages) {
        unsubscribeMessages = subscribeToMessages(
          mintedConversationId,
          (messages, meta) => {
            handleMessagesSnapshot(messages, meta, get, set);
          },
        );
      }
    }

    try {
      // Send the user's selected language resolved to a concrete code (never
      // "system"): "system" maps to the device locale via resolveLanguage. The
      // backend tells the model to default to it unless the user writes in
      // another language.
      const language = resolveLanguage(useSettingsStore.getState().language);
      // Forward the locally-selected persona so the backend serves it (and the
      // turn gets stamped with its id). The default is sent as undefined so the
      // backend falls back to the global Brainrot Bot — keeping the default
      // payload byte-identical to before personas existed.
      const selectedPersonaId = usePersonaStore.getState().selectedPersonaId;
      const personaId =
        selectedPersonaId === DEFAULT_PERSONA_ID ? undefined : selectedPersonaId;
      for await (const event of streamAgentAnswer({
        message: trimmed,
        images,
        gif,
        stickers,
        conversationId,
        clientMessageId,
        personaId,
        levelOfRot,
        language,
        // Sticky local-only prefs, read at send time. Omitted when on (the
        // backend default) so a "both on" payload stays identical to before.
        respondWithEmojis: get().respondWithEmojis ? undefined : false,
        respondWithMedia: get().respondWithMedia ? undefined : false,
        signal: controller.signal,
      })) {
        if (event.type === "conversation") {
          set({ conversationId: event.id });
          // Remember this session so reopening the app returns to it.
          void ChatSessionStorage.write({ conversationId: event.id });
          if (!unsubscribeMessages) {
            unsubscribeMessages = subscribeToMessages(event.id, (messages, meta) => {
              handleMessagesSnapshot(messages, meta, get, set);
            });
          }
          if (!unsubscribeParticipants) {
            startParticipantsSubscription(event.id, set);
          }
          continue;
        }

        if (event.type === "message") {
          if (event.role === "user" && event.clientMessageId) {
            set((state) => ({
              messages: state.messages.map((message) =>
                message.clientMessageId === event.clientMessageId
                  ? { ...message, serverId: event.id }
                  : message,
              ),
            }));
          } else if (event.role === "agent") {
            // Capture the reply's Firestore id so Pause can delete the exact doc
            // and a dropped stream can wait on the right reply.
            set({ streamingAgentServerId: event.id });
          }
          continue;
        }

        if (event.type === "model") {
          set({ currentModel: event.id });
          continue;
        }

        if (event.type === "delta") {
          deltaBuffer += event.text;
          if (deltaRafId === null) {
            deltaRafId = requestAnimationFrame(() => flushDeltaBuffer(set));
          }
          continue;
        }

        if (event.type === "meme") {
          set({ streamingMeme: event.image });
          continue;
        }

        if (event.type === "gif") {
          set({ streamingGif: event.gif });
          continue;
        }

        if (event.type === "quota_exceeded") {
          // Backend rejected before any tokens were streamed. Surface the
          // modal data and bail; no error state, no message rendered.
          set({
            messages: get().messages.filter(
              (message) => message.clientMessageId !== clientMessageId,
            ),
            quota: { reason: event.reason, resetAt: event.resetAt },
            streamingText: "",
            streamingMeme: null,
            streamingGif: null,
            activeReplyClientId: null,
            settledReply: null,
            status: "idle",
            abortController: null,
            currentModel: null,
            error: null,
          });
          return;
        }

        if (event.type === "hate_speech") {
          // Backend flagged the message. Remove it from local state so the slur
          // is never visible in the feed (the backend never wrote it to Firestore
          // either — the hate-speech gate runs before appendMessage). A standalone
          // error card is synthesised by buildVisibleMessages without anchoring to
          // any user turn, so the user still gets the "message was flagged" notice.
          set({
            messages: get().messages.filter(
              (message) => message.clientMessageId !== clientMessageId,
            ),
            streamingText: "",
            streamingMeme: null,
            streamingGif: null,
            awaitingPersistedReply: null,
            erroredReplyClientId: null,
            activeReplyClientId: null,
            settledReply: null,
            status: "error",
            abortController: null,
            currentModel: null,
            error: "hate_speech",
          });
          return;
        }

        if (event.type === "error") {
          throw new Error(event.code);
        }
      }

      flushDeltaBufferSync(set);

      const finalText = get().streamingText;
      const finalMeme = get().streamingMeme;
      const finalGif = get().streamingGif;
      if (unsubscribeMessages) {
        // Live conversation: hand the final text + meme/gif to the
        // settled-reply bridge, keyed by this turn, so the bubble stays put
        // until the finalized Firestore message arrives and clears it.
        const hasReply =
          finalText.length > 0 || finalMeme !== null || finalGif !== null;
        set({
          settledReply: hasReply
            ? {
                clientMessageId,
                text: finalText,
                images: finalMeme ? [finalMeme] : undefined,
                gifs: finalGif ? [finalGif] : undefined,
              }
            : null,
          streamingText: "",
          streamingMeme: null,
          streamingGif: null,
          streamingAgentServerId: null,
          activeReplyClientId: null,
          currentModel: null,
          status: "idle",
          abortController: null,
          error: null,
        });
      } else {
        // No live subscription (Firebase unavailable): commit a local agent
        // message directly since no snapshot will ever arrive.
        set((state) => ({
          messages:
            finalText.length > 0 || finalMeme !== null || finalGif !== null
              ? [
                  ...state.messages,
                  {
                    id: `local-agent-${++optimisticCounter}`,
                    role: "agent",
                    text: finalText,
                    images: finalMeme ? [finalMeme] : undefined,
                    gifs: finalGif ? [finalGif] : undefined,
                    // Stamp the bot so an offline-committed reply still carries a
                    // per-message avatar in a multi-bot conversation.
                    personaId: usePersonaStore.getState().selectedPersonaId,
                    status: "complete",
                    createdAt: new Date(),
                    optimistic: true,
                  },
                ]
              : state.messages,
          settledReply: null,
          streamingText: "",
          streamingMeme: null,
          streamingGif: null,
          streamingAgentServerId: null,
          activeReplyClientId: null,
          currentModel: null,
          status: "idle",
          abortController: null,
          error: null,
        }));
      }
    } catch (error) {
      cancelDeltaFlush();

      if (controller.signal.aborted) {
        // Our own Pause/navigate abort — local state is already (or about to be)
        // cleared by pauseStreaming/cancelStreaming. Just settle to idle quietly.
        set({
          streamingText: "",
          streamingMeme: null,
          streamingGif: null,
          streamingAgentServerId: null,
          awaitingPersistedReply: null,
          activeReplyClientId: null,
          settledReply: null,
          status: "idle",
          abortController: null,
          error: null,
        });
        return;
      }

      if (error instanceof SessionExpiredError) {
        // Terminal auth failure: the session is gone server-side. Clear the
        // in-flight turn WITHOUT a retryable error bubble — replaying the same
        // dead session is useless and misleading — and route to re-auth.
        clearAwaitTimer();
        set({
          streamingText: "",
          streamingMeme: null,
          streamingGif: null,
          streamingAgentServerId: null,
          awaitingPersistedReply: null,
          activeReplyClientId: null,
          settledReply: null,
          status: "idle",
          abortController: null,
          error: null,
        });
        void handleSessionExpired();
        return;
      }

      const code = error instanceof Error ? error.message : "generic";
      const agentServerId = get().streamingAgentServerId;

      // On resume from background, the Firestore listener routinely re-delivers
      // the finished reply BEFORE this dead-XHR error even surfaces. If the reply
      // for this turn is already in our local messages, the turn SUCCEEDED — just
      // settle to idle with no error. This is the ordering a snapshot-only heal
      // misses: once we'd set status "error" here, no further snapshot arrives to
      // undo it, so the card sticks even though the reply is sitting right there.
      if (replyLanded(get().messages, clientMessageId, agentServerId)) {
        clearAwaitTimer();
        set({
          streamingText: "",
          streamingMeme: null,
          streamingGif: null,
          streamingAgentServerId: null,
          awaitingPersistedReply: null,
          erroredReplyClientId: null,
          activeReplyClientId: null,
          settledReply: null,
          status: "idle",
          abortController: null,
          error: null,
        });
        return;
      }

      // A transport drop (network/background/timeout), not a real failure, while
      // the backend is still finalizing the reply. Don't show an error: keep the
      // typing bubble and defer to the Firestore listener, which delivers the
      // finished reply (finish-&-save guarantees it lands). We defer whenever the
      // turn actually REACHED the backend — either we already saw the reply's
      // `message` event (agentServerId), OR the user turn was committed
      // server-side (its optimistic copy now carries a serverId). The old
      // agentServerId-only gate missed a background kill that happened after the
      // user turn committed but before the agent `message` event, dropping it
      // into a stuck error even though the reply was on its way.
      const userTurnCommitted = get().messages.some(
        (message) =>
          message.clientMessageId === clientMessageId &&
          message.serverId != null,
      );
      if (isTransportDrop(code) && (agentServerId || userTurnCommitted)) {
        set({
          awaitingPersistedReply: {
            clientMessageId,
            agentServerId: agentServerId ?? null,
          },
          // The XHR is dead; drop the controller but keep status "streaming" and
          // activeReplyClientId so the typing bubble stays up.
          abortController: null,
          error: null,
        });
        startAwaitTimer(set, get);
        return;
      }

      // A genuine failure (agent_error) or a drop before the turn ever reached
      // the backend (e.g. offline at send) → there's nothing to wait for; show a
      // retryable error. erroredReplyClientId is the snapshot-heal backstop for
      // the rare case where a reply still lands after this (see
      // applySnapshotMessages).
      clearAwaitTimer();
      set({
        streamingMeme: null,
        streamingGif: null,
        streamingAgentServerId: null,
        awaitingPersistedReply: null,
        erroredReplyClientId: clientMessageId,
        activeReplyClientId: null,
        settledReply: null,
        status: "error",
        abortController: null,
        error: code,
      });
    }
  },

  replayTurn: async (agentServerId) => {
    const conversationId = get().conversationId;
    if (!conversationId || get().status === "streaming") return;

    // Locate the reply being regenerated and the user turn it answers; the
    // streaming bubble anchors to that user turn's clientMessageId, exactly like
    // a fresh send.
    const target = get().messages.find(
      (message) => message.role === "agent" && message.serverId === agentServerId,
    );
    if (!target) return;
    const replyClientId = target.inReplyToClientMessageId ?? null;

    const controller = new AbortController();

    // Optimistically drop the old reply and show the typing bubble in its place.
    // `replacingServerId` keeps the snapshot from re-adding the old doc until the
    // server-side deletion propagates.
    clearAwaitTimer();
    set((state) => ({
      messages: state.messages.filter(
        (message) => message.serverId !== agentServerId,
      ),
      replacingServerId: agentServerId,
      streamingText: "",
      streamingMeme: null,
      streamingGif: null,
      streamingAgentServerId: null,
      awaitingPersistedReply: null,
      activeReplyClientId: replyClientId,
      settledReply: null,
      currentModel: null,
      quota: null,
      status: "streaming",
      abortController: controller,
      error: null,
    }));

    try {
      const language = resolveLanguage(useSettingsStore.getState().language);
      for await (const event of streamReplayTurn({
        conversationId,
        agentMessageId: agentServerId,
        language,
        signal: controller.signal,
      })) {
        // No `conversation`/user `message` events on replay — the conversation
        // and user turn already exist. The agent `message` event carries the new
        // reply's id, captured so Pause/drop-recovery can target it.
        if (event.type === "message") {
          if (event.role === "agent") {
            set({ streamingAgentServerId: event.id });
          }
          continue;
        }

        if (event.type === "model") {
          set({ currentModel: event.id });
          continue;
        }

        if (event.type === "delta") {
          deltaBuffer += event.text;
          if (deltaRafId === null) {
            deltaRafId = requestAnimationFrame(() => flushDeltaBuffer(set));
          }
          continue;
        }

        if (event.type === "meme") {
          set({ streamingMeme: event.image });
          continue;
        }

        if (event.type === "gif") {
          set({ streamingGif: event.gif });
          continue;
        }

        if (event.type === "quota_exceeded") {
          // Rejected before streaming. The old reply was only removed locally
          // and is still in Firestore (nothing was deleted server-side), so
          // clearing replacingServerId lets the snapshot restore it.
          set({
            quota: { reason: event.reason, resetAt: event.resetAt },
            replacingServerId: null,
            streamingText: "",
            streamingMeme: null,
            streamingGif: null,
            activeReplyClientId: null,
            settledReply: null,
            status: "idle",
            abortController: null,
            currentModel: null,
            error: null,
          });
          return;
        }

        if (event.type === "error") {
          throw new Error(event.code);
        }
      }

      flushDeltaBufferSync(set);

      const finalText = get().streamingText;
      const finalMeme = get().streamingMeme;
      const finalGif = get().streamingGif;
      const hasReply =
        finalText.length > 0 || finalMeme !== null || finalGif !== null;
      // Hand off to the settled-reply bridge keyed by the same user turn, so the
      // regenerated bubble stays put until the new finalized message lands. The
      // new doc has a fresh serverId, so we can stop hiding the old one.
      set({
        settledReply:
          hasReply && replyClientId
            ? {
                clientMessageId: replyClientId,
                text: finalText,
                images: finalMeme ? [finalMeme] : undefined,
                gifs: finalGif ? [finalGif] : undefined,
              }
            : null,
        replacingServerId: null,
        streamingText: "",
        streamingMeme: null,
        streamingGif: null,
        streamingAgentServerId: null,
        activeReplyClientId: null,
        currentModel: null,
        status: "idle",
        abortController: null,
        error: null,
      });
    } catch (error) {
      cancelDeltaFlush();

      if (controller.signal.aborted) {
        set({
          replacingServerId: null,
          streamingText: "",
          streamingMeme: null,
          streamingGif: null,
          streamingAgentServerId: null,
          awaitingPersistedReply: null,
          activeReplyClientId: null,
          settledReply: null,
          status: "idle",
          abortController: null,
          error: null,
        });
        return;
      }

      if (error instanceof SessionExpiredError) {
        clearAwaitTimer();
        set({
          replacingServerId: null,
          streamingText: "",
          streamingMeme: null,
          streamingGif: null,
          streamingAgentServerId: null,
          awaitingPersistedReply: null,
          activeReplyClientId: null,
          settledReply: null,
          status: "idle",
          abortController: null,
          error: null,
        });
        void handleSessionExpired();
        return;
      }

      const code = error instanceof Error ? error.message : "generic";
      const agentServerId = get().streamingAgentServerId;

      // Transport drop after the regenerated reply was committed server-side:
      // defer to the Firestore listener instead of erroring (same as a fresh
      // send). The old reply is already deleted, so we wait on the new one.
      if (isTransportDrop(code) && agentServerId) {
        set({
          replacingServerId: null,
          awaitingPersistedReply: {
            clientMessageId: replyClientId,
            agentServerId,
          },
          abortController: null,
          error: null,
        });
        startAwaitTimer(set, get);
        return;
      }

      // Genuine failure (agent_error) or a drop before the new reply was
      // committed: the old reply may already be gone server-side, so leave
      // replacingServerId cleared and surface a retryable error bubble.
      clearAwaitTimer();
      set({
        replacingServerId: null,
        streamingMeme: null,
        streamingGif: null,
        streamingAgentServerId: null,
        awaitingPersistedReply: null,
        erroredReplyClientId: null,
        activeReplyClientId: null,
        settledReply: null,
        status: "error",
        abortController: null,
        error: code,
      });
    }
  },

  rateMessage: (serverId, reaction) => {
    const conversationId = get().conversationId;
    if (!conversationId) return;

    const target = get().messages.find((message) => message.serverId === serverId);
    if (!target) return;

    const previous = target.reaction ?? null;
    // Toggle: tapping the active thumb clears it; otherwise switch to it.
    const resolved: MessageReaction | null = previous === reaction ? null : reaction;

    const applyReaction = (value: MessageReaction | null) =>
      set((state) => ({
        messages: state.messages.map((message) =>
          message.serverId === serverId
            ? { ...message, reaction: value ?? undefined }
            : message,
        ),
      }));

    // Optimistic: reflect the rating immediately; the Firestore snapshot will
    // confirm it, or we roll back on failure.
    applyReaction(resolved);

    void rateMessageCallable({
      conversationId,
      messageId: serverId,
      reaction: resolved,
    }).catch(() => {
      applyReaction(previous);
    });
  },

  setMessageEmoji: (serverId, emoji) => {
    const conversationId = get().conversationId;
    if (!conversationId) return;

    const target = get().messages.find((message) => message.serverId === serverId);
    if (!target) return;

    const previous = target.emojiReaction ?? null;
    // Toggle: tapping the active emoji clears it; otherwise switch to it.
    const resolved: string | null = previous === emoji ? null : emoji;

    const applyEmoji = (value: string | null) =>
      set((state) => ({
        messages: state.messages.map((message) =>
          message.serverId === serverId
            ? { ...message, emojiReaction: value ?? undefined }
            : message,
        ),
      }));

    // Optimistic: reflect it immediately; the Firestore snapshot confirms it, or
    // we roll back on failure.
    applyEmoji(resolved);

    void setMessageEmojiCallable({
      conversationId,
      messageId: serverId,
      emoji: resolved,
    }).catch(() => {
      applyEmoji(previous);
    });
  },

  loadOlderMessages: async () => {
    const { conversationId, olderCursor, hasMoreOlder, loadingOlder } = get();
    if (!conversationId || !olderCursor || !hasMoreOlder || loadingOlder) {
      return;
    }
    set({ loadingOlder: true });
    try {
      const page = await fetchOlderMessages(conversationId, olderCursor);
      // A message can straddle the page/live boundary (or be re-fetched after
      // a cursor race) — drop anything already loaded, by serverId.
      const loaded = new Set<string>();
      for (const m of get().olderMessages) if (m.serverId) loaded.add(m.serverId);
      for (const m of get().messages) if (m.serverId) loaded.add(m.serverId);
      const fresh = page.messages
        .filter((message) => !loaded.has(message.id))
        .map(fromStoredMessage);
      set({
        olderMessages: [...fresh, ...get().olderMessages],
        olderCursor: page.cursor ?? get().olderCursor,
        hasMoreOlder: page.hasMore,
        loadingOlder: false,
      });
    } catch (err) {
      console.warn("[chat] loading older messages failed:", err);
      // Leave cursor + hasMoreOlder untouched so the user can retry by
      // scrolling again.
      set({ loadingOlder: false });
    }
  },

  loadConversation: (id) => {
    get().cancelStreaming();
    cleanupSubscription();
    void ChatSessionStorage.write({ conversationId: id });
    set({
      conversationId: id,
      messages: [],
      olderMessages: [],
      olderCursor: null,
      hasMoreOlder: false,
      loadingOlder: false,
      participantPersonaIds: [],
      streamingText: "",
      streamingMeme: null,
      streamingGif: null,
      streamingAgentServerId: null,
      awaitingPersistedReply: null,
      erroredReplyClientId: null,
      cancelledServerId: null,
      activeReplyClientId: null,
      settledReply: null,
      replacingServerId: null,
      status: "idle",
      error: null,
    });

    unsubscribeMessages = subscribeToMessages(id, (messages, meta) => {
      handleMessagesSnapshot(messages, meta, get, set);
    });
    startParticipantsSubscription(id, set);
  },

  startNewConversation: () => {
    get().cancelStreaming();
    cleanupSubscription();
    // Drop the remembered session so a restart opens a fresh chat.
    void ChatSessionStorage.write({ conversationId: null });
    set({
      conversationId: null,
      messages: [],
      olderMessages: [],
      olderCursor: null,
      hasMoreOlder: false,
      loadingOlder: false,
      participantPersonaIds: [],
      streamingText: "",
      streamingMeme: null,
      streamingGif: null,
      streamingAgentServerId: null,
      awaitingPersistedReply: null,
      erroredReplyClientId: null,
      cancelledServerId: null,
      activeReplyClientId: null,
      settledReply: null,
      replacingServerId: null,
      status: "idle",
      abortController: null,
      error: null,
    });
  },

  pauseStreaming: () => {
    const {
      conversationId,
      abortController,
      streamingAgentServerId,
      activeReplyClientId,
    } = get();
    // Stop the local stream and the awaiting fallback.
    abortController?.abort();
    clearAwaitTimer();

    // Durable cancel: delete the in-flight agent reply server-side so it can't
    // re-appear via the live listener (and so the still-running stream function
    // sees its doc vanish and stops). Best-effort + idempotent — the local clear
    // below already happened, and the backend finalize guard is the backstop.
    // Target the exact reply by serverId when we have it, else the user turn it
    // answers.
    if (conversationId && (streamingAgentServerId || activeReplyClientId)) {
      void cancelAgentReplyCallable({
        conversationId,
        messageId: streamingAgentServerId ?? undefined,
        clientMessageId: activeReplyClientId ?? undefined,
      }).catch(() => {
        // Ignore: deletion is idempotent and the server-side finalize guard
        // ensures the reply is never saved even if this never lands.
      });
    }

    set({
      abortController: null,
      status: "idle",
      streamingText: "",
      streamingMeme: null,
      streamingGif: null,
      streamingAgentServerId: null,
      awaitingPersistedReply: null,
      activeReplyClientId: null,
      settledReply: null,
      replacingServerId: null,
      // Suppress the in-flight doc locally until its server-side delete reaches
      // the snapshot, so a streaming/finalized doc doesn't flash back in.
      cancelledServerId: streamingAgentServerId ?? null,
      currentModel: null,
    });
  },

  cancelStreaming: () => {
    // Local detach only (used when leaving the conversation): abort the stream
    // and clear local state, but DON'T delete server-side — the backend finishes
    // and persists the reply (finish & save) so it's there on return.
    get().abortController?.abort();
    clearAwaitTimer();
    set({
      abortController: null,
      status: "idle",
      streamingText: "",
      streamingMeme: null,
      streamingGif: null,
      streamingAgentServerId: null,
      awaitingPersistedReply: null,
      activeReplyClientId: null,
      settledReply: null,
      replacingServerId: null,
      cancelledServerId: null,
      currentModel: null,
    });
  },

  dismissQuota: () => {
    set({ quota: null });
  },

  setRotLevel: (level) => {
    const clamped = Math.min(Math.max(Math.round(level), 1), 3);
    if (get().rotLevel === clamped) return;
    set({ rotLevel: clamped });
    void ChatSessionStorage.write({ rotLevel: clamped });
  },

  setRespondWithEmojis: (value) => {
    if (get().respondWithEmojis === value) return;
    set({ respondWithEmojis: value });
    void ChatSessionStorage.write({ respondWithEmojis: value });
  },

  setRespondWithMedia: (value) => {
    if (get().respondWithMedia === value) return;
    set({ respondWithMedia: value });
    void ChatSessionStorage.write({ respondWithMedia: value });
  },

  hydrateSession: async ({ autoLoadConversation = true } = {}) => {
    const stored = await ChatSessionStorage.read();
    set({
      rotLevel: stored.rotLevel,
      respondWithEmojis: stored.respondWithEmojis,
      respondWithMedia: stored.respondWithMedia,
    });

    // Re-open the last session only when nothing else has claimed the screen
    // (no deep-linked conversation, not mid-stream) so we never clobber an
    // in-progress chat.
    if (
      autoLoadConversation &&
      stored.conversationId &&
      get().conversationId === null &&
      get().status !== "streaming"
    ) {
      get().loadConversation(stored.conversationId);
    }
  },
}));
