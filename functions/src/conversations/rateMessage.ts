import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

// A message rating. "up"/"down" are the thumbs; null clears a previous rating.
export const MESSAGE_REACTIONS = ["up", "down"] as const;
export type MessageReaction = (typeof MESSAGE_REACTIONS)[number];

const schema = z.object({
  conversationId: z.string().trim().min(1).max(128),
  messageId: z.string().trim().min(1).max(128),
  // null un-rates the message (toggle off).
  reaction: z.enum(MESSAGE_REACTIONS).nullable(),
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
