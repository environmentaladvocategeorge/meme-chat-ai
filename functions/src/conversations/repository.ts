import {
  FieldValue,
  QueryDocumentSnapshot,
  getFirestore,
} from "firebase-admin/firestore";
import type { ChatMessage, ChatRole } from "../agent/types";
import type { PlanId } from "../billing/plans";
import type { MessageGif } from "../messages/messageGif";
import type { MessageImage } from "../messages/messageImage";

type MessageStatus = "complete" | "streaming" | "error";

type StoredMessage = {
  role?: ChatRole;
  text?: string;
  status?: MessageStatus;
  images?: MessageImage[];
  gifs?: MessageGif[];
};

// Placeholder title shown for image-only conversations (no first-message text
// to title from yet). It's only temporary now: generateConversationTitle titles
// from the opening exchange once the bot's first reply lands, so even a meme-
// only opener gets a real title from how the bot reacted to it.
const IMAGE_ONLY_TITLE_FALLBACK = "Sent a meme";

// Neutral placeholder for a text opener. We deliberately do NOT seed the title
// from the raw user message anymore: when a message was blocked before the bot
// replied (e.g. the hate-speech gate), there was no reply, so AI titling never
// ran and the raw text — slurs included — stayed as the chat-list title forever.
// A generic placeholder never leaks user text; generateConversationTitle names
// the exchange once the bot's first reply lands.
const NEW_CONVERSATION_TITLE_FALLBACK = "New Chat 💬";

// Title applied when a new conversation's opening message is flagged by the
// moderation gate (see markConversationFiltered). Replaces the placeholder so a
// blocked opener never shows raw flagged text.
const PROFANITY_FILTERED_TITLE = "Filtered due to profanity";

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
  const gifs = Array.isArray(data.gifs) ? data.gifs : undefined;
  const hasImages = Boolean(images && images.length > 0);
  const hasGifs = Boolean(gifs && gifs.length > 0);
  if (text.length === 0 && !hasImages && !hasGifs) return null;

  const message: ChatMessage = { role: data.role, text };
  if (hasImages) message.images = images;
  if (hasGifs) message.gifs = gifs;
  return message;
}

export async function createConversation(
  uid: string,
  firstUserMessageText: string,
  options?: { hasImages?: boolean },
): Promise<{ conversationId: string }> {
  const db = getFirestore();
  const conversationRef = db.collection("conversations").doc();

  const trimmedFirst = firstUserMessageText.trim();
  // Always a neutral placeholder until generateConversationTitle names the
  // exchange from the bot's first reply. Image-only openers get the meme
  // placeholder; everything else gets the generic one. We never seed from raw
  // user text (see NEW_CONVERSATION_TITLE_FALLBACK).
  const title =
    trimmedFirst.length === 0 && options?.hasImages
      ? IMAGE_ONLY_TITLE_FALLBACK
      : NEW_CONVERSATION_TITLE_FALLBACK;

  await conversationRef.set({
    uid,
    // Placeholder title shown immediately; generateConversationTitle replaces it
    // with a meme title once the bot's first reply lands.
    title,
    firstUserMessage: firstUserMessageText.slice(0, 500),
    titleGenerated: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    lastMessagePreview: "",
  });

  return { conversationId: conversationRef.id };
}

