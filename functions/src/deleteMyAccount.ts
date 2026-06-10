import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import { createHash } from "crypto";

const REAUTH_MAX_AGE_SECONDS = 5 * 60;

function logUserKey(uid: string): string {
  return createHash("sha256").update(uid).digest("hex").slice(0, 16);
}

// Removes every Firestore record tied to a user. Kept separate from the
// callable so it's unit-testable and reusable.
//
//   - profiles/{uid} AND all its subcollections (reservations, …) via
//     recursiveDelete — deleting just the doc would orphan the subcollections.
//   - memories/{uid} AND its facts subcollection (the user's long-term memory).
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
    // User memory: the state doc + its facts subcollection.
    db.recursiveDelete(db.doc(`memories/${uid}`), writer),
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

  // Remove all of the user's uploaded chat images (catch-all by prefix — covers
  // every upload folder, including drafts not tied to a surviving conversation).
  // Storage is part of the deletion guarantee, so failures propagate to the
  // callable instead of being hidden from the client.
  await getStorage().bucket().deleteFiles({ prefix: `messageImages/${uid}/` });
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
    logger.error("[deleteMyAccount] auth delete failed", {
      userKey: logUserKey(uid),
      err,
    });
    throw new HttpsError("internal", "delete-failed");
  }

  try {
    await deleteUserData(uid, getFirestore());
  } catch (err) {
    // Auth deletion already succeeded — surface the orphaned-data state
    // loudly for manual cleanup, and report failure to the client so the user
    // is not told the deletion fully completed while orphaned records may remain.
    logger.error("[deleteMyAccount] data cleanup failed; orphaned records", {
      userKey: logUserKey(uid),
      err,
    });
    throw new HttpsError("internal", "data-delete-failed");
  }

  return { success: true };
});

