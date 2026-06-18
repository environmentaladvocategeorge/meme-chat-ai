import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { type ModelId } from "./models";
import { PLANS, computeDailyCap, type PlanId } from "./plans";
import { computeResets } from "../entitlement/reset";
import {
  initialBilling,
  readProfileBilling,
  type ProfileBilling,
} from "../entitlement/schema";

export type QuotaReason = "monthly" | "daily";

// Real token usage for ONE model invocation within a billable unit of work. A
// single turn can span multiple invocations (the media decider + the reply —
// both mini since 2026-06-10), so settlement carries a list of these rather
// than one model.
export type ModelUsage = {
  model: ModelId;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

// What kind of work the charge is for. "turn" is a user-facing chat turn;
// "summary"/"title"/"memory" are background utility calls we also bill (they used
// to be absorbed). "memory" is the offline fact-extraction nano call. "avatar" is
// one persona-avatar image generation (gpt-image-1-mini) — billed as a flat USD
// cost, not token usage, so its usageEvent carries an empty `usages` list and the
// cost/credits are passed in directly. Stored on the usageEvent so cost
// dashboards can split them out.
export type UsageKind =
  | "turn"
  | "summary"
  | "title"
  | "memory"
  | "avatar"
  | "persona_desc";

// What actually happened on a billable unit of work — the per-model token usage
// and the credits it cost, recomputed by the caller from each call's final usage
// chunk. costUsd/credits are the SUMMED totals across all `usages`.
export type SettlementInput = {
  conversationId: string;
  messageId: string | null;
  kind: UsageKind;
  usages: ModelUsage[];
  costUsd: number;
  credits: number;
};

// Builds a SettlementInput for a charge billed as a flat USD cost rather than
// token usage (e.g. an "avatar" image generation). These have no per-model
// token usage, so `usages` is empty and the cost/credits are passed in directly;
// this keeps that convention in one place instead of an inline `usages: []` at
// every flat-cost call site.
export function flatCostSettlement(input: {
  conversationId: string;
  kind: UsageKind;
  costUsd: number;
  credits: number;
}): SettlementInput {
  return {
    conversationId: input.conversationId,
    messageId: null,
    kind: input.kind,
    usages: [],
    costUsd: input.costUsd,
    credits: input.credits,
  };
}

// Flattens per-model usages into the usageEvents token fields: summed aggregates
// (what aggregateDailyUsage reads) PLUS per-model split fields (nanoInputTokens,
// miniCachedInputTokens, …) so a single event shows the full cost breakdown.
export function usageTokenFields(usages: ModelUsage[]): Record<string, number> {
  const out: Record<string, number> = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  for (const u of usages) {
    out.inputTokens += u.inputTokens;
    out.cachedInputTokens += u.cachedInputTokens;
    out.outputTokens += u.outputTokens;
    out.reasoningTokens += u.reasoningTokens;
    out[`${u.model}InputTokens`] = (out[`${u.model}InputTokens`] ?? 0) + u.inputTokens;
    out[`${u.model}CachedInputTokens`] =
      (out[`${u.model}CachedInputTokens`] ?? 0) + u.cachedInputTokens;
    out[`${u.model}OutputTokens`] = (out[`${u.model}OutputTokens`] ?? 0) + u.outputTokens;
    out[`${u.model}ReasoningTokens`] =
      (out[`${u.model}ReasoningTokens`] ?? 0) + u.reasoningTokens;
  }
  return out;
}

// The model to record on the event's `model` field (drives aggregateDailyUsage's
// byModel rollup). We attribute the event to whichever model did the most token
// work — the reply model on a turn, the sole model on a utility call.
export function primaryModel(usages: ModelUsage[]): ModelId {
  let best: ModelUsage | null = null;
  for (const u of usages) {
    if (!best || u.inputTokens + u.outputTokens > best.inputTokens + best.outputTokens) {
      best = u;
    }
  }
  return best?.model ?? "mini";
}

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
  now?: Date;
}): QuotaEvalResult {
  const { state, plan } = input;
  const planCfg = PLANS[plan];

  // Compute the daily cap live from the plan + current month rather than
  // trusting the stored softDailyCredits — this is the authoritative gate, so
  // it always reflects the user's current plan even mid-day after an upgrade.
  const dailyCap = computeDailyCap(planCfg.monthlyCredits, input.now ?? new Date());
  if (state.dailyCreditsUsed >= dailyCap) {
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
      kind: settlement.kind,
      model: primaryModel(settlement.usages),
      plan,
      // Summed aggregates (read by aggregateDailyUsage) + per-model split fields.
      ...usageTokenFields(settlement.usages),
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
    kind: settlement.kind,
    model: primaryModel(settlement.usages),
    ...usageTokenFields(settlement.usages),
    costUsd: settlement.costUsd,
    credits: settlement.credits,
  });
}
