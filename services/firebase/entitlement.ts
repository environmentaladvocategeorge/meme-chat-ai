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
  // day's allowance (e.g. free tier ≈ 13/day inside a 200/mo budget).
  dailyCreditsUsed: number;
  softDailyCredits: number;
  dailyResetAt: Date | null;
};

// The caps are computed and denormalized onto profiles/{uid} by the server
// (functions/src/billing/plans.ts is the single source of truth). The client
// only ever READS them off the doc — it deliberately keeps no plan credit table
// of its own, which is what previously drifted out of sync. The constants below
// are a last-resort fallback for the brief window before a legacy doc is
// backfilled on its next load; a real subscriber's doc always carries the
// fields. FALLBACK_BURST_FACTOR mirrors DAILY_BURST_FACTOR on the server.
const FALLBACK_MONTHLY_CREDITS = 500; // free tier
const FALLBACK_BURST_FACTOR = 3;

function fallbackDailyCap(monthlyCredits: number): number {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((monthlyCredits / daysInMonth) * FALLBACK_BURST_FACTOR);
}

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
  const monthlyCredits =
    typeof data?.monthlyCredits === "number"
      ? data.monthlyCredits
      : FALLBACK_MONTHLY_CREDITS;
  const softDailyCredits =
    typeof data?.softDailyCredits === "number"
      ? data.softDailyCredits
      : fallbackDailyCap(monthlyCredits);
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
      typeof data?.creditsRemaining === "number" ? data.creditsRemaining : monthlyCredits,
    monthlyCredits,
    creditsResetAt: asDate(data?.creditsResetAt),
    dailyCreditsUsed: dailyWindowElapsed ? 0 : rawDailyUsed,
    softDailyCredits,
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
  return onSnapshot(
    doc(firebase.services.firestore, "profiles", uid),
    (snap) => {
      cb(mapEntitlement(snap.data()));
    },
    (error) => {
      // A `permission-denied` here is expected, not a failure: it fires in the
      // brief window when the auth user/profile doc is removed (sign-out or
      // account deletion) while this listener is still attached. Swallow it so
      // it doesn't surface as an uncaught Firestore error; log anything else.
      if (error.code === "permission-denied") return;
      console.warn("[entitlement] snapshot error:", error);
    },
  );
}
