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
  // A meme attachment the agent chose via the get_meme tool. Surfaced once,
  // mid-stream, so the orchestrator can persist it on the agent turn and emit
  // it to the client.
  | { type: "meme"; image: MessageImage }
  | { type: "usage"; usage: AgentUsage }
  | { type: "done" }
  | { type: "error"; message: string };
