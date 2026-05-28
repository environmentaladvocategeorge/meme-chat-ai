import { getFirebaseServices } from "./app";

export type StreamEvent =
  | { type: "conversation"; id: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: string };

type StreamAgentAnswerParams = {
  message: string;
  conversationId?: string | null;
  signal?: AbortSignal;
};

type ParsedFrame = {
  event: string;
  data: string;
};

function parseSSEFrame(frame: string): StreamEvent | null {
  const lines = frame.replace(/\r\n/g, "\n").split("\n");
  const parsed: ParsedFrame = { event: "message", data: "" };

  for (const line of lines) {
    if (line.startsWith("event:")) {
      parsed.event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      const value = line.slice("data:".length).trimStart();
      parsed.data = parsed.data.length > 0 ? `${parsed.data}\n${value}` : value;
    }
  }

  if (parsed.data.length === 0) return null;

  try {
    const data = JSON.parse(parsed.data) as Record<string, unknown>;

    if (parsed.event === "conversation" && typeof data.id === "string") {
      return { type: "conversation", id: data.id };
    }

    if (parsed.event === "delta" && typeof data.text === "string") {
      return { type: "delta", text: data.text };
    }

    if (parsed.event === "done") {
      return { type: "done" };
    }

    if (parsed.event === "error" && typeof data.code === "string") {
      return { type: "error", code: data.code };
    }
  } catch {
    return null;
  }

  return null;
}

function getFunctionUrl() {
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("firebase-project-missing");
  return `https://us-central1-${projectId}.cloudfunctions.net/streamAgentAnswer`;
}

export async function* streamAgentAnswer({
  message,
  conversationId,
  signal,
}: StreamAgentAnswerParams): AsyncIterable<StreamEvent> {
  const firebase = getFirebaseServices();
  if (!firebase.available) throw new Error("firebase-unavailable");

  const user = firebase.services.auth.currentUser;
  if (!user) throw new Error("signed-out");

  const idToken = await user.getIdToken();
  const response = await fetch(getFunctionUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, conversationId: conversationId ?? undefined }),
    signal,
  });

  if (!response.ok) throw new Error(`stream-failed-${response.status}`);
  if (!response.body) throw new Error("stream-body-missing");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSSEFrame(frame);
        if (event) yield event;
        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
