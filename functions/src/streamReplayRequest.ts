import { z } from "zod";

// Request body for the streamReplayTurn SSE endpoint. A replay regenerates the
// agent reply identified by `agentMessageId` within `conversationId`: the old
// reply is deleted and a fresh answer is streamed for the same user turn. The
// user turn (and its text/attachments/rot level) is read server-side from the
// stored message, so the client never resends it — only the IDs and the
// caller's current app language travel over the wire.
export const streamReplayRequestSchema = z.object({
  conversationId: z.string().trim().min(1),
  // The agent message to regenerate. Must be the most recent message in the
  // conversation (enforced server-side, not here).
  agentMessageId: z.string().trim().min(1),
  // The user's resolved app language (e.g. "en", "es") — never "system". Folded
  // into the per-user system message exactly like a normal turn so the replay
  // honors the language the app is set to right now. Optional.
  language: z.string().trim().min(2).max(10).optional(),
});

export type StreamReplayRequest = z.infer<typeof streamReplayRequestSchema>;
