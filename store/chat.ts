import {
  subscribeToMessages,
  type StoredChatMessage,
} from "@/services/firebase/conversations";
import { streamAgentAnswer } from "@/services/firebase/streamAgent";
import { create } from "zustand";

export type ChatMessage = {
  id: string;
  serverId?: string;
  clientMessageId?: string;
  inReplyToClientMessageId?: string;
  role: "user" | "agent";
  text: string;
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
};

type ChatState = {
  conversationId: string | null;
  messages: ChatMessage[];
  streamingText: string;
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
  sendMessage: (text: string) => Promise<void>;
  loadConversation: (id: string) => void;
  startNewConversation: () => void;
  cancelStreaming: () => void;
  dismissQuota: () => void;
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
  messages: [],
  streamingText: "",
  activeReplyClientId: null,
  settledReply: null,
  currentModel: null,
  quota: null,
  status: "idle",
  abortController: null,
  error: null,

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || get().status === "streaming") return;

    const controller = new AbortController();
    const clientMessageId = createClientMessageId();
    const localUserMessage: ChatMessage = {
      id: clientMessageId,
      clientMessageId,
      role: "user",
      text: trimmed,
      status: "complete",
      createdAt: new Date(),
      optimistic: true,
    };

    set((state) => ({
      messages: [...state.messages, localUserMessage],
      streamingText: "",
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
        conversationId: get().conversationId,
        clientMessageId,
        signal: controller.signal,
      })) {
        if (event.type === "conversation") {
          set({ conversationId: event.id });
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

        if (event.type === "quota_exceeded") {
          // Backend rejected before any tokens were streamed. Surface the
          // modal data and bail; no error state, no message rendered.
          set({
            messages: get().messages.filter(
              (message) => message.clientMessageId !== clientMessageId,
            ),
            quota: { reason: event.reason, resetAt: event.resetAt },
            streamingText: "",
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
      if (unsubscribeMessages) {
        // Live conversation: hand the final text to the settled-reply bridge,
        // keyed by this turn, so the bubble stays put until the finalized
        // Firestore message arrives and clears it.
        set({
          settledReply:
            finalText.length > 0 ? { clientMessageId, text: finalText } : null,
          streamingText: "",
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
            finalText.length > 0
              ? [
                  ...state.messages,
                  {
                    id: `local-agent-${++optimisticCounter}`,
                    role: "agent",
                    text: finalText,
                    status: "complete",
                    createdAt: new Date(),
                    optimistic: true,
                  },
                ]
              : state.messages,
          settledReply: null,
          streamingText: "",
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
          activeReplyClientId: null,
          settledReply: null,
          status: "idle",
          abortController: null,
          error: null,
        });
        return;
      }

      set({
        activeReplyClientId: null,
        settledReply: null,
        status: "error",
        abortController: null,
        error: error instanceof Error ? error.message : "generic",
      });
    }
  },

  loadConversation: (id) => {
    get().cancelStreaming();
    cleanupSubscription();
    set({
      conversationId: id,
      messages: [],
      streamingText: "",
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
    set({
      conversationId: null,
      messages: [],
      streamingText: "",
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
      activeReplyClientId: null,
      settledReply: null,
      currentModel: null,
    });
  },

  dismissQuota: () => {
    set({ quota: null });
  },
}));
