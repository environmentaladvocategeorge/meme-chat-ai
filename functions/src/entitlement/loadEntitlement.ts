import { getFirestore } from "firebase-admin/firestore";
import { PLANS, computeDailyCap } from "../billing/plans";
import { computeResets } from "./reset";
import { initialBilling, readProfileBilling, type ProfileBilling } from "./schema";

export type Entitlement = ProfileBilling & {
  softDailyCredits: number;
  monthlyCredits: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  alias: string | null;
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
      return { billing, alias: null };
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
    const alias =
      typeof data?.alias === "string" && data.alias.trim().length > 0
        ? data.alias.trim()
        : null;
    return { billing, alias };
  });

  const planCfg = PLANS[result.billing.plan];
  return {
    ...result.billing,
    softDailyCredits: computeDailyCap(planCfg.monthlyCredits, new Date()),
    monthlyCredits: planCfg.monthlyCredits,
    maxInputTokens: planCfg.maxInputTokens,
    maxOutputTokens: planCfg.maxOutputTokens,
    alias: result.alias,
  };
}
