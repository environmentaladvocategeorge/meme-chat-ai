import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type FirestoreError,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import type { MessageGif } from "@/domain/gifs";
import type { KlipyMessageImage, MessageImage } from "@/domain/memes";
import { getFirebaseServices } from "./app";

const ALLOWED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

// Defensive read-back of persisted attachments. The backend validated these on
// write (it's the source of truth), so this just shapes Firestore data into
// MessageImage and drops anything malformed rather than re-enforcing policy.
function mapImages(value: unknown): MessageImage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.flatMap((raw): MessageImage[] => {
    if (!raw || typeof raw !== "object") return [];
    const data = raw as Record<string, unknown>;
    if (typeof data.id !== "string" || typeof data.url !== "string") return [];

    // User-uploaded photo (Cloud Storage backed).
    if (data.source === "upload") {
      if (
        typeof data.path !== "string" ||
        typeof data.width !== "number" ||
        typeof data.height !== "number"
      ) {
        return [];
      }
      const mimeType = data.mimeType === "image/png" ? "image/png" : "image/jpeg";
      return [
        {
          id: data.id,
          source: "upload",
          path: data.path,
          url: data.url,
          width: data.width,
          height: data.height,
          mimeType,
          bytes: typeof data.bytes === "number" ? data.bytes : 0,
        },
      ];
    }

    // Klipy meme (CDN backed).
    if (data.source === "klipy" && typeof data.previewUrl === "string") {
      const image: KlipyMessageImage = {
        id: data.id,
        source: "klipy",
        url: data.url,
        previewUrl: data.previewUrl,
      };
      if (typeof data.width === "number") image.width = data.width;
      if (typeof data.height === "number") image.height = data.height;
      if (
        typeof data.mimeType === "string" &&
        (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(data.mimeType)
      ) {
        image.mimeType = data.mimeType as KlipyMessageImage["mimeType"];
      }
      if (typeof data.attribution === "string") {
        image.attribution = data.attribution;
      }
      if (typeof data.memeId === "string") image.memeId = data.memeId;
      return [image];
    }

    return [];
  });
  return images.length > 0 ? images : undefined;
}

// Defensive read-back of persisted GIF attachments. Mirrors mapImages.
function mapGifs(value: unknown): MessageGif[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const gifs = value.flatMap((raw): MessageGif[] => {
    if (!raw || typeof raw !== "object") return [];
    const data = raw as Record<string, unknown>;
    if (
      data.source !== "klipy-gif" ||
      typeof data.id !== "string" ||
      typeof data.url !== "string" ||
      typeof data.previewUrl !== "string" ||
      typeof data.frameSourceUrl !== "string"
    ) {
      return [];
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
    return [gif];
  });
  return gifs.length > 0 ? gifs : undefined;
}

// A snapshot listener fires `permission-denied` when its query stops being
// readable while still attached — most commonly in the brief window during
// account deletion (the auth user is removed server-side first) or on sign-out
// before the listener is torn down. That's expected, not a real failure, so we
// swallow it instead of letting it surface as an uncaught Firestore error.
function handleSnapshotError(scope: string) {
  return (error: FirestoreError) => {
    if (error.code === "permission-denied") return;
    console.warn(`[${scope}] snapshot error:`, error);
  };
}

export type ConversationSummary = {
  id: string;
  uid: string;
  title: string;
  lastMessagePreview: string;
  updatedAt: Date | null;
};

export type StoredChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  images?: MessageImage[];
  gifs?: MessageGif[];
  reaction?: "up" | "down";
  // Emoji reaction stored on an agent reply (independent of the thumbs rating).
  emojiReaction?: string;
  // Brainrot intensity stored on a user turn (1–3).
  levelOfRot?: number;
  status: "complete" | "streaming" | "error";
  createdAt: Date | null;
  clientMessageId?: string;
  inReplyToClientMessageId?: string;
  personaId?: string;
  persona?: {
    id: string;
    name: string;
    slug: string;
    displayName: string;
    avatarKey: string;
  };
};

function requireFirestore() {
  const firebase = getFirebaseServices();
  if (!firebase.available) throw new Error("firebase-unavailable");
  return firebase.services.firestore;
}

function asDate(value: unknown): Date | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate() as Date;
  }

  return null;
}

