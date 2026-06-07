import type { MessageGif } from "@/domain/gifs";
import type { MessageImage } from "@/domain/memes";
import { getFirebaseServices } from "./app";
import {
  EMULATOR_PORTS,
  getEmulatorHost,
  USE_FIREBASE_EMULATOR,
} from "./emulator";
import { SessionExpiredError } from "./sessionErrors";

// Re-exported so existing importers can reach the error type via this module.
export { SessionExpiredError } from "./sessionErrors";

// A non-2xx HTTP response from the stream endpoint. The status is preserved so
// the generator can tell an auth rejection (401) apart from everything else.
class StreamHttpError extends Error {
  constructor(readonly status: number) {
    super(`stream-failed-${status}`);
    this.name = "StreamHttpError";
  }
}

function isUnauthorized(err: unknown): err is StreamHttpError {
  return err instanceof StreamHttpError && err.status === 401;
}

// Firebase Auth error codes that mean the local session is dead and cannot be
// silently refreshed — the SDK can't mint a new ID token from this state, so
// the only recovery is to sign in again.
const TERMINAL_AUTH_ERROR_CODES = new Set([
  "auth/user-token-expired",
  "auth/user-disabled",
  "auth/user-not-found",
  "auth/invalid-user-token",
  "auth/user-token-revoked",
  "auth/requires-recent-login",
]);

function isTerminalAuthError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && TERMINAL_AUTH_ERROR_CODES.has(code);
  }
  return false;
}

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
  // A meme the agent attached to its reply (via the backend get_meme tool).
  | { type: "meme"; image: MessageImage }
  // A GIF the agent attached to its reply (via the backend get_gif tool).
  | { type: "gif"; gif: MessageGif }
  | { type: "done" }
  | { type: "quota_exceeded"; reason: string; resetAt: string | null }
  | { type: "hate_speech" }
  | { type: "error"; code: string };

type StreamAgentAnswerParams = {
  message: string;
  images?: MessageImage[];
  // The single GIF attached to this turn, if any (separate from images).
  gif?: MessageGif | null;
  conversationId?: string | null;
  clientMessageId?: string;
  personaId?: string | null;
  // Brainrot intensity dial (1–3). Sent to the backend, which stores it on the
  // user turn. Omitted falls back to the backend default (2).
  levelOfRot?: number;
  // The user's resolved app language code (e.g. "en", "es") — never "system".
  // The backend folds it into the per-user system message so the model defaults
  // to replying in this language.
  language?: string;
  signal?: AbortSignal;
};

type ParsedFrame = {
  event: string;
  data: string;
};

// Defensive shaping of a meme attachment off the wire. The backend validated
// it on the way out (it's the source of truth); this just confirms the fields
// the UI needs and drops anything malformed.
function parseMessageImage(value: unknown): MessageImage | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.source !== "klipy" ||
    typeof data.id !== "string" ||
    typeof data.url !== "string" ||
    typeof data.previewUrl !== "string"
  ) {
    return null;
  }
  const image: MessageImage = {
    id: data.id,
    source: "klipy",
    url: data.url,
    previewUrl: data.previewUrl,
  };
  if (typeof data.width === "number") image.width = data.width;
  if (typeof data.height === "number") image.height = data.height;
  if (typeof data.attribution === "string") image.attribution = data.attribution;
  if (typeof data.memeId === "string") image.memeId = data.memeId;
  return image;
}

