import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type Query,
  type Unsubscribe,
} from "firebase/firestore";
import { getFirebaseServices } from "./app";

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
  status: "complete" | "streaming" | "error";
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
  if (status === "streaming" && text.length === 0) return null;

  return {
    id,
    role,
    text,
    status,
  };
}

// The Firestore rule for listing conversations relies on this exact query
// shape: clients must constrain reads to their own uid.
export function listConversations(uid: string): Query<DocumentData> {
  const db = requireFirestore();
  return query(
    collection(db, "conversations"),
    where("uid", "==", uid),
    orderBy("updatedAt", "desc"),
    limit(50),
  );
}

export async function getConversations(
  uid: string,
): Promise<ConversationSummary[]> {
  const snapshot = await getDocs(listConversations(uid));
  return snapshot.docs.map((doc) => mapConversation(doc.id, doc.data()));
}

export function subscribeToConversations(
  uid: string,
  cb: (conversations: ConversationSummary[]) => void,
): Unsubscribe {
  return onSnapshot(listConversations(uid), (snapshot) => {
    cb(snapshot.docs.map((doc) => mapConversation(doc.id, doc.data())));
  });
}

export function subscribeToMessages(
  conversationId: string,
  cb: (messages: StoredChatMessage[]) => void,
): Unsubscribe {
  const db = requireFirestore();
  const messagesQuery = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("createdAt", "asc"),
  );

  return onSnapshot(messagesQuery, (snapshot) => {
    cb(
      snapshot.docs.flatMap((doc) => {
        const message = mapMessage(doc.id, doc.data());
        return message ? [message] : [];
      }),
    );
  });
}
