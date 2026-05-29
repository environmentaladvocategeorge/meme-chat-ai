import {
  FieldValue,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
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

export class QuotaExceededError extends Error {
  readonly code = "quota_exceeded";
  constructor(
    readonly reason: QuotaReason,
    readonly resetAt: Date | null,
  ) {
    super(`quota_exceeded:${reason}`);
    this.name = "QuotaExceededError";
  }
}

export type ReservationDoc = {
  model: ModelId;
  reservedCredits: number;
  state: "open" | "settled" | "released";
  createdAt: Timestamp;
  settledAt?: Timestamp;
};

export type ReservationResult = {
  reservationId: string;
  reservedCredits: number;
};

export type SettlementInput = {
  conversationId: string;
  messageId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  credits: number; // actual credits charged, recomputed by caller from real usage
};

// ---------- pure decision helpers (unit-testable) ----------

export type ReserveEvalInput = {
  state: ProfileBilling;
  plan: PlanId;
  reservedCredits: number;
};

export type ReserveEvalResult =
  | { ok: true; next: ProfileBilling }
  | { ok: false; reason: QuotaReason; resetAt: Date | null };

// Returns the post-reserve billing state OR a rejection reason. No I/O, no
// transaction — caller composes with computeResets and Firestore writes.
export function evaluateReserve(input: ReserveEvalInput): ReserveEvalResult {
  const { state, plan, reservedCredits } = input;
  const planCfg = PLANS[plan];

  if (state.dailyCreditsUsed + reservedCredits > planCfg.softDailyCredits) {
    return {
      ok: false,
      reason: "daily",
      resetAt: state.dailyResetAt.toDate(),
    };
  }
  if (state.creditsRemaining < reservedCredits) {
    return {
      ok: false,
      reason: "monthly",
      resetAt: state.creditsResetAt.toDate(),
    };
  }

  const next: ProfileBilling = {
    ...state,
    creditsRemaining: state.creditsRemaining - reservedCredits,
    dailyCreditsUsed: state.dailyCreditsUsed + reservedCredits,
  };
  return { ok: true, next };
}

export type SettleEvalInput = {
  state: ProfileBilling;
  reservation: ReservationDoc;
  actualCredits: number;
};

// Computes the post-settlement billing state, given an open reservation and
// the actual credits used. delta = reserved - actual.
//   delta > 0 → refund: creditsRemaining += delta, dailyCreditsUsed -= delta.
//   delta < 0 → top-up: opposite direction. Caller is allowed to overshoot
//                       slightly (we paid OpenAI either way) so we don't
//                       reject — just charge the user.
export function evaluateSettle(input: SettleEvalInput): ProfileBilling {
  const { state, reservation, actualCredits } = input;
  const delta = reservation.reservedCredits - actualCredits;

  return {
    ...state,
    creditsRemaining: Math.max(0, state.creditsRemaining + delta),
    dailyCreditsUsed: Math.max(0, state.dailyCreditsUsed - delta),
  };
}

export function evaluateRelease(state: ProfileBilling, reservation: ReservationDoc): ProfileBilling {
  const refund = reservation.reservedCredits;
  return {
    ...state,
    creditsRemaining: state.creditsRemaining + refund,
    dailyCreditsUsed: Math.max(0, state.dailyCreditsUsed - refund),
  };
}

// ---------- transactional public API ----------

export async function reserveCredits(
  uid: string,
  plan: PlanId,
  model: ModelId,
  reservedCredits: number,
): Promise<ReservationResult> {
  if (reservedCredits <= 0) {
    throw new Error("reservedCredits must be positive");
  }

  const db = getFirestore();
  const profileRef = db.doc(`profiles/${uid}`);
  const reservationRef = profileRef.collection("reservations").doc();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(profileRef);
    const now = new Date();

    let state: ProfileBilling;
    if (!snap.exists) {
      state = initialBilling(now);
    } else {
      const existing = readProfileBilling(snap.data());
      state = existing ?? initialBilling(now);
    }

    const { next: resetState } = computeResets(state, now.getTime());

    const evaluation = evaluateReserve({
      state: resetState,
      plan,
      reservedCredits,
    });
    if (!evaluation.ok) {
      throw new QuotaExceededError(evaluation.reason, evaluation.resetAt);
    }

    const reservation: ReservationDoc = {
      model,
      reservedCredits,
      state: "open",
      createdAt: Timestamp.fromMillis(now.getTime()),
    };

    tx.set(profileRef, evaluation.next, { merge: true });
    tx.set(reservationRef, reservation);

    return { reservationId: reservationRef.id, reservedCredits };
  });
}

export async function settleCredits(
  uid: string,
  reservationId: string,
  settlement: SettlementInput,
  plan: PlanId,
): Promise<void> {
  const db = getFirestore();
  const profileRef = db.doc(`profiles/${uid}`);
  const reservationRef = profileRef.collection("reservations").doc(reservationId);
  const usageEventRef = db.collection("usageEvents").doc();

  await db.runTransaction(async (tx) => {
    const [profileSnap, reservationSnap] = await Promise.all([
      tx.get(profileRef),
      tx.get(reservationRef),
    ]);

    if (!reservationSnap.exists) {
      throw new Error("reservation-not-found");
    }
    const reservation = reservationSnap.data() as ReservationDoc;
    if (reservation.state !== "open") {
      // Idempotent: a duplicate settle is a no-op.
      return;
    }

    const billing = readProfileBilling(profileSnap.data()) ?? initialBilling(new Date());
    const next = evaluateSettle({
      state: billing,
      reservation,
      actualCredits: settlement.credits,
    });

    tx.set(profileRef, next, { merge: true });
    tx.update(reservationRef, {
      state: "settled",
      settledAt: FieldValue.serverTimestamp(),
    });
    tx.set(usageEventRef, {
      uid,
      conversationId: settlement.conversationId,
      messageId: settlement.messageId,
      model: reservation.model,
      plan,
      inputTokens: settlement.inputTokens,
      cachedInputTokens: settlement.cachedInputTokens,
      outputTokens: settlement.outputTokens,
      reasoningTokens: settlement.reasoningTokens,
      costUsd: settlement.costUsd,
      credits: settlement.credits,
      reservedCredits: reservation.reservedCredits,
      reservationId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  // Canonical settle log. Shape matches the exec summary so a structured-
  // log dashboard can chart cost/credit aggregates without re-parsing.
  logger.info("[settleCredits] settled", {
    uid,
    plan,
    reservationId,
    inputTokens: settlement.inputTokens,
    cachedInputTokens: settlement.cachedInputTokens,
    outputTokens: settlement.outputTokens,
    reasoningTokens: settlement.reasoningTokens,
    costUsd: settlement.costUsd,
    credits: settlement.credits,
  });
}

export async function releaseReservation(uid: string, reservationId: string): Promise<void> {
  const db = getFirestore();
  const profileRef = db.doc(`profiles/${uid}`);
  const reservationRef = profileRef.collection("reservations").doc(reservationId);

  await db.runTransaction(async (tx) => {
    const [profileSnap, reservationSnap] = await Promise.all([
      tx.get(profileRef),
      tx.get(reservationRef),
    ]);

    if (!reservationSnap.exists) return;
    const reservation = reservationSnap.data() as ReservationDoc;
    if (reservation.state !== "open") return;

    const billing = readProfileBilling(profileSnap.data());
    if (!billing) return;

    const next = evaluateRelease(billing, reservation);
    tx.set(profileRef, next, { merge: true });
    tx.update(reservationRef, {
      state: "released",
      settledAt: FieldValue.serverTimestamp(),
    });
  });
}
