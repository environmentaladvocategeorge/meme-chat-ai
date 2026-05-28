import { getFirebaseServices } from "./app";

export type StreamEvent =
  | { type: "conversation"; id: string }
  | {
      type: "message";
      role: "user" | "agent";
      id: string;
      clientMessageId?: string;
      inReplyToClientMessageId?: string;
    }
  | { type: "model"; id: string }
  | { type: "persona"; id: string; name: string; displayName: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "quota_exceeded"; reason: string; resetAt: string | null }
  | { type: "error"; code: string };

type StreamAgentAnswerParams = {
  message: string;
  conversationId?: string | null;
  clientMessageId?: string;
  personaId?: string | null;
  advanced?: boolean;
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

    if (
      parsed.event === "message" &&
      (data.role === "user" || data.role === "agent") &&
      typeof data.id === "string"
    ) {
      return {
        type: "message",
        role: data.role,
        id: data.id,
        clientMessageId:
          typeof data.clientMessageId === "string"
            ? data.clientMessageId
            : undefined,
        inReplyToClientMessageId:
          typeof data.inReplyToClientMessageId === "string"
            ? data.inReplyToClientMessageId
            : undefined,
      };
    }

    if (parsed.event === "model" && typeof data.id === "string") {
      return { type: "model", id: data.id };
    }

    if (
      parsed.event === "persona" &&
      typeof data.id === "string" &&
      typeof data.name === "string" &&
      typeof data.displayName === "string"
    ) {
      return {
        type: "persona",
        id: data.id,
        name: data.name,
        displayName: data.displayName,
      };
    }

    if (parsed.event === "delta" && typeof data.text === "string") {
      return { type: "delta", text: data.text };
    }

    if (parsed.event === "done") {
      return { type: "done" };
    }

    if (parsed.event === "quota_exceeded") {
      const reason = typeof data.reason === "string" ? data.reason : "monthly";
      const resetAt = typeof data.resetAt === "string" ? data.resetAt : null;
      return { type: "quota_exceeded", reason, resetAt };
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

function makeStreamQueue() {
  const events: StreamEvent[] = [];
  const waiters: Array<{
    resolve: (result: IteratorResult<StreamEvent>) => void;
    reject: (err: Error) => void;
  }> = [];
  let error: Error | null = null;
  let closed = false;

  const flush = () => {
    while (events.length > 0 && waiters.length > 0) {
      waiters.shift()!.resolve({ value: events.shift()!, done: false });
    }

    if (closed) {
      while (waiters.length > 0) {
        waiters.shift()!.resolve({ value: undefined, done: true });
      }
    }

    if (error) {
      while (waiters.length > 0) {
        waiters.shift()!.reject(error);
      }
    }
  };

  return {
    push(event: StreamEvent) {
      if (closed || error) return;
      events.push(event);
      flush();
    },
    fail(err: Error) {
      if (closed || error) return;
      error = err;
      flush();
    },
    close() {
      if (closed || error) return;
      closed = true;
      flush();
    },
    next(): Promise<IteratorResult<StreamEvent>> {
      if (events.length > 0) {
        return Promise.resolve({ value: events.shift()!, done: false });
      }
      if (closed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      if (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
  };
}

export async function* streamAgentAnswer({
  message,
  conversationId,
  clientMessageId,
  personaId,
  advanced,
  signal,
}: StreamAgentAnswerParams): AsyncIterable<StreamEvent> {
  const firebase = getFirebaseServices();
  if (!firebase.available) throw new Error("firebase-unavailable");

  const user = firebase.services.auth.currentUser;
  if (!user) throw new Error("signed-out");

  const idToken = await user.getIdToken();
  const queue = makeStreamQueue();
  const xhr = new XMLHttpRequest();
  const body = JSON.stringify({
    message,
    conversationId: conversationId ?? undefined,
    clientMessageId,
    personaId: personaId ?? undefined,
    advanced: advanced ?? false,
  });
  let buffer = "";
  let seenLength = 0;
  let completed = false;

  const processChunk = (chunk: string) => {
    buffer = `${buffer}${chunk}`.replace(/\r\n/g, "\n");
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseSSEFrame(frame);
      if (event) queue.push(event);
      idx = buffer.indexOf("\n\n");
    }
  };

  const cleanup = () => {
    signal?.removeEventListener("abort", handleAbort);
  };

  const finish = () => {
    if (completed) return;
    completed = true;
    const tail = buffer.trim();
    if (tail.length > 0) {
      const event = parseSSEFrame(tail);
      if (event) queue.push(event);
    }
    cleanup();
    queue.close();
  };

  const fail = (err: Error) => {
    if (completed) return;
    completed = true;
    cleanup();
    queue.fail(err);
  };

  const handleAbort = () => {
    xhr.abort();
    fail(new Error("aborted"));
  };

  signal?.addEventListener("abort", handleAbort);

  xhr.open("POST", getFunctionUrl(), true);
  xhr.setRequestHeader("Authorization", `Bearer ${idToken}`);
  xhr.setRequestHeader("Content-Type", "application/json");

  xhr.onprogress = () => {
    if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) return;
    const nextText = xhr.responseText.slice(seenLength);
    seenLength = xhr.responseText.length;
    processChunk(nextText);
  };

  xhr.onload = () => {
    if (xhr.status < 200 || xhr.status >= 300) {
      fail(new Error(`stream-failed-${xhr.status}`));
      return;
    }

    const nextText = xhr.responseText.slice(seenLength);
    seenLength = xhr.responseText.length;
    processChunk(nextText);
    finish();
  };

  xhr.onerror = () => {
    fail(new Error("stream-network-error"));
  };

  xhr.ontimeout = () => {
    fail(new Error("stream-timeout"));
  };

  xhr.onabort = () => {
    fail(new Error("aborted"));
  };

  xhr.send(body);

  try {
    while (true) {
      const next = await queue.next();
      if (next.done) break;
      yield next.value;
    }
  } finally {
    if (!completed) {
      xhr.abort();
      cleanup();
    }
  }
}
