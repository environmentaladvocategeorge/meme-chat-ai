import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { type ModelId } from "./models";
import { PLANS, type PlanId } from "./plans";
import { computeResets } from "../entitlement/reset";
import {
  initialBilling,
  readProfileBilling,
  type ProfileBilling,
} from "../entitlement/schema";

export type QuotaReason = "monthly" | "daily";

// What actually happened on a turn — the real token usage and the credits it
// cost, recomputed by the caller from the stream's final usage chunk.
export type SettlementInput = {
  conversationId: string;
  messageId: string | null;
  model: ModelId;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  credits: number;
};

// ---------- pure decision helpers (unit-testable) ----------

export type QuotaEvalResult =
  | { ok: true }
  | { ok: false; reason: QuotaReason; resetAt: Date | null };

// Read-only quota gate. We do NOT reserve or pre-charge any credits before a
// turn — that caused the displayed balance to dip on a worst-case estimate and
// then climb back on settlement. Instead we only refuse a turn when the user
// has already exhausted a window; the true cost is charged afterwards (see
// chargeCredits), so the balance the user sees only ever moves once.
export function evaluateQuota(input: {
  state: ProfileBilling;
  plan: PlanId;
}): QuotaEvalResult {
  const { state, plan } = input;
  const planCfg = PLANS[plan];

  if (state.dailyCreditsUsed >= planCfg.softDailyCredits) {
    return { ok: false, reason: "daily", resetAt: state.dailyResetAt.toDate() };
  }
  if (state.creditsRemaining <= 0) {
    return {
      ok: false,
      reason: "monthly",
      resetAt: state.creditsResetAt.toDate(),
    };
  }
  return { ok: true };
}

// Applies the actual credits used to the billing state. creditsRemaining
// floors at 0; dailyCreditsUsed simply accrues — a single turn may push the
// user past their soft cap (we already paid the provider), they just can't
// start another turn until the window resets.
export function evaluateCharge(
  state: ProfileBilling,
  credits: number,
): ProfileBilling {
  return {
    ...state,
    creditsRemaining: Math.max(0, state.creditsRemaining - credits),
    dailyCreditsUsed: state.dailyCreditsUsed + credits,
  };
}

// ---------- transactional public API ----------

// Charges the turn's real cost in one transaction and records a usageEvent.
// Called once, after the stream's final usage is known — there is no prior
// reservation to reconcile against.
export async function chargeCredits(
  uid: string,
  plan: PlanId,
  settlement: SettlementInput,
): Promise<void> {
  const db = getFirestore();
  const profileRef = db.doc(`profiles/${uid}`);
  const usageEventRef = db.collection("usageEvents").doc();

  await db.runTransaction(async (tx) => {
    const profileSnap = await tx.get(profileRef);
    const now = new Date();
    const billing =
      readProfileBilling(profileSnap.data()) ?? initialBilling(now);
    const { next: resetState } = computeResets(billing, now.getTime());
    const next =
      settlement.credits > 0
        ? evaluateCharge(resetState, settlement.credits)
        : resetState;

    tx.set(profileRef, next, { merge: true });
    tx.set(usageEventRef, {
      uid,
      conversationId: settlement.conversationId,
      messageId: settlement.messageId,
      model: settlement.model,
      plan,
      inputTokens: settlement.inputTokens,
      cachedInputTokens: settlement.cachedInputTokens,
      outputTokens: settlement.outputTokens,
      reasoningTokens: settlement.reasoningTokens,
      costUsd: settlement.costUsd,
      credits: settlement.credits,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // Canonical charge log. Shape matches the exec summary so a structured-log
  // dashboard can chart cost/credit aggregates without re-parsing.
  logger.info("[chargeCredits] charged", {
    uid,
    plan,
    model: settlement.model,
    inputTokens: settlement.inputTokens,
    cachedInputTokens: settlement.cachedInputTokens,
    outputTokens: settlement.outputTokens,
    reasoningTokens: settlement.reasoningTokens,
    costUsd: settlement.costUsd,
    credits: settlement.credits,
  });
}
