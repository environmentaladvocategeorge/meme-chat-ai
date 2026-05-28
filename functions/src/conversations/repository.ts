import {
  FieldValue,
  QueryDocumentSnapshot,
  getFirestore,
} from "firebase-admin/firestore";
import type { ChatMessage, ChatRole } from "../agent/types";

type MessageStatus = "complete" | "streaming" | "error";

type StoredMessage = {
  role?: ChatRole;
  text?: string;
  status?: MessageStatus;
};

export type MessagePersonaMetadata = {
  id: string;
  name: string;
  slug: string;
  displayName: string;
  avatarKey: string;
};

function mapMessage(doc: QueryDocumentSnapshot): ChatMessage | null {
  const data = doc.data() as StoredMessage;
  if (
    (data.role === "user" || data.role === "agent") &&
    typeof data.text === "string" &&
    data.text.length > 0 &&
    data.status === "complete"
  ) {
    return { role: data.role, text: data.text };
  }

  return null;
}

export async function createConversation(
  uid: string,
  firstUserMessageText: string,
): Promise<{ conversationId: string }> {
  const db = getFirestore();
  const conversationRef = db.collection("conversations").doc();

  await conversationRef.set({
    uid,
    title: firstUserMessageText.slice(0, 60),
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
  },
): Promise<{ messageId: string }> {
  const db = getFirestore();
  const messageRef = db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc();

  const messageData: Record<string, unknown> = {
    role: message.role,
    text: message.text,
    status: message.status,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

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
  }

  await db.collection("conversations").doc(conversationId).update(conversationUpdate);

  return { messageId: messageRef.id };
}

export async function finalizeAgentMessage(
  conversationId: string,
  messageId: string,
  finalText: string,
): Promise<void> {
  const db = getFirestore();

  await db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId)
    .update({
      text: finalText,
      status: "complete",
      updatedAt: FieldValue.serverTimestamp(),
    });

  await db.collection("conversations").doc(conversationId).update({
    updatedAt: FieldValue.serverTimestamp(),
    lastMessagePreview: finalText.slice(0, 160),
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
