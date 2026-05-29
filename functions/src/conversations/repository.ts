import {
  FieldValue,
  QueryDocumentSnapshot,
  getFirestore,
} from "firebase-admin/firestore";
import type { ChatMessage, ChatRole } from "../agent/types";
import type { MessageImage } from "../messages/messageImage";

type MessageStatus = "complete" | "streaming" | "error";

type StoredMessage = {
  role?: ChatRole;
  text?: string;
  status?: MessageStatus;
  images?: MessageImage[];
};

// Title shown for image-only conversations (no first-message text for the
// title model to work from). The generateConversationTitle trigger leaves this
// untouched because firstUserMessage is empty.
const IMAGE_ONLY_TITLE_FALLBACK = "Sent a meme";

export type MessagePersonaMetadata = {
  id: string;
  name: string;
  slug: string;
  displayName: string;
  avatarKey: string;
};

function mapMessage(doc: QueryDocumentSnapshot): ChatMessage | null {
  const data = doc.data() as StoredMessage;
  if ((data.role !== "user" && data.role !== "agent") || data.status !== "complete") {
    return null;
  }

  const text = typeof data.text === "string" ? data.text : "";
  const images = Array.isArray(data.images) ? data.images : undefined;
  const hasImages = Boolean(images && images.length > 0);
  if (text.length === 0 && !hasImages) return null;

  return hasImages ? { role: data.role, text, images } : { role: data.role, text };
}

export async function createConversation(
  uid: string,
  firstUserMessageText: string,
  options?: { hasImages?: boolean },
): Promise<{ conversationId: string }> {
  const db = getFirestore();
  const conversationRef = db.collection("conversations").doc();

  const trimmedFirst = firstUserMessageText.trim();
  // Image-only opener: there's no text for the title model, so seed a fixed
  // fallback and leave firstUserMessage empty (the title trigger short-circuits
  // on empty text, so the fallback stays).
  const title =
    trimmedFirst.length === 0 && options?.hasImages
      ? IMAGE_ONLY_TITLE_FALLBACK
      : firstUserMessageText.slice(0, 60);

  await conversationRef.set({
    uid,
    // Truncated fallback title shown immediately; the generateConversationTitle
    // trigger replaces it with a meme title once gpt-5-nano responds.
    title,
    firstUserMessage: firstUserMessageText.slice(0, 500),
    titleGenerated: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastMessagePreview: "",
  });

  return { conversationId: conversationRef.id };
}

export async function assertConversationOwner(
  conversationId: string,
  uid: string,
): Promise<void> {
  const snapshot = await getFirestore()
    .collection("conversations")
    .doc(conversationId)
    .get();

  if (!snapshot.exists || snapshot.data()?.uid !== uid) {
    throw new Error("conversation-not-found");
  }
}

export async function appendMessage(
  conversationId: string,
  message: {
    role: ChatRole;
    text: string;
    status: MessageStatus;
    clientMessageId?: string;
    inReplyToClientMessageId?: string;
    persona?: MessagePersonaMetadata;
    images?: MessageImage[];
    // Brainrot intensity selected for this turn (1–3). Stored as-is on the
    // message; nothing downstream consumes it yet.
    levelOfRot?: number;
  },
): Promise<{ messageId: string }> {
  const db = getFirestore();
  const messageRef = db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc();

  const hasImages = Boolean(message.images && message.images.length > 0);

  const messageData: Record<string, unknown> = {
    role: message.role,
    text: message.text,
    status: message.status,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (hasImages) {
    messageData.images = message.images;
  }

  if (typeof message.levelOfRot === "number") {
    messageData.levelOfRot = message.levelOfRot;
  }

  if (message.persona) {
    messageData.personaId = message.persona.id;
    messageData.persona = message.persona;
  }

  if (message.clientMessageId) {
    messageData.clientMessageId = message.clientMessageId;
  }

  if (message.inReplyToClientMessageId) {
    messageData.inReplyToClientMessageId = message.inReplyToClientMessageId;
  }

  await messageRef.set(messageData);

  const conversationUpdate: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (message.persona) {
    conversationUpdate.lastPersonaId = message.persona.id;
    conversationUpdate.lastPersona = message.persona;
  }

  if (message.text.length > 0) {
    conversationUpdate.lastMessagePreview = message.text.slice(0, 160);
  } else if (hasImages) {
    // Image-only turn: keep the list preview non-blank. The client renders the
    // thumbnail itself; this is just the fallback label for the history list.
    conversationUpdate.lastMessagePreview = IMAGE_ONLY_TITLE_FALLBACK;
  }

  await db.collection("conversations").doc(conversationId).update(conversationUpdate);

  return { messageId: messageRef.id };
}

export async function finalizeAgentMessage(
  conversationId: string,
  messageId: string,
  finalText: string,
  // Image attachments the agent chose for this turn (e.g. a get_meme result).
  // Omitted for plain text replies.
  images?: MessageImage[],
): Promise<void> {
  const db = getFirestore();

  const messageUpdate: Record<string, unknown> = {
    text: finalText,
    status: "complete",
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (images && images.length > 0) {
    messageUpdate.images = images;
  }

  await db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId)
    .update(messageUpdate);

  const hasImages = Boolean(images && images.length > 0);
  await db.collection("conversations").doc(conversationId).update({
    updatedAt: FieldValue.serverTimestamp(),
    lastMessagePreview:
      finalText.length > 0 ? finalText.slice(0, 160) : hasImages ? "Sent a meme" : "",
  });
}

export async function markAgentMessageErrored(
  conversationId: string,
  messageId: string,
): Promise<void> {
  const db = getFirestore();

  await db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId)
    .update({
      status: "error",
      updatedAt: FieldValue.serverTimestamp(),
    });

  await db.collection("conversations").doc(conversationId).update({
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function loadRecentMessages(
  conversationId: string,
  limit = 20,
): Promise<ChatMessage[]> {
  const snapshot = await getFirestore()
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.reverse().flatMap((doc) => {
    const message = mapMessage(doc);
    return message ? [message] : [];
  });
}
