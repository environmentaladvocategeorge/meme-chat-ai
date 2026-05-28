import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

const schema = z.object({
  conversationIds: z.array(z.string().trim().min(1).max(128)).min(1).max(100),
});

type Db = ReturnType<typeof getFirestore>;

// Pure core (testable): deletes the caller's conversations + their `messages`
// subcollection. Returns how many were actually deleted.
//
// IMPORTANT: this touches ONLY conversation documents. It never reads or
// mutates profiles/{uid} billing, reservations, or usageEvents — so deleting
// chats can't claw back spent credits or otherwise bypass the quota. Usage is
// accounted at send time and stays accounted.
export async function deleteConversationsForUser(
  uid: string,
  conversationIds: string[],
  db: Db,
): Promise<number> {
  const ids = Array.from(new Set(conversationIds));
  let deleted = 0;

  for (const id of ids) {
    const ref = db.collection("conversations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) continue;

    // Ownership guard. A caller may only delete their own conversations.
    if (snap.data()?.uid !== uid) {
      throw new HttpsError("permission-denied", "not-owner");
    }

    // recursiveDelete removes the conversation doc plus its messages
    // subcollection in one shot.
    await db.recursiveDelete(ref);
    deleted += 1;
  }

  return deleted;
}

// Deletes one or more of the caller's conversations via the Admin SDK, since
// firestore.rules blocks client deletes outright.
export const deleteConversations = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

  const parsed = schema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "invalid-request");
  }

  const deleted = await deleteConversationsForUser(
    uid,
    parsed.data.conversationIds,
    getFirestore(),
  );

  logger.info("[deleteConversations] deleted", {
    uid,
    requested: parsed.data.conversationIds.length,
    deleted,
  });

  return { success: true as const, deleted };
});
