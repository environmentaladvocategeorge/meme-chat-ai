export type ChatRole = "user" | "agent";

export type ChatMessage = {
  role: ChatRole;
  text: string;
};

export type AgentDelta =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };
