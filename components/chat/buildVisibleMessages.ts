import type { MessageGif } from "@/domain/gifs";
import type { MessageImage } from "@/domain/memes";
import type { ChatMessage } from "@/store/chat";
import type { RenderMessage } from "./types";

// The settle-window snapshot of a finished agent reply, carried until the
// finalized Firestore message lands. Mirrors the store's private SettledReply.
export type SettledReplySnapshot = {
  clientMessageId: string;
  text: string;
  images?: MessageImage[];
  gifs?: MessageGif[];
};

export type BuildVisibleMessagesInput = {
  messages: ChatMessage[];
  status: "idle" | "streaming" | "error";
  activeReplyClientId: string | null;
  streamingText: string;
  streamingMeme: MessageImage | null;
  streamingGif: MessageGif | null;
  settledReply: SettledReplySnapshot | null;
  error: string | null;
  // The most recent user turn, used to anchor the synthesized error card.
  lastUserMessage: ChatMessage | undefined;
};

// Assemble the list the chat thread actually renders (newest-first, since the
// FlatList is inverted) from the raw store state. This folds three transient
// concerns into the persisted messages:
//   1. the in-flight streaming reply (stable id so it doesn't remount),
//   2. a bridge for a just-settled reply not yet in the Firestore snapshot,
//   3. a synthesized agent-side error card for a failed turn.
// Pure and framework-free so the tricky de-duplication rules are unit-testable.
export function buildVisibleMessages({
  messages,
  status,
  activeReplyClientId,
  streamingText,
  streamingMeme,
  streamingGif,
  settledReply,
  error,
  lastUserMessage,
}: BuildVisibleMessagesInput): RenderMessage[] {
  // Drop empty placeholders, but keep errored agent bubbles so the user
  // sees the failure state.
  const base: RenderMessage[] = messages
    .filter(
      (message) =>
        message.text.length > 0 ||
        (message.images?.length ?? 0) > 0 ||
        (message.gifs?.length ?? 0) > 0 ||
        (message.role === "agent" && message.status === "error"),
    )
    .map((message) => ({ ...message }));

  if (status === "streaming" && activeReplyClientId) {
    // The in-flight agent reply. We give it a STABLE id tied to the user
    // turn it answers, identical to the key the finalized Firestore
    // message resolves to (see `messageKey`). That continuity is what
    // stops the bubble from unmounting + replaying its entrance animation
    // when the stream finishes. Empty text → the pulsating "Memeing…"
    // indicator.
    base.push({
      id: `agent:${activeReplyClientId}`,
      role: "agent",
      inReplyToClientMessageId: activeReplyClientId,
      text: streamingText,
      images: streamingMeme ? [streamingMeme] : undefined,
      gifs: streamingGif ? [streamingGif] : undefined,
      status: "streaming",
      createdAt: null,
      // Still "thinking" only when there's no text, meme, or gif yet.
      thinking: streamingText.length === 0 && !streamingMeme && !streamingGif,
    });
  } else if (settledReply) {
    // Bridge: the stream is done but the finalized Firestore message
    // hasn't arrived in the snapshot yet. Only synthesize it if the real
    // one isn't already present, so we never double-render.
    const alreadyStored = base.some(
      (message) =>
        message.role === "agent" &&
        message.inReplyToClientMessageId === settledReply.clientMessageId &&
        (message.text.length > 0 ||
          (message.images?.length ?? 0) > 0 ||
          (message.gifs?.length ?? 0) > 0),
    );
    if (!alreadyStored) {
      base.push({
        id: `agent:${settledReply.clientMessageId}`,
        role: "agent",
        inReplyToClientMessageId: settledReply.clientMessageId,
        text: settledReply.text,
        images: settledReply.images,
        gifs: settledReply.gifs,
        status: "complete",
        createdAt: null,
      });
    }
  }

  // A failed turn surfaces as a single agent-side error card. For hate_speech
  // the user message has already been removed from state, so we inject a
  // standalone card not anchored to any user turn. For all other errors we
  // anchor to the last user message (carrying the retry action).
  if (status === "error") {
    const alreadyErrored = base.some(
      (message) => message.role === "agent" && message.status === "error",
    );
    if (!alreadyErrored) {
      if (error === "hate_speech") {
        base.push({
          id: "agent-error:hate_speech",
          role: "agent",
          text: "",
          status: "error",
          createdAt: null,
          errorKind: "hate_speech",
          retry: false,
        });
      } else if (lastUserMessage) {
        base.push({
          id: `agent-error:${lastUserMessage.id}`,
          role: "agent",
          inReplyToClientMessageId: lastUserMessage.clientMessageId,
          text: "",
          status: "error",
          createdAt: null,
          errorKind: error === "signed-out" ? "signed-out" : "generic",
          retry: error !== "signed-out",
        });
      }
    }
  }

  return base.reverse();
}