function mapConversation(id: string, data: DocumentData): ConversationSummary {
  return {
    id,
    uid: typeof data.uid === "string" ? data.uid : "",
    title: typeof data.title === "string" ? data.title : "",
    lastMessagePreview:
      typeof data.lastMessagePreview === "string" ? data.lastMessagePreview : "",
    updatedAt: asDate(data.updatedAt),
  };
}

function mapMessage(id: string, data: DocumentData): StoredChatMessage | null {
  const role = data.role;
  const status = data.status;

  if (
    (role !== "user" && role !== "agent") ||
    (status !== "complete" && status !== "streaming" && status !== "error")
  ) {
    return null;
  }

  const text = typeof data.text === "string" ? data.text : "";
  const images = mapImages(data.images);
  const gifs = mapGifs(data.gifs);
  // Drop only empty *streaming* placeholders; an attachment-only complete
  // message legitimately has empty text but real attachments.
  if (status === "streaming" && text.length === 0 && !images && !gifs) return null;
  const persona =
    data.persona &&
    typeof data.persona === "object" &&
    typeof data.persona.id === "string" &&
    typeof data.persona.name === "string" &&
    typeof data.persona.slug === "string" &&
    typeof data.persona.displayName === "string" &&
    typeof data.persona.avatarKey === "string"
      ? {
          id: data.persona.id,
          name: data.persona.name,
          slug: data.persona.slug,
          displayName: data.persona.displayName,
          avatarKey: data.persona.avatarKey,
        }
      : undefined;

  const reaction =
    data.reaction === "up" || data.reaction === "down" ? data.reaction : undefined;

  const emojiReaction =
    typeof data.emojiReaction === "string" && data.emojiReaction.length > 0
      ? data.emojiReaction
      : undefined;

  const levelOfRot =
    typeof data.levelOfRot === "number" ? data.levelOfRot : undefined;

  return {
    id,
    role,
    text,
    images,
    gifs,
    reaction,
    emojiReaction,
    levelOfRot,
    status,
    createdAt: asDate(data.createdAt),
    clientMessageId:
      typeof data.clientMessageId === "string" ? data.clientMessageId : undefined,
    inReplyToClientMessageId:
      typeof data.inReplyToClientMessageId === "string"
        ? data.inReplyToClientMessageId
        : undefined,
    personaId: typeof data.personaId === "string" ? data.personaId : undefined,
    persona,
  };
}

// Live window over the most recently updated conversations. Older history is
// paged in on demand via fetchOlderConversations — same shape as the messages
// live-window + pager below, so the history screen stays cheap no matter how
// many conversations an account accumulates.
const CONVERSATIONS_LIVE_LIMIT = 50;

// The Firestore rule for listing conversations relies on this exact query
// shape: clients must constrain reads to their own uid.
export function listConversations(uid: string): Query<DocumentData> {
  const db = requireFirestore();
  return query(
    collection(db, "conversations"),
    where("uid", "==", uid),
    orderBy("updatedAt", "desc"),
    limit(CONVERSATIONS_LIVE_LIMIT),
  );
}

export async function getConversations(
  uid: string,
): Promise<ConversationSummary[]> {
  const snapshot = await getDocs(listConversations(uid));
  return snapshot.docs.map((doc) => mapConversation(doc.id, doc.data()));
}

// Pagination cursor: the QueryDocumentSnapshot of the oldest loaded
// conversation. A doc snapshot (not a timestamp) so equal-updatedAt
// neighbors can't be skipped or duplicated across page boundaries.
export type ConversationCursor = QueryDocumentSnapshot<DocumentData>;

export type ConversationsSnapshotMeta = {
  // Cursor for the first fetchOlderConversations call: the oldest doc of the
  // live window. Null when the account has no conversations.
  oldestDoc: ConversationCursor | null;
  // Whether the live window is full — if it isn't, there's nothing older.
  hasMore: boolean;
};

export function subscribeToConversations(
  uid: string,
  cb: (
    conversations: ConversationSummary[],
    meta: ConversationsSnapshotMeta,
  ) => void,
  // Optional: invoked after the default log/swallow when the listener errors,
  // so a caller can resolve its loading state instead of spinning forever (the
  // success callback never fires on a hard error like a network failure).
  onError?: () => void,
): Unsubscribe {
  const logError = handleSnapshotError("conversations");
  return onSnapshot(
    listConversations(uid),
    (snapshot) => {
      cb(snapshot.docs.map((doc) => mapConversation(doc.id, doc.data())), {
        oldestDoc: snapshot.docs[snapshot.docs.length - 1] ?? null,
        hasMore: snapshot.docs.length >= CONVERSATIONS_LIVE_LIMIT,
      });
    },
    (error) => {
      logError(error);
      onError?.();
    },
  );
}

