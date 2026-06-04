import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

// A message rating. "up"/"down" are the thumbs; null clears a previous rating.
export const MESSAGE_REACTIONS = ["up", "down"] as const;
export type MessageReaction = (typeof MESSAGE_REACTIONS)[number];

// The emoji-reaction picker's allowlist. A separate axis from the thumbs — a
// message can have both. MUST stay in sync with the client picker set in
// components/MessageActions.tsx (EMOJI_REACTIONS). Validating against a fixed
// set keeps a client from writing arbitrary strings onto the message doc.
export const MESSAGE_EMOJI_REACTIONS = [
  "😂",
  "💀",
  "🔥",
  "😭",
  "🫡",
  "🤔",
  "🥀",
  "✨",
] as const;
export type MessageEmojiReaction = (typeof MESSAGE_EMOJI_REACTIONS)[number];

const schema = z.object({
  conversationId: z.string().trim().min(1).max(128),
  messageId: z.string().trim().min(1).max(128),
  // null un-rates the message (toggle off).
  reaction: z.enum(MESSAGE_REACTIONS).nullable(),
});

const emojiSchema = z.object({
  conversationId: z.string().trim().min(1).max(128),
  messageId: z.string().trim().min(1).max(128),
  // null clears the emoji reaction (toggle off).
  emoji: z.enum(MESSAGE_EMOJI_REACTIONS).nullable(),
});

type Db = ReturnType<typeof getFirestore>;

// Pure core (testable): records (or clears) the caller's thumbs rating on a
// single message. Ownership is enforced via the parent conversation's uid;
// client writes to messages are blocked by firestore.rules, so this must run
// through the Admin SDK.
export async function rateMessageForUser(
  uid: string,
  args: { conversationId: string; messageId: string; reaction: MessageReaction | null },
  db: Db,
): Promise<{ reaction: MessageReaction | null }> {
  const conversationRef = db.collection("conversations").doc(args.conversationId);
  const conversationSnap = await conversationRef.get();
  if (!conversationSnap.exists || conversationSnap.data()?.uid !== uid) {
    // Same opaque error whether missing or not-owner, so a caller can't probe
    // for the existence of other users' conversations.
    throw new HttpsError("not-found", "conversation-not-found");
  }

  const messageRef = conversationRef.collection("messages").doc(args.messageId);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists) {
    throw new HttpsError("not-found", "message-not-found");
  }

  await messageRef.update({
    // FieldValue.delete() removes the field entirely when un-rating, so an
    // un-rated message reads back as "no reaction" rather than null.
    reaction: args.reaction ?? FieldValue.delete(),
    reactionUpdatedAt: FieldValue.serverTimestamp(),
  });

  return { reaction: args.reaction };
}

// Records a thumbs up/down (or clears it) on one of the caller's messages.
export const rateMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

  const parsed = schema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "invalid-request");
  }

  const result = await rateMessageForUser(
    uid,
    {
      conversationId: parsed.data.conversationId,
      messageId: parsed.data.messageId,
      reaction: parsed.data.reaction,
    },
    getFirestore(),
  );

  logger.info("[rateMessage] rated", {
    uid,
    conversationId: parsed.data.conversationId,
    messageId: parsed.data.messageId,
    reaction: parsed.data.reaction,
  });

  return { success: true as const, ...result };
});

// Pure core (testable): sets (or clears) the caller's emoji reaction on a single
// message. Independent of the thumbs rating — stored in its own `emojiReaction`
// field. Same ownership enforcement as rateMessageForUser.
export async function setMessageEmojiForUser(
  uid: string,
  args: {
    conversationId: string;
    messageId: string;
    emoji: MessageEmojiReaction | null;
  },
  db: Db,
): Promise<{ emoji: MessageEmojiReaction | null }> {
  const conversationRef = db.collection("conversations").doc(args.conversationId);
  const conversationSnap = await conversationRef.get();
  if (!conversationSnap.exists || conversationSnap.data()?.uid !== uid) {
    throw new HttpsError("not-found", "conversation-not-found");
  }

  const messageRef = conversationRef.collection("messages").doc(args.messageId);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists) {
    throw new HttpsError("not-found", "message-not-found");
  }

  await messageRef.update({
    // Remove the field entirely when clearing, so an un-reacted message reads
    // back as "no emoji" rather than null.
    emojiReaction: args.emoji ?? FieldValue.delete(),
    emojiReactionUpdatedAt: FieldValue.serverTimestamp(),
  });

  return { emoji: args.emoji };
}

// Sets an emoji reaction (or clears it) on one of the caller's messages.
export const setMessageEmoji = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

  const parsed = emojiSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "invalid-request");
  }

  const result = await setMessageEmojiForUser(
    uid,
    {
      conversationId: parsed.data.conversationId,
      messageId: parsed.data.messageId,
      emoji: parsed.data.emoji,
    },
    getFirestore(),
  );

  logger.info("[setMessageEmoji] reacted", {
    uid,
    conversationId: parsed.data.conversationId,
    messageId: parsed.data.messageId,
    emoji: parsed.data.emoji,
  });

  return { success: true as const, ...result };
});
