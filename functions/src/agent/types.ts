import type { MessageImage } from "../messages/messageImage";

export type ChatRole = "user" | "agent";

export type ChatMessage = {
  role: ChatRole;
  text: string;
  // Image attachments on a user turn. Present only for historical user
  // messages that carried memes; used to collapse them to cheap text
  // placeholders during context assembly (never re-sent as images).
  images?: MessageImage[];
};

export type AgentUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type AgentDelta =
  | { type: "delta"; text: string }
  | { type: "usage"; usage: AgentUsage }
  | { type: "done" }
  | { type: "error"; message: string };
