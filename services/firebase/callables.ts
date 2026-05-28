import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "./app";

export async function deleteMyAccountCallable(): Promise<{ success: true }> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<void, { success: true }>(
    firebase.services.functions,
    "deleteMyAccount",
  );
  const result = await callable();
  return result.data;
}
