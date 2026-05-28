import {
  subscribeToMessages,
  type StoredChatMessage,
} from "@/services/firebase/conversations";
import { streamAgentAnswer } from "@/services/firebase/streamAgent";
import { create } from "zustand";

export type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  status: "complete" | "streaming" | "error";
  optimistic?: boolean;
};

type ChatStatus = "idle" | "streaming" | "error";

type ChatState = {
  conversationId: string | null;
  messages: ChatMessage[];
  streamingText: string;
  status: ChatStatus;
  abortController: AbortController | null;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  loadConversation: (id: string) => void;
  startNewConversation: () => void;
  cancelStreaming: () => void;
};

let unsubscribeMessages: (() => void) | null = null;
let optimisticCounter = 0;

function cleanupSubscription() {
  unsubscribeMessages?.();
  unsubscribeMessages = null;
}

function fromStoredMessage(message: StoredChatMessage): ChatMessage {
  return { ...message };
}

function applySnapshotMessages(
  messages: StoredChatMessage[],
  get: () => ChatState,
  set: (partial: Pick<ChatState, "messages">) => void,
) {
  if (messages.length === 0 && get().status === "streaming") return;
  set({ messages: messages.map(fromStoredMessage) });
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversationId: null,
  messages: [],
  streamingText: "",
  status: "idle",
  abortController: null,
  error: null,

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || get().status === "streaming") return;

    const controller = new AbortController();
    const hasSubscription = unsubscribeMessages !== null;
    const localUserMessage: ChatMessage = {
      id: `local-user-${++optimisticCounter}`,
      role: "user",
      text: trimmed,
      status: "complete",
      optimistic: true,
    };

    set((state) => ({
      messages: hasSubscription
        ? state.messages
        : [...state.messages, localUserMessage],
      streamingText: "",
      status: "streaming",
      abortController: controller,
      error: null,
    }));

    try {
      for await (const event of streamAgentAnswer({
        message: trimmed,
        conversationId: get().conversationId,
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

        if (event.type === "delta") {
          set((state) => ({
            streamingText: `${state.streamingText}${event.text}`,
          }));
          continue;
        }

        if (event.type === "error") {
          throw new Error(event.code);
        }
      }

      const finalText = get().streamingText;
      if (!unsubscribeMessages && finalText.length > 0) {
        set((state) => ({
          messages: [
            ...state.messages,
            {
              id: `local-agent-${++optimisticCounter}`,
              role: "agent",
              text: finalText,
              status: "complete",
              optimistic: true,
            },
          ],
        }));
      }

      set({
        streamingText: "",
        status: "idle",
        abortController: null,
        error: null,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        set({
          streamingText: "",
          status: "idle",
          abortController: null,
          error: null,
        });
        return;
      }

      set({
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
      status: "idle",
      abortController: null,
      error: null,
    });
  },

  cancelStreaming: () => {
    get().abortController?.abort();
    set({ abortController: null, status: "idle", streamingText: "" });
  },
}));
