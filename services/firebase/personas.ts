import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { mapPersonaDoc, type UserPersonaSummary } from "@/domain/personas";
import { personaInputToFormValues, type PersonaFormValues } from "@/domain/personaForm";
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

  return snap.docs.flatMap((personaDoc) => {
    const summary = mapPersonaDoc(personaDoc.id, personaDoc.data());
    return summary ? [summary] : [];
  });
}

// What the editor needs to repopulate the builder for an existing persona: the
// raw `input` mapped back to form values, plus the current uploaded avatar URL
// (so the photo step shows it). A single owner `get` — firestore.rules permit
// reading your own user_personas doc. Throws when the doc is missing/not owned
// (the rule denies the read), which the editor surfaces as a load error.
export type PersonaEditData = {
  values: PersonaFormValues;
  avatarUrl: string | null;
};

export async function fetchPersonaInput(
  personaId: string,
): Promise<PersonaEditData> {
  const firebase = getFirebaseServices();
  if (!firebase.available) throw new Error("firebase-unavailable");
  const db = firebase.services.firestore;

  const snap = await getDoc(doc(db, "user_personas", personaId));
  if (!snap.exists()) throw new Error("persona-not-found");

  const data = snap.data();
  const publicConfig = data?.publicConfig;
  const avatarUrl =
    publicConfig && typeof publicConfig.avatarUrl === "string"
      ? publicConfig.avatarUrl
      : null;

  return { values: personaInputToFormValues(data?.input), avatarUrl };
}
