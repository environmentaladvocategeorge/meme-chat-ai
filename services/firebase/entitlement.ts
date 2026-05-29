import {
  doc,
  onSnapshot,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { type PlanId } from "@/domain/billing";
import { getFirebaseServices } from "./app";

export type Entitlement = {
  plan: PlanId;
  planSource: "revenuecat" | "stub" | "unknown";
  creditsRemaining: number;
  monthlyCredits: number;
  creditsResetAt: Date | null;
  // Daily soft cap. Distinct from the monthly budget: a user can have most of
  // the month left yet still be blocked because they've burned through the
  // day's allowance (e.g. free tier = 20/day inside a 200/mo budget).
  dailyCreditsUsed: number;
  softDailyCredits: number;
  dailyResetAt: Date | null;
};

// Plan-derived caps the server side also keeps in PLANS (functions/src/billing/
// plans.ts). Mirrored here so the UI can show "X of Y" without a round-trip —
// keep the two in sync.
const PLAN_CAPS: Record<
  PlanId,
  { monthlyCredits: number; softDailyCredits: number }
> = {
  free: { monthlyCredits: 200, softDailyCredits: 20 },
  basic: { monthlyCredits: 1200, softDailyCredits: 120 },
  plus: { monthlyCredits: 2000, softDailyCredits: 200 },
  power: { monthlyCredits: 4000, softDailyCredits: 400 },
};

function isPlanId(value: unknown): value is PlanId {
  return value === "free" || value === "basic" || value === "plus" || value === "power";
}

function asDate(value: unknown): Date | null {
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function mapEntitlement(data: DocumentData | undefined): Entitlement {
  const plan: PlanId = isPlanId(data?.plan) ? data.plan : "free";
  const caps = PLAN_CAPS[plan];
  const dailyResetAt = asDate(data?.dailyResetAt);
  // The server only rolls the daily window forward lazily (on the next
  // loadEntitlement/reserve). If the stored window has already elapsed, the
  // mirror still shows yesterday's count — so treat it as reset for display
  // to avoid a phantom "daily limit hit".
  const dailyWindowElapsed = dailyResetAt !== null && dailyResetAt.getTime() <= Date.now();
  const rawDailyUsed =
    typeof data?.dailyCreditsUsed === "number" ? data.dailyCreditsUsed : 0;

  return {
    plan,
    planSource:
      data?.planSource === "revenuecat" || data?.planSource === "stub"
        ? data.planSource
        : "unknown",
    creditsRemaining:
      typeof data?.creditsRemaining === "number" ? data.creditsRemaining : caps.monthlyCredits,
    monthlyCredits: caps.monthlyCredits,
    creditsResetAt: asDate(data?.creditsResetAt),
    dailyCreditsUsed: dailyWindowElapsed ? 0 : rawDailyUsed,
    softDailyCredits: caps.softDailyCredits,
    dailyResetAt,
  };
}

export function subscribeToEntitlement(
  uid: string,
  cb: (entitlement: Entitlement) => void,
): Unsubscribe {
  const firebase = getFirebaseServices();
  if (!firebase.available) {
    cb(mapEntitlement(undefined));
    return () => {};
  }
  return onSnapshot(doc(firebase.services.firestore, "profiles", uid), (snap) => {
    cb(mapEntitlement(snap.data()));
  });
}