// Defensive shaping of a GIF attachment off the wire. Mirrors parseMessageImage.
function parseMessageGif(value: unknown): MessageGif | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    data.source !== "klipy-gif" ||
    typeof data.id !== "string" ||
    typeof data.url !== "string" ||
    typeof data.previewUrl !== "string" ||
    typeof data.frameSourceUrl !== "string"
  ) {
    return null;
  }
  const gif: MessageGif = {
    id: data.id,
    source: "klipy-gif",
    url: data.url,
    previewUrl: data.previewUrl,
    frameSourceUrl: data.frameSourceUrl,
  };
  if (typeof data.width === "number") gif.width = data.width;
  if (typeof data.height === "number") gif.height = data.height;
  if (typeof data.attribution === "string") gif.attribution = data.attribution;
  if (typeof data.gifId === "string") gif.gifId = data.gifId;
  return gif;
}

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

    if (parsed.event === "meme") {
      const image = parseMessageImage(data.image);
      if (image) return { type: "meme", image };
    }

    if (parsed.event === "gif") {
      const gif = parseMessageGif(data.gif);
      if (gif) return { type: "gif", gif };
    }

    if (parsed.event === "done") {
      return { type: "done" };
    }

    if (parsed.event === "hate_speech") {
      return { type: "hate_speech" };
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

function getFunctionUrl(functionName: string) {
  const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("firebase-project-missing");
  // httpsCallable picks up the emulator via connectFunctionsEmulator, but these
  // streaming onRequest endpoints build their own URL, so redirect them here.
  if (USE_FIREBASE_EMULATOR) {
    const host = getEmulatorHost();
    return `http://${host}:${EMULATOR_PORTS.functions}/${projectId}/us-central1/${functionName}`;
  }
  return `https://us-central1-${projectId}.cloudfunctions.net/${functionName}`;
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

type StreamAttempt = {
  queue: ReturnType<typeof makeStreamQueue>;
  // Tears down this attempt's XHR + listeners. Safe to call repeatedly and
  // after the attempt has already settled (no-op in that case).
  abort: () => void;
};

// Fires a single POST to the stream endpoint with the given token and surfaces
// its SSE frames through a queue. The generator below owns retry/refresh logic;
// this just runs one attempt's transport.
function startStreamAttempt(
  url: string,
  idToken: string,
  body: string,
  signal: AbortSignal | undefined,
): StreamAttempt {
  const queue = makeStreamQueue();
  const xhr = new XMLHttpRequest();
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

  xhr.open("POST", url, true);
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
      fail(new StreamHttpError(xhr.status));
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

  return {
    queue,
    abort: () => {
      if (completed) return;
      xhr.abort();
      cleanup();
    },
  };
}

// Runs an authenticated SSE stream against `url` with the given JSON `body`,
// owning the token-fetch + 401-refresh-replay retry logic shared by every
// stream endpoint (the live answer stream and turn replay). The caller only
// builds the request body; this handles auth and surfaces SSE frames.
async function* runAuthedStream(
  url: string,
  body: string,
  signal: AbortSignal | undefined,
): AsyncIterable<StreamEvent> {
  const firebase = getFirebaseServices();
  if (!firebase.available) throw new Error("firebase-unavailable");

  const user = firebase.services.auth.currentUser;
  if (!user) throw new Error("signed-out");

  // `getIdToken()` returns the cached token and only refreshes if it's near
  // expiry. If it throws naming a dead session, that's terminal — surface it as
  // a session-expired failure so the UI re-auths instead of showing a useless
  // retry. Other failures (e.g. transient network) propagate as generic errors.
  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch (err) {
    if (isTerminalAuthError(err)) throw new SessionExpiredError();
    throw err;
  }

  // A 401 means the backend rejected the token — it can be locally valid yet
  // already revoked server-side (we verify with checkRevoked), so a cached
  // token would loop forever. Force-refresh and replay exactly once; if that
  // still fails the session is genuinely gone.
  let forcedRefresh = false;
  while (true) {
    const attempt = startStreamAttempt(url, idToken, body, signal);
    let yieldedAny = false;
    try {
      while (true) {
        const next = await attempt.queue.next();
        if (next.done) break;
        yieldedAny = true;
        yield next.value;
      }
      return;
    } catch (err) {
      // The backend rejects auth before flushing any SSE frame, so a 401 can
      // only surface with nothing yielded yet — that's what makes a clean
      // replay safe.
      if (isUnauthorized(err) && !yieldedAny && !forcedRefresh) {
        forcedRefresh = true;
        try {
          idToken = await user.getIdToken(true);
        } catch {
          throw new SessionExpiredError();
        }
        continue;
      }
      if (isUnauthorized(err)) throw new SessionExpiredError();
      throw err;
    } finally {
      // Runs on normal completion, throw, early consumer return, AND before a
      // retry's `continue` — tearing down the just-finished attempt's XHR.
      attempt.abort();
    }
  }
}

export async function* streamAgentAnswer({
  message,
  images,
  gif,
  conversationId,
  clientMessageId,
  personaId,
  levelOfRot,
  language,
  signal,
}: StreamAgentAnswerParams): AsyncIterable<StreamEvent> {
  const body = JSON.stringify({
    message,
    // Only include `images` / `gifs` when present, so text-only payloads stay
    // byte-identical to the pre-attachment format (backend defaults to []).
    images: images && images.length > 0 ? images : undefined,
    gifs: gif ? [gif] : undefined,
    conversationId: conversationId ?? undefined,
    clientMessageId,
    personaId: personaId ?? undefined,
    levelOfRot,
    language,
  });

  yield* runAuthedStream(getFunctionUrl("streamAgentAnswer"), body, signal);
}

type StreamReplayTurnParams = {
  // The conversation owning the reply to regenerate.
  conversationId: string;
  // The agent message to replace. The backend deletes it and streams a fresh
  // answer for the same user turn; it must be the conversation's latest message.
  agentMessageId: string;
  // The user's resolved app language (never "system"), folded into the system
  // message exactly like a normal turn.
  language?: string;
  signal?: AbortSignal;
};

// Regenerates an existing agent reply. Emits the same SSE event stream as
// streamAgentAnswer (model/persona/delta/meme/gif/done, plus quota_exceeded or
// error), so the chat store can consume it through the same code path. The user
// turn is read server-side, so nothing about the original message is resent.
export async function* streamReplayTurn({
  conversationId,
  agentMessageId,
  language,
  signal,
}: StreamReplayTurnParams): AsyncIterable<StreamEvent> {
  const body = JSON.stringify({ conversationId, agentMessageId, language });
  yield* runAuthedStream(getFunctionUrl("streamReplayTurn"), body, signal);
}
