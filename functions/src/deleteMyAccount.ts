import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";

const REAUTH_MAX_AGE_SECONDS = 5 * 60;

// Removes every Firestore record tied to a user. Kept separate from the
// callable so it's unit-testable and reusable.
//
//   - profiles/{uid} AND all its subcollections (reservations, …) via
//     recursiveDelete — deleting just the doc would orphan the subcollections.
//   - conversations/{cid} owned by the user + each one's messages subcollection.
//   - top-level usageEvents docs where uid == the user.
//
// Intentionally NOT deleted (not per-user identity, or retained on purpose):
//   - revenueCatEvents/* — billing/webhook audit trail, kept for accounting.
//   - usageDaily/*        — anonymized daily aggregates, no per-user fields.
//   - rateLimits/*        — keyed by IP + hour bucket, TTL-swept, no uid.
export async function deleteUserData(uid: string, db: Firestore): Promise<void> {
  // Profile doc + every subcollection under it (reservations, …).
  await db.recursiveDelete(db.doc(`profiles/${uid}`));

  // Conversations the user owns, each with its messages subcollection.
  const conversations = await db
    .collection("conversations")
    .where("uid", "==", uid)
    .get();
  for (const conversation of conversations.docs) {
    await db.recursiveDelete(conversation.ref);
  }

  // Top-level usage/cost events tied to the user.
  const usageEvents = await db
    .collection("usageEvents")
    .where("uid", "==", uid)
    .get();
  if (!usageEvents.empty) {
    const writer = db.bulkWriter();
    for (const event of usageEvents.docs) {
      void writer.delete(event.ref);
    }
    await writer.close();
  }
}

// Auth + Firestore live in different systems, so the deletion can't be
// truly atomic. We delete the Auth user FIRST: even if the Firestore
// cleanup fails afterwards, the user can no longer sign in, and any
// orphaned records can only be reached for the brief window until existing
// ID tokens expire. The reverse ordering risked leaving a usable Auth
// account pointing at no data, a much worse failure mode.
export const deleteMyAccount = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign-in required");

  const authTime = request.auth?.token.auth_time;
  if (typeof authTime !== "number") {
    throw new HttpsError("failed-precondition", "auth-time-missing");
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - authTime;
  if (ageSeconds > REAUTH_MAX_AGE_SECONDS) {
    throw new HttpsError("failed-precondition", "reauth-required");
  }

  try {
    await getAuth().deleteUser(uid);
  } catch (err) {
    logger.error("[deleteMyAccount] auth delete failed", { uid, err });
    throw new HttpsError("internal", "delete-failed");
  }

  try {
    await deleteUserData(uid, getFirestore());
  } catch (err) {
    // Auth deletion already succeeded — surface the orphaned-data state
    // loudly for manual cleanup, but report success to the client because
    // the user-visible "my account is gone" guarantee holds.
    logger.error("[deleteMyAccount] data cleanup failed; orphaned records", {
      uid,
      err,
    });
  }

  return { success: true };
});
