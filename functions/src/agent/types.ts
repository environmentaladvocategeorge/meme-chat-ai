export type ChatRole = "user" | "agent";

export type ChatMessage = {
  role: ChatRole;
  text: string;
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