export type OlderConversationsPage = {
  conversations: ConversationSummary[];
  // Cursor for the next page; null when this page came back empty.
  oldestDoc: ConversationCursor | null;
  hasMore: boolean;
};

// One-shot page of conversations older (by updatedAt) than the cursor. Pages
// aren't live — a paged-in conversation that gets updated re-enters through
// the live window instead, and the caller dedupes by id.
export async function fetchOlderConversations(
  uid: string,
  cursor: ConversationCursor,
  pageSize = 50,
): Promise<OlderConversationsPage> {
  const db = requireFirestore();
  const pageQuery = query(
    collection(db, "conversations"),
    where("uid", "==", uid),
    orderBy("updatedAt", "desc"),
    startAfter(cursor),
    limit(pageSize),
  );
  const snapshot = await getDocs(pageQuery);
  return {
    conversations: snapshot.docs.map((doc) =>
      mapConversation(doc.id, doc.data()),
    ),
    oldestDoc: snapshot.docs[snapshot.docs.length - 1] ?? null,
    hasMore: snapshot.docs.length >= pageSize,
  };
}

// Cap the live listener to the most recent N messages so the snapshot callback
// cost stays bounded regardless of how long a conversation runs. Older history
// is paged in on demand via fetchOlderMessages.
const MESSAGES_LIVE_LIMIT = 50;

// Pagination cursor: the QueryDocumentSnapshot of the oldest loaded message.
// A doc snapshot (not a timestamp) so equal-createdAt neighbors can't be
// skipped or duplicated across page boundaries.
export type MessageCursor = QueryDocumentSnapshot<DocumentData>;

export type MessagesSnapshotMeta = {
  // Cursor for the first fetchOlderMessages call: the oldest doc of the live
  // window. Null on an empty conversation.
  oldestDoc: MessageCursor | null;
  // Whether the live window is full — if it isn't, there's nothing older to
  // page in.
  hasMore: boolean;
};

// Live window over the MOST RECENT messages. The query is descending +
// limit(N) — `asc + limit` would pin the window to the *oldest* N docs and new
// messages would never enter it — and the docs are reversed before the
// callback so consumers keep receiving oldest-first.
export function subscribeToMessages(
  conversationId: string,
  cb: (messages: StoredChatMessage[], meta: MessagesSnapshotMeta) => void,
): Unsubscribe {
  const db = requireFirestore();
  const messagesQuery = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("createdAt", "desc"),
    limit(MESSAGES_LIVE_LIMIT),
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const messages = snapshot.docs
        .flatMap((doc) => {
          const message = mapMessage(doc.id, doc.data());
          return message ? [message] : [];
        })
        .reverse();
      cb(messages, {
        // Last doc of the desc query = oldest message in the window.
        oldestDoc: snapshot.docs[snapshot.docs.length - 1] ?? null,
        hasMore: snapshot.docs.length >= MESSAGES_LIVE_LIMIT,
      });
    },
    handleSnapshotError("messages"),
  );
}

export type OlderMessagesPage = {
  // Oldest-first, ready to prepend to the rendered thread.
  messages: StoredChatMessage[];
  // Cursor for the next page (oldest doc of THIS page); null when exhausted.
  cursor: MessageCursor | null;
  // False once a short page signals the conversation start was reached.
  hasMore: boolean;
};

// One-shot fetch of the page of messages older than `cursor`, on the same
// descending index as the live window.
export async function fetchOlderMessages(
  conversationId: string,
  cursor: MessageCursor,
  pageSize = 50,
): Promise<OlderMessagesPage> {
  const db = requireFirestore();
  const pageQuery = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("createdAt", "desc"),
    startAfter(cursor),
    limit(pageSize),
  );
  const snapshot = await getDocs(pageQuery);
  const messages = snapshot.docs
    .flatMap((doc) => {
      const message = mapMessage(doc.id, doc.data());
      return message ? [message] : [];
    })
    .reverse();
  return {
    messages,
    cursor: snapshot.docs[snapshot.docs.length - 1] ?? null,
    hasMore: snapshot.docs.length >= pageSize,
  };
}
