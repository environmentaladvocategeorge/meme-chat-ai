import { auth } from "firebase-functions/v1";
import { logger } from "firebase-functions";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { initialBilling } from "./entitlement/schema";

// Seeds an empty profile document the moment a Firebase Auth user is
// created. The client never writes here directly (security rules forbid it)
// so this trigger is the only path that puts a row into `profiles/{uid}`.
export const onUserCreated = auth.user().onCreate(async (user) => {
  if (user.email === undefined && !user.providerData?.length) return;

  const uid = user.uid;
  const email = user.email ?? "";
  const emailVerified = user.emailVerified ?? false;
  const providers =
    user.providerData
      ?.map((p) => p.providerId)
      .filter((id): id is string => typeof id === "string" && id.length > 0) ?? [];

  const billing = initialBilling(new Date());

  try {
    await getFirestore().doc(`profiles/${uid}`).set(
      {
        uid,
        email,
        emailVerified,
        providers,
        createdAt: FieldValue.serverTimestamp(),
        ...billing,
      },
      { merge: true },
    );
  } catch (err) {
    logger.error("[onUserCreated] bootstrap failed", { uid, err });
    throw err;
  }
});
