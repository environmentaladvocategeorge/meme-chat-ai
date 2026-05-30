import { getFirestore, type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { deleteUploadObjects } from "../messages/resolveImageInputs";

// Collects the Storage object paths of any user-uploaded images attached to a
// conversation's messages, so they can be deleted from Cloud Storage alongside
// the Firestore docs. Path-based (exact) so it works regardless of how the
// upload folder was named at capture time.
async function collectUploadPaths(ref: DocumentReference): Promise<string[]> {
  const messages = await ref.collection("messages").get();
  const paths: string[] = [];
  for (const doc of messages.docs) {
    const images = doc.data().images;
    if (!Array.isArray(images)) continue;
    for (const image of images) {
      if (image?.source === "upload" && typeof image.path === "string") {
        paths.push(image.path);
      }
    }
  }
  return paths;
}

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

  // First pass: resolve which conversations exist and confirm ownership for
  // ALL of them before deleting anything. A single not-owner id rejects the
  // whole batch, so we never half-delete.
  const refs: DocumentReference[] = [];
  for (const id of ids) {
    const ref = db.collection("conversations").doc(id);
    const snap = await ref.get();
    if (!snap.exists) continue;

    // Ownership guard. A caller may only delete their own conversations.
    if (snap.data()?.uid !== uid) {
      throw new HttpsError("permission-denied", "not-owner");
    }

    refs.push(ref);
  }

  if (refs.length === 0) return 0;

  // Delete any uploaded image objects from Cloud Storage before tearing down the
  // message docs that reference them. Best-effort (never throws) so a Storage
  // hiccup can't block the Firestore deletion the user asked for.
  const uploadPaths = (
    await Promise.all(refs.map((ref) => collectUploadPaths(ref)))
  ).flat();
  if (uploadPaths.length > 0) {
    await deleteUploadObjects(uploadPaths);
  }

  // Second pass: tear every conversation (doc + messages subcollection) down
  // through ONE shared BulkWriter so Firestore drains them all in a single
  // batched sweep, rather than a serial recursiveDelete round-trip each.
  const writer = db.bulkWriter();
  await Promise.all(refs.map((ref) => db.recursiveDelete(ref, writer)));
  await writer.close();

  return refs.length;
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
