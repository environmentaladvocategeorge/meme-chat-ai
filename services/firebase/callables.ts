import { httpsCallable } from "firebase/functions";
import { type PlanId } from "@/domain/billing";
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

// Permanently deletes the given conversations (server-side, Admin SDK). The
// quota ledger is deliberately untouched — see deleteConversations.ts.
export async function deleteConversationsCallable(
  conversationIds: string[],
): Promise<{ success: true; deleted: number }> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<
    { conversationIds: string[] },
    { success: true; deleted: number }
  >(firebase.services.functions, "deleteConversations");
  const result = await callable({ conversationIds });
  return result.data;
}

// Best-effort optimistic plan sync after RevenueCat's CustomerInfoUpdate
// fires. Server downgrades will be applied by the RC webhook regardless of
// what we POST here — see functions/src/revenueCat/syncPlan.ts.
export async function syncRevenueCatPlanCallable(args: {
  activeProductId: string | null;
}): Promise<{ plan: PlanId }> {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    throw new Error("firebase-unavailable");
  }

  const callable = httpsCallable<
    { activeProductId: string | null },
    { plan: PlanId }
  >(firebase.services.functions, "syncRevenueCatPlan");
  const result = await callable(args);
  return result.data;
}
