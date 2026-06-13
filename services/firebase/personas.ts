import { collection, getDocs, query, where } from "firebase/firestore";
import { mapPersonaDoc, type UserPersonaSummary } from "@/domain/personas";
import { getFirebaseServices } from "./app";

// Reads the signed-in user's saved personas from user_personas. The
// `ownerUid ==` filter is REQUIRED — firestore.rules only permits a list query
// that constrains ownerUid to the requester, so this both scopes the read and
// satisfies the security rule. The full spec/prompt never leaves the backend;
// only each doc's publicConfig (mapped to a lean summary) reaches the client.
//
// Malformed docs are dropped rather than throwing (defensive read-back, like
// conversations.mapImages) so one bad doc can't blank the whole picker.
export async function fetchUserPersonas(
  uid: string,
): Promise<UserPersonaSummary[]> {
  const firebase = getFirebaseServices();
  if (!firebase.available) throw new Error("firebase-unavailable");
  const db = firebase.services.firestore;

  const snap = await getDocs(
    query(collection(db, "user_personas"), where("ownerUid", "==", uid)),
  );

  return snap.docs.flatMap((doc) => {
    const summary = mapPersonaDoc(doc.id, doc.data());
    return summary ? [summary] : [];
  });
}
