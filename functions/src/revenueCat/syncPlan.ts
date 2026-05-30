import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { PLAN_RANK, type PlanId } from "../billing/plans";
import {
  REVENUECAT_PRODUCT_TO_PLAN,
  isKnownRcProduct,
} from "../billing/revenuecat";
import {
  planActivationFields,
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

  const known = typeof productId === "string" && isKnownRcProduct(productId);
  let proposedPlan: PlanId = "free";
  if (productId && isKnownRcProduct(productId)) {
    proposedPlan = REVENUECAT_PRODUCT_TO_PLAN[productId];
  }

  // Diagnostic: the optimistic path was silent (no logging), so a call that
  // resolved an unrecognized productId to "free" looked identical to never
  // being called. Log the raw productId, whether we recognized it, and the
  // resolved plan so we can tell those two failure modes apart in the logs.
  if (!known) {
    logger.warn("[syncRevenueCatPlan] unrecognized productId → resolving free", {
      uid,
      productId: productId ?? null,
    });
  }

  const db = getFirestore();
  const ref = db.doc(`profiles/${uid}`);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? readProfileBilling(snap.data()) : null;

    // If a webhook event already set the plan authoritatively at a tier ≥
    // proposed, do nothing. Webhook wins.
    if (
      current &&
      current.planSource === "revenuecat" &&
      PLAN_RANK[current.plan] >= PLAN_RANK[proposedPlan]
    ) {
      return { applied: false, fromPlan: current.plan } as const;
    }

    const next: Partial<ProfileBilling> = {
      plan: proposedPlan,
      planSource: "revenuecat",
      rcAppUserId: uid,
      rcActiveProductId:
        productId && isKnownRcProduct(productId) ? productId : null,
      ...planActivationFields(proposedPlan, new Date()),
    };
    tx.set(ref, next, { merge: true });
    return { applied: true, fromPlan: current?.plan ?? null } as const;
  });

  logger.info("[syncRevenueCatPlan] processed", {
    uid,
    productId: productId ?? null,
    known,
    proposedPlan,
    ...outcome,
  });

  return { plan: proposedPlan };
});
