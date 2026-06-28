import type { MessageGif } from "../messages/messageGif";
import type { MessageImage } from "../messages/messageImage";
import type { MessageSticker } from "../messages/messageSticker";

export type ChatRole = "user" | "agent";

export type ChatMessage = {
  role: ChatRole;
  text: string;
  // Image attachments on a user turn. Present only for historical user
  // messages that carried memes; used to collapse them to cheap text
  // placeholders during context assembly (never re-sent as images).
  images?: MessageImage[];
  // GIF attachment on a user turn (max one). On the current turn it's decoded
  // into sampled frames for the model; historical turns collapse to a text
  // placeholder, same as images.
  gifs?: MessageGif[];
  // Sticker attachments on a user turn (up to MAX_STICKERS). User-send-only —
  // the model never sends stickers back. On the current turn each sticker's
  // static png is fed to the model (no frame extraction); historical turns
  // collapse to a text placeholder, same as images/gifs.
  stickers?: MessageSticker[];
};

export type AgentUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type AgentDelta =
  | { type: "delta"; text: string }
  // A meme attachment the agent chose via the get_meme tool. Surfaced once,
  // mid-stream, so the orchestrator can persist it on the agent turn and emit
  // it to the client.
  | { type: "meme"; image: MessageImage }
  // A GIF attachment the agent chose via the get_gif tool. Surfaced once,
  // mid-stream, like a meme.
  | { type: "gif"; gif: MessageGif }
  | { type: "usage"; usage: AgentUsage }
  | { type: "done" }
  | { type: "error"; message: string };