// Re-titles a conversation whose opening message was rejected by the moderation
// gate before the bot ever replied. Without this the conversation would keep the
// neutral placeholder forever (no reply -> AI titling never runs); this gives a
// clear, content-free label instead. titleGenerated is set so the background
// titler treats it as done and never tries to title the blocked exchange.
export async function markConversationFiltered(
  conversationId: string,
): Promise<void> {
  await getFirestore()
    .collection("conversations")
    .doc(conversationId)
    .set(
      {
        title: PROFANITY_FILTERED_TITLE,
        titleGenerated: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
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
    gifs?: MessageGif[];
    // Brainrot intensity selected for this turn (1–3). Stored as-is on the
    // message; nothing downstream consumes it yet.
    levelOfRot?: number;
    // The turn's local-only answering prefs (Respond with emojis / with media).
    // Denormalized onto the user message so turn replay can reconstruct the same
    // prefs server-side, exactly like levelOfRot. Stored as their own boolean
    // fields (NOT folded into `text`) so the memory extractor — which only reads
    // message text — never picks them up. Only written when explicitly false, so
    // the common "both on" turn stays byte-identical to the pre-toggle format.
    respondWithEmojis?: boolean;
    respondWithMedia?: boolean;
    // The conversation owner's current plan, denormalized onto the conversation
    // doc so the background summarizer (which only sees the conversation, not
    // the user) can size the verbatim window to the plan's token budget. Stamped
    // every turn so it tracks upgrades/downgrades.
    plan?: PlanId;
  },
): Promise<{ messageId: string }> {
  const db = getFirestore();
  const messageRef = db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc();

  const hasImages = Boolean(message.images && message.images.length > 0);
  const hasGifs = Boolean(message.gifs && message.gifs.length > 0);

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

  if (hasGifs) {
    messageData.gifs = message.gifs;
  }

  if (typeof message.levelOfRot === "number") {
    messageData.levelOfRot = message.levelOfRot;
  }

  // Persist only the OFF state — both default to true everywhere, so writing the
  // field only when it's false keeps "both on" turns identical to before.
  if (message.respondWithEmojis === false) {
    messageData.respondWithEmojis = false;
  }
  if (message.respondWithMedia === false) {
    messageData.respondWithMedia = false;
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

  if (message.plan) {
    conversationUpdate.plan = message.plan;
  }

  if (message.persona) {
    conversationUpdate.lastPersonaId = message.persona.id;
    conversationUpdate.lastPersona = message.persona;
    // Track every bot that has taken part in this conversation (the history
    // list shows their stacked avatars; the chat shows per-message avatars once
    // there are 2+). arrayUnion is idempotent, so re-using a bot is a no-op.
    // New conversations get their first id here; existing ones are backfilled to
    // [brainrot_bot_default] by scripts/backfill-conversation-participants.cjs.
    conversationUpdate.participantPersonaIds = FieldValue.arrayUnion(
      message.persona.id,
    );
  }

  if (message.text.length > 0) {
    conversationUpdate.lastMessagePreview = message.text.slice(0, 160);
  } else if (hasImages || hasGifs) {
    // Attachment-only turn: keep the list preview non-blank. The client renders
    // the thumbnail itself; this is just the fallback label for the history
    // list.
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
  // GIF attachment the agent chose for this turn (a get_gif result). Omitted
  // for plain text replies.
  gifs?: MessageGif[],
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
  if (gifs && gifs.length > 0) {
    messageUpdate.gifs = gifs;
  }

  await db
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId)
    .update(messageUpdate);

  const hasAttachment =
    Boolean(images && images.length > 0) || Boolean(gifs && gifs.length > 0);
  await db.collection("conversations").doc(conversationId).update({
    updatedAt: FieldValue.serverTimestamp(),
    lastMessagePreview:
      finalText.length > 0
        ? finalText.slice(0, 160)
        : hasAttachment
          ? "Sent a meme"
          : "",
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

// A stored message read back in full enough for turn replay: identity + role +
// content + the user-turn fields (attachments, rot level, clientMessageId) the
// replay needs to reconstruct the original turn as the "current" turn.
export type ReplayMessageRecord = {
  id: string;
  role: ChatRole;
  text: string;
  status: MessageStatus;
  clientMessageId?: string;
  inReplyToClientMessageId?: string;
  images?: MessageImage[];
  gifs?: MessageGif[];
  levelOfRot?: number;
  // The turn's local-only answering prefs, read back for replay. Absent fields
  // mean "on" (the default), since appendMessage only persists the OFF state.
  respondWithEmojis?: boolean;
  respondWithMedia?: boolean;
  // Persona the agent reply was generated with (agent records only). Replay
  // reuses it so the same character answers again.
  personaId?: string;
};

export type ReplayTargets =
  | { found: false }
  | {
      found: true;
      // True only when the target agent message is the most recent message in
      // the conversation — the guard that keeps replay from orphaning anything
      // that came after it.
      isLatest: boolean;
      agent: ReplayMessageRecord;
      // The user turn the agent message answered (resolved via
      // inReplyToClientMessageId, else the nearest preceding user message).
      // Null when it can't be located within the scan window.
      user: ReplayMessageRecord | null;
    };

function toReplayRecord(doc: QueryDocumentSnapshot): ReplayMessageRecord | null {
  const data = doc.data() as StoredMessage & {
    clientMessageId?: string;
    inReplyToClientMessageId?: string;
    levelOfRot?: number;
    respondWithEmojis?: boolean;
    respondWithMedia?: boolean;
    personaId?: string;
  };
  if (data.role !== "user" && data.role !== "agent") return null;
  const record: ReplayMessageRecord = {
    id: doc.id,
    role: data.role,
    text: typeof data.text === "string" ? data.text : "",
    status: data.status ?? "complete",
  };
  if (typeof data.clientMessageId === "string") {
    record.clientMessageId = data.clientMessageId;
  }
  if (typeof data.inReplyToClientMessageId === "string") {
    record.inReplyToClientMessageId = data.inReplyToClientMessageId;
  }
  if (Array.isArray(data.images) && data.images.length > 0) {
    record.images = data.images;
  }
  if (Array.isArray(data.gifs) && data.gifs.length > 0) {
    record.gifs = data.gifs;
  }
  if (typeof data.levelOfRot === "number") {
    record.levelOfRot = data.levelOfRot;
  }
  if (typeof data.respondWithEmojis === "boolean") {
    record.respondWithEmojis = data.respondWithEmojis;
  }
  if (typeof data.respondWithMedia === "boolean") {
    record.respondWithMedia = data.respondWithMedia;
  }
  if (typeof data.personaId === "string") {
    record.personaId = data.personaId;
  }
  return record;
}

// Resolves everything turn replay needs in a single ordered read: whether the
// target agent message is still the latest message (the orphan guard), the
// agent record itself, and the user turn it answered. One query, newest-first,
// so no composite index is required. `scanLimit` bounds the lookback; a user
// turn always sits immediately before its agent reply, so the default is ample.
export async function loadReplayTargets(
  conversationId: string,
  agentMessageId: string,
  scanLimit = 20,
): Promise<ReplayTargets> {
  const snapshot = await getFirestore()
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .orderBy("createdAt", "desc")
    .limit(scanLimit)
    .get();

  const docs = snapshot.docs;
  const agentIdx = docs.findIndex((d) => d.id === agentMessageId);
  if (agentIdx < 0) return { found: false };

  const agent = toReplayRecord(docs[agentIdx]);
  if (!agent || agent.role !== "agent") return { found: false };

  const isLatest = docs[0]?.id === agentMessageId;

  // Locate the user turn this reply answered. Prefer the exact link via
  // inReplyToClientMessageId; fall back to the nearest older user message.
  let user: ReplayMessageRecord | null = null;
  if (agent.inReplyToClientMessageId) {
    const linked = docs.find(
      (d) =>
        (d.data() as { clientMessageId?: string }).clientMessageId ===
        agent.inReplyToClientMessageId,
    );
    if (linked) user = toReplayRecord(linked);
  }
  if (!user) {
    // docs are newest-first; entries after agentIdx are older than the reply.
    for (let i = agentIdx + 1; i < docs.length; i++) {
      const record = toReplayRecord(docs[i]);
      if (record?.role === "user") {
        user = record;
        break;
      }
    }
  }

  return { found: true, isLatest, agent, user };
}

// Hard-deletes a single message doc. Used by turn replay to remove the old
// agent reply before regenerating. Deliberately touches nothing in the billing
// ledger — the deletion is free, and the fresh stream charges itself.
export async function deleteMessage(
  conversationId: string,
  messageId: string,
): Promise<void> {
  await getFirestore()
    .collection("conversations")
    .doc(conversationId)
    .collection("messages")
    .doc(messageId)
    .delete();
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
