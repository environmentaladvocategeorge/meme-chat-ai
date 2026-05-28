import { HttpsError, onCall } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { logger } from "firebase-functions";

const REAUTH_MAX_AGE_SECONDS = 5 * 60;

// Auth + Firestore live in different systems, so the deletion can't be
// truly atomic. We delete the Auth user FIRST: even if the Firestore
// cleanup fails afterwards, the user can no longer sign in, and the
// orphaned doc can only be reached for the brief window until any
// existing ID tokens expire. The reverse ordering risked leaving a usable
// Auth account pointing at no profile, a much worse failure mode.
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
    await getFirestore().doc(`profiles/${uid}`).delete();
  } catch (err) {
    // Auth deletion already succeeded — surface the orphaned doc state
    // loudly for manual cleanup, but report success to the client because
    // the user-visible "my account is gone" guarantee holds.
    logger.error("[deleteMyAccount] firestore cleanup failed; orphan profile doc", {
      uid,
      err,
    });
  }

  return { success: true };
});
