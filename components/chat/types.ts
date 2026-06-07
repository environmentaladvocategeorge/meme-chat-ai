import type { ChatMessage } from "@/store/chat";

export type RenderMessage = ChatMessage & {
  retry?: boolean;
  thinking?: boolean;
  // Which copy to show in the agent-side error card. Only set on synthesized
  // error bubbles (see `visibleMessages`).
  errorKind?: "generic" | "signed-out" | "hate_speech";
};

// Stable list identity for a message bubble. An agent reply keeps the SAME
// key across its whole lifecycle — synthetic streaming placeholder → settled
// bridge → finalized Firestore message — because all three carry the same
// `inReplyToClientMessageId`. That continuity prevents the FlatList from
// unmounting and remounting the bubble (which replayed the entrance
// animation and caused the post-stream flicker).
export function messageKey(item: RenderMessage): string {
  if (item.role === "agent" && item.inReplyToClientMessageId) {
    return `agent:${item.inReplyToClientMessageId}`;
  }
  return item.id;
}
