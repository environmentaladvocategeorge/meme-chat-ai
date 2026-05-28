import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { PLANS, type PlanId } from "../billing/plans";
import {
  DAILY_WINDOW_MS,
  MONTHLY_WINDOW_MS,
  type ProfileBilling,
} from "./schema";

const VALID_PLANS: readonly PlanId[] = ["free", "basic", "plus", "power"];

function isProductionBuild() {
  return process.env.NODE_ENV === "production";
}

function isDevSetPlanEnabled() {
  return process.env.ALLOW_DEV_SETPLAN === "true";
}

// Refuses to run in production even if ALLOW_DEV_SETPLAN is somehow set,
// belt-and-braces. Returned so unit tests can assert the throw directly.
export async function devSetPlanImpl(uid: string | undefined, plan: unknown) {
  if (isProductionBuild()) {
    throw new HttpsError("failed-precondition", "dev-only");
  }
  if (!isDevSetPlanEnabled()) {
    throw new HttpsError("failed-precondition", "dev-only");
  }
  if (!uid) {
    throw new HttpsError("unauthenticated", "auth-required");
  }
  if (typeof plan !== "string" || !VALID_PLANS.includes(plan as PlanId)) {
    throw new HttpsError("invalid-argument", "invalid-plan");
  }

  const planId = plan as PlanId;
  const planCfg = PLANS[planId];
  const now = Date.now();
  const update: Partial<ProfileBilling> = {
    plan: planId,
    planSource: "stub",
    creditsRemaining: planCfg.monthlyCredits,
    creditsResetAt: Timestamp.fromMillis(now + MONTHLY_WINDOW_MS),
    advancedCreditsUsed: 0,
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(now + DAILY_WINDOW_MS),
  };

  await getFirestore().doc(`profiles/${uid}`).set(update, { merge: true });
  return { plan: planId, creditsRemaining: planCfg.monthlyCredits };
}

export const devSetPlan = onCall({ region: "us-central1" }, async (req) => {
  return devSetPlanImpl(req.auth?.uid, req.data?.plan);
});
