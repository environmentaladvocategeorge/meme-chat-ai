import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

// Cancel an in-flight agent reply. The pause button calls this so the cancel is
// a DURABLE server-side delete rather than a best-effort socket close: deleting
// the agent message doc both removes it from the live listener and signals the
// still-running stream function (which watches its own doc via onSnapshot) to
// abort. Idempotent — a missing/already-finalized reply just deletes nothing.
//
// The reply is addressed either directly by `messageId` (the agent serverId the
// client captured from the SSE `message` event) or, when the client paused
// before that event arrived, by `clientMessageId` (the user turn it answers —
// the agent doc carries it as `inReplyToClientMessageId`).
const schema = z
  .object({
    conversationId: z.string().trim().min(1).max(128),
    messageId: z.string().trim().min(1).max(128).optional(),
    clientMessageId: z.string().trim().min(1).max(128).optional(),
  })
  .refine((body) => Boolean(body.messageId || body.clientMessageId), {
    message: "messageId or clientMessageId is required",
  });

type Db = ReturnType<typeof getFirestore>;

// Pure core (testable): deletes the in-flight agent reply identified by the
// args. Ownership is enforced via the parent conversation's uid (client writes
// to messages are blocked by firestore.rules, so this runs through the Admin
// SDK). Returns how many docs were deleted (0 when already gone — idempotent).
export async function cancelAgentReplyForUser(
  uid: string,
  args: { conversationId: string; messageId?: string; clientMessageId?: string },
  db: Db,
): Promise<{ deleted: number }> {
  const conversationRef = db.collection("conversations").doc(args.conversationId);
  const conversationSnap = await conversationRef.get();
  if (!conversationSnap.exists || conversationSnap.data()?.uid !== uid) {
    // Same opaque error whether missing or not-owner, so a caller can't probe
    // for the existence of other users' conversations.
    throw new HttpsError("not-found", "conversation-not-found");
  }

  const messagesRef = conversationRef.collection("messages");

  // Direct hit by id: only delete it when it's actually an agent reply, so a
  // stray id can never remove a user turn.
  if (args.messageId) {
    const ref = messagesRef.doc(args.messageId);
    const snap = await ref.get();
    if (snap.exists && snap.data()?.role === "agent") {
      await ref.delete();
      return { deleted: 1 };
    }
    // Fall through to the clientMessageId path when the id missed (e.g. the doc
    // was finalized + replaced, or the client only had the clientMessageId).
  }

  if (args.clientMessageId) {
    const query = await messagesRef
      .where("role", "==", "agent")
      .where("inReplyToClientMessageId", "==", args.clientMessageId)
      .get();
    let deleted = 0;
    for (const doc of query.docs) {
      await messagesRef.doc(doc.id).delete();
      deleted += 1;
    }
    return { deleted };
  }

  return { deleted: 0 };
}

// Deletes an in-flight agent reply for the caller (the pause action).
export const cancelAgentReply = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

  const parsed = schema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "invalid-request");
  }

  const result = await cancelAgentReplyForUser(
    uid,
    {
      conversationId: parsed.data.conversationId,
      messageId: parsed.data.messageId,
      clientMessageId: parsed.data.clientMessageId,
    },
    getFirestore(),
  );

  logger.info("[cancelAgentReply] cancelled", {
    uid,
    conversationId: parsed.data.conversationId,
    deleted: result.deleted,
  });

  return { success: true as const, ...result };
});
