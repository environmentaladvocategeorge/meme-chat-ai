import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { PLAN_RANK, PLANS, type PlanId } from "../billing/plans";
import {
  REVENUECAT_PRODUCT_TO_PLAN,
  isKnownRcProduct,
} from "../billing/revenuecat";
import {
  DAILY_WINDOW_MS,
  MONTHLY_WINDOW_MS,
  readProfileBilling,
  type ProfileBilling,
} from "../entitlement/schema";

// Best-effort optimistic plan write triggered by the RN client after RC's
// CustomerInfoUpdate fires. The webhook is the authoritative source; this
// callable just lets the UI feel snappy without waiting for the webhook to
// round-trip from RC's servers.
//
// Safety: we only write if the proposed plan is HIGHER rank than the current
// stored plan (so a stale client can never downgrade an authoritative
// webhook-set tier). The webhook reconciles any drift on its own.
export const syncRevenueCatPlan = onCall({ region: "us-central1" }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "auth-required");

  const productId = req.data?.activeProductId;
  if (productId !== null && typeof productId !== "string") {
    throw new HttpsError("invalid-argument", "invalid-product-id");
  }

  let proposedPlan: PlanId = "free";
  if (productId && isKnownRcProduct(productId)) {
    proposedPlan = REVENUECAT_PRODUCT_TO_PLAN[productId];
  }

  const db = getFirestore();
  const ref = db.doc(`profiles/${uid}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? readProfileBilling(snap.data()) : null;

    // If a webhook event already set the plan authoritatively at a tier ≥
    // proposed, do nothing. Webhook wins.
    if (
      current &&
      current.planSource === "revenuecat" &&
      PLAN_RANK[current.plan] >= PLAN_RANK[proposedPlan]
    ) {
      return;
    }

    const planCfg = PLANS[proposedPlan];
    const now = Date.now();
    const next: Partial<ProfileBilling> = {
      plan: proposedPlan,
      planSource: "revenuecat",
      rcAppUserId: uid,
      rcActiveProductId:
        productId && isKnownRcProduct(productId) ? productId : null,
      creditsRemaining: planCfg.monthlyCredits,
      creditsResetAt: Timestamp.fromMillis(now + MONTHLY_WINDOW_MS),
      advancedCreditsUsed: 0,
      dailyCreditsUsed: 0,
      dailyResetAt: Timestamp.fromMillis(now + DAILY_WINDOW_MS),
    };
    tx.set(ref, next, { merge: true });
  });

  return { plan: proposedPlan };
});
