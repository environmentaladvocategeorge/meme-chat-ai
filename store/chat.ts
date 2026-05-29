import type { MessageImage } from "@/domain/memes";
import { rateMessageCallable } from "@/services/firebase/callables";
import {
  subscribeToMessages,
  type StoredChatMessage,
} from "@/services/firebase/conversations";
import { streamAgentAnswer } from "@/services/firebase/streamAgent";
import { ChatSessionStorage, DEFAULT_ROT_LEVEL } from "@/store/storage";
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
  // Thumbs rating on an agent reply (persisted server-side).
  reaction?: MessageReaction;
  // Brainrot intensity selected for a user turn (1–3). Absent on agent turns.
  levelOfRot?: number;
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
};

type ChatState = {
  conversationId: string | null;
  // Sticky brainrot dial (1–3), applied to every turn. Persisted locally so it
  // survives an app restart; hydrated via `hydrateSession`.
  rotLevel: number;
  messages: ChatMessage[];
  streamingText: string;
  // A meme the agent attached to the in-flight reply (via the backend get_meme
  // tool), shown on the streaming bubble until the reply settles.
  streamingMeme: MessageImage | null;
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
    levelOfRot?: number,
  ) => Promise<void>;
  // Optimistically set/toggle a thumbs rating on an agent message, then persist
  // it. Tapping the already-active thumb clears the rating.
  rateMessage: (serverId: string, reaction: MessageReaction) => void;
  loadConversation: (id: string) => void;
  startNewConversation: () => void;
  cancelStreaming: () => void;
  dismissQuota: () => void;
  // Update the sticky rot level and persist it.
  setRotLevel: (level: number) => void;
  // Restore the persisted rot level and (optionally) re-open the last
  // conversation. Called once when the chat screen mounts on app open.
  hydrateSession: (options?: { autoLoadConversation?: boolean }) => Promise<void>;
};

let unsubscribeMessages: (() => void) | null = null;
let optimisticCounter = 0;

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
}

function fromStoredMessage(message: StoredChatMessage): ChatMessage {
  return {
    ...message,
    id: message.clientMessageId ?? message.id,
    serverId: message.id,
  };
}

function applySnapshotMessages(
  messages: StoredChatMessage[],
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
) {
  if (messages.length === 0 && get().status === "streaming") return;
  const storedMessages = messages.map(fromStoredMessage);
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

  set({
    messages: [...storedMessages, ...pendingOptimisticUsers],
    ...(settledLanded ? { settledReply: null } : null),
  });
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversationId: null,
  rotLevel: DEFAULT_ROT_LEVEL,
  messages: [],
  streamingText: "",
  streamingMeme: null,
  activeReplyClientId: null,
  settledReply: null,
  currentModel: null,
  quota: null,
  status: "idle",
  abortController: null,
  error: null,

  sendMessage: async (text, images = [], levelOfRot) => {
    const trimmed = text.trim();
    // Image-only turns are allowed: require text OR at least one attachment.
    if ((trimmed.length === 0 && images.length === 0) || get().status === "streaming") {
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
      levelOfRot,
      status: "complete",
      createdAt: new Date(),
      optimistic: true,
    };

    set((state) => ({
      messages: [...state.messages, localUserMessage],
      streamingText: "",
      streamingMeme: null,
      activeReplyClientId: clientMessageId,
      settledReply: null,
      currentModel: null,
      quota: null,
      status: "streaming",
      abortController: controller,
      error: null,
    }));

    try {
      for await (const event of streamAgentAnswer({
        message: trimmed,
        images,
        conversationId: get().conversationId,
        clientMessageId,
        levelOfRot,
        signal: controller.signal,
      })) {
        if (event.type === "conversation") {
          set({ conversationId: event.id });
          // Remember this session so reopening the app returns to it.
          void ChatSessionStorage.write({ conversationId: event.id });
          if (!unsubscribeMessages) {
            unsubscribeMessages = subscribeToMessages(event.id, (messages) => {
              applySnapshotMessages(messages, get, set);
            });
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
          }
          continue;
        }

        if (event.type === "model") {
          set({ currentModel: event.id });
          continue;
        }

        if (event.type === "delta") {
          set((state) => ({
            streamingText: `${state.streamingText}${event.text}`,
          }));
          continue;
        }

        if (event.type === "meme") {
          set({ streamingMeme: event.image });
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

      const finalText = get().streamingText;
      const finalMeme = get().streamingMeme;
      if (unsubscribeMessages) {
        // Live conversation: hand the final text + meme to the settled-reply
        // bridge, keyed by this turn, so the bubble stays put until the
        // finalized Firestore message arrives and clears it.
        const hasReply = finalText.length > 0 || finalMeme !== null;
        set({
          settledReply: hasReply
            ? {
                clientMessageId,
                text: finalText,
                images: finalMeme ? [finalMeme] : undefined,
              }
            : null,
          streamingText: "",
          streamingMeme: null,
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
            finalText.length > 0 || finalMeme !== null
              ? [
                  ...state.messages,
                  {
                    id: `local-agent-${++optimisticCounter}`,
                    role: "agent",
                    text: finalText,
                    images: finalMeme ? [finalMeme] : undefined,
                    status: "complete",
                    createdAt: new Date(),
                    optimistic: true,
                  },
                ]
              : state.messages,
          settledReply: null,
          streamingText: "",
          streamingMeme: null,
          activeReplyClientId: null,
          currentModel: null,
          status: "idle",
          abortController: null,
          error: null,
        }));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        set({
          streamingText: "",
          streamingMeme: null,
          activeReplyClientId: null,
          settledReply: null,
          status: "idle",
          abortController: null,
          error: null,
        });
        return;
      }

      set({
        streamingMeme: null,
        activeReplyClientId: null,
        settledReply: null,
        status: "error",
        abortController: null,
        error: error instanceof Error ? error.message : "generic",
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

  loadConversation: (id) => {
    get().cancelStreaming();
    cleanupSubscription();
    void ChatSessionStorage.write({ conversationId: id });
    set({
      conversationId: id,
      messages: [],
      streamingText: "",
      streamingMeme: null,
      activeReplyClientId: null,
      settledReply: null,
      status: "idle",
      error: null,
    });

    unsubscribeMessages = subscribeToMessages(id, (messages) => {
      applySnapshotMessages(messages, get, set);
    });
  },

  startNewConversation: () => {
    get().cancelStreaming();
    cleanupSubscription();
    // Drop the remembered session so a restart opens a fresh chat.
    void ChatSessionStorage.write({ conversationId: null });
    set({
      conversationId: null,
      messages: [],
      streamingText: "",
      streamingMeme: null,
      activeReplyClientId: null,
      settledReply: null,
      status: "idle",
      abortController: null,
      error: null,
    });
  },

  cancelStreaming: () => {
    get().abortController?.abort();
    set({
      abortController: null,
      status: "idle",
      streamingText: "",
      streamingMeme: null,
      activeReplyClientId: null,
      settledReply: null,
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

  hydrateSession: async ({ autoLoadConversation = true } = {}) => {
    const stored = await ChatSessionStorage.read();
    set({ rotLevel: stored.rotLevel });

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
