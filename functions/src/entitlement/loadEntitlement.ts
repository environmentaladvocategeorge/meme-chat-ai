import { getFirestore } from "firebase-admin/firestore";
import { PLANS, computeDailyCap } from "../billing/plans";
import { computeResets } from "./reset";
import { initialBilling, readProfileBilling, type ProfileBilling } from "./schema";

export type Entitlement = ProfileBilling & {
  softDailyCredits: number;
  monthlyCredits: number;
  maxInputTokens: number;
  maxOutputTokens: number;
};

// Reads profiles/{uid}, applies any expired monthly/daily window resets in a
// single transaction, and returns the live billing state plus the plan's
// caps/limits for routing. Backfills legacy profiles (created before billing
// fields existed) with free-tier defaults on the same write.
export async function loadEntitlement(uid: string): Promise<Entitlement> {
  const db = getFirestore();
  const ref = db.doc(`profiles/${uid}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = new Date();

    let billing: ProfileBilling;
    let needsWrite = false;

    if (!snap.exists) {
      // Defensive — onUserCreated should have seeded this. Fall through to
      // creating a profile here so chat doesn't break for users created
      // before that trigger landed.
      billing = initialBilling(now);
      tx.set(ref, billing, { merge: true });
      return billing;
    }

    const data = snap.data();
    const existing = readProfileBilling(data);
    if (!existing) {
      // Legacy profile: has identity fields but no billing fields yet.
      billing = initialBilling(now);
      needsWrite = true;
    } else {
      billing = existing;
      // Docs written before the caps were denormalized lack these fields.
      // readProfileBilling backfills them in-memory; persist that backfill so
      // the client mirror (which reads the raw doc) shows the correct caps
      // instead of falling back to free-tier numbers.
      if (
        typeof data?.monthlyCredits !== "number" ||
        typeof data?.softDailyCredits !== "number"
      ) {
        needsWrite = true;
      }
    }

    const { monthlyReset, dailyReset, next } = computeResets(billing, now.getTime());
    if (monthlyReset || dailyReset) {
      billing = next;
      needsWrite = true;
    }

    if (needsWrite) {
      tx.set(ref, billing, { merge: true });
    }
    return billing;
  });

  const planCfg = PLANS[result.plan];
  return {
    ...result,
    // Resolve the caps live off the plan so routing always sees the current
    // tier's allowance, regardless of what's denormalized on the doc.
    softDailyCredits: computeDailyCap(planCfg.monthlyCredits, new Date()),
    monthlyCredits: planCfg.monthlyCredits,
    maxInputTokens: planCfg.maxInputTokens,
    maxOutputTokens: planCfg.maxOutputTokens,
  };
}
