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
  const [conversations, usageEvents] = await Promise.all([
    db.collection("conversations").where("uid", "==", uid).get(),
    db.collection("usageEvents").where("uid", "==", uid).get(),
  ]);

  // One shared BulkWriter drains every per-user document — the profile tree,
  // each conversation tree, and the usage events — in a single batched sweep
  // instead of a serial recursiveDelete round-trip per conversation.
  const writer = db.bulkWriter();
  const pending: Promise<unknown>[] = [
    // Profile doc + every subcollection under it (reservations, …).
    db.recursiveDelete(db.doc(`profiles/${uid}`), writer),
  ];

  // Conversations the user owns, each with its messages subcollection.
  for (const conversation of conversations.docs) {
    pending.push(db.recursiveDelete(conversation.ref, writer));
  }

  // Top-level usage/cost events tied to the user.
  for (const event of usageEvents.docs) {
    void writer.delete(event.ref);
  }

  await Promise.all(pending);
  await writer.close();
}

// Auth + Firestore live in different systems, so the deletion can't be
// truly atomic. We delete the Auth user FIRST: even if the Firestore
// cleanup fails afterwards, the user can no longer sign in, and any
// orphaned records can only be reached for the brief window until existing
// ID tokens expire. The reverse ordering risked leaving a usable Auth
// account pointing at no data, a much worse failure mode.
export const deleteMyAccount = onCall(
  // `invoker: "public"` makes the Firebase CLI re-assert the allUsers
  // run.invoker binding on every deploy. Callables authenticate inside the
  // function (request.auth below), so the platform must allow the invoke —
  // without this, a redeploy can drop the binding and Cloud Run starts
  // rejecting every call with a 401 before this code ever runs.
  { region: "us-central1", invoker: "public" },
  async (request) => {
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

