import { Timestamp } from "firebase-admin/firestore";
import { PLANS, computeDailyCap, type PlanId } from "../billing/plans";
import { nextEasternMidnightMs } from "./dailyWindow";

export type PlanSource = "revenuecat" | "stub";

export type RevenueCatProductIdStored = "monthly" | "monthly_2" | "monthly_3" | null;

// Billing fields on profiles/{uid}. Server-written only — the client never
// writes to profiles; firestore.rules blocks create/update/delete and only
// allows `get` on the user's own doc.
export type ProfileBilling = {
  plan: PlanId;
  planSource: PlanSource;
  rcAppUserId: string | null;
  rcActiveProductId: RevenueCatProductIdStored;
  rcEntitlementExpiresAt: Timestamp | null;
  // The plan's resolved caps, denormalized onto the profile so the client can
  // render "X of Y" by reading the doc — it never recomputes them. monthlyCredits
  // mirrors PLANS[plan].monthlyCredits; softDailyCredits is computeDailyCap()
  // for the plan and the month the value was last written in (refreshed on every
  // daily reset and whenever the plan changes — see reset.ts / handleRcEvent).
  monthlyCredits: number;
  softDailyCredits: number;
  creditsRemaining: number;
  creditsResetAt: Timestamp; // monthly rolling window
  dailyCreditsUsed: number;
  // Next global daily-reset instant: 00:00 US Eastern, shared by all users (see
  // dailyWindow.ts). NOT a per-user rolling 24h window.
  dailyResetAt: Timestamp;
};

export const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
// 24h span, still used by tests to build "a daily window in the future". The
// daily reset ANCHOR is no longer this offset — it's the next Eastern midnight
// (nextEasternMidnightMs); this constant is just a convenient day length.
export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

// Initial billing payload for a brand-new profile (no RC entitlement).
export function initialBilling(now: Date): ProfileBilling {
  const plan: PlanId = "free";
  return {
    plan,
    planSource: "stub",
    rcAppUserId: null,
    rcActiveProductId: null,
    rcEntitlementExpiresAt: null,
    monthlyCredits: PLANS[plan].monthlyCredits,
    softDailyCredits: computeDailyCap(PLANS[plan].monthlyCredits, now),
    creditsRemaining: PLANS[plan].monthlyCredits,
    creditsResetAt: Timestamp.fromMillis(now.getTime() + MONTHLY_WINDOW_MS),
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(nextEasternMidnightMs(now.getTime())),
  };
}

// The credit/cap/window fields that every "activate this plan now" path writes
// — RC purchases (handleRcEvent), the optimistic client sync (syncRevenueCatPlan),
// and the dev plan switcher (devSetPlan). Centralizing it guarantees the three
// can't drift: a plan change ALWAYS hands the user the new tier's full monthly
// budget AND the new (higher) daily cap, with both rolling windows reset. This
// is what makes an upgrade's limit increase immediately. Callers spread the
// result into their own patch alongside plan/source/RC-identity fields.
export type PlanActivationFields = Pick<
  ProfileBilling,
  | "monthlyCredits"
  | "softDailyCredits"
  | "creditsRemaining"
  | "creditsResetAt"
  | "dailyCreditsUsed"
  | "dailyResetAt"
>;

export function planActivationFields(plan: PlanId, now: Date): PlanActivationFields {
  const monthlyCredits = PLANS[plan].monthlyCredits;
  return {
    monthlyCredits,
    softDailyCredits: computeDailyCap(monthlyCredits, now),
    creditsRemaining: monthlyCredits,
    creditsResetAt: Timestamp.fromMillis(now.getTime() + MONTHLY_WINDOW_MS),
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(nextEasternMidnightMs(now.getTime())),
  };
}

// Type guard for hydrating arbitrary Firestore data into a billing record.
// Returns null for legacy docs (no billing fields yet) so callers can backfill.
export function readProfileBilling(data: unknown): ProfileBilling | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.plan !== "string") return null;
  if (!["free", "basic", "plus", "power"].includes(d.plan as string)) return null;
  if (typeof d.creditsRemaining !== "number") return null;
  if (!(d.creditsResetAt instanceof Timestamp)) return null;
  if (!(d.dailyResetAt instanceof Timestamp)) return null;
  // Docs written before these caps were denormalized won't carry them — derive
  // from the plan so the record is always complete; the next reset/plan write
  // persists the resolved values.
  const plan = d.plan as PlanId;
  const monthlyCredits =
    typeof d.monthlyCredits === "number" ? d.monthlyCredits : PLANS[plan].monthlyCredits;
  const softDailyCredits =
    typeof d.softDailyCredits === "number"
      ? d.softDailyCredits
      : computeDailyCap(PLANS[plan].monthlyCredits, new Date());
  return {
    plan,
    planSource: (d.planSource as PlanSource) ?? "stub",
    rcAppUserId: (d.rcAppUserId as string | null) ?? null,
    rcActiveProductId: (d.rcActiveProductId as RevenueCatProductIdStored) ?? null,
    rcEntitlementExpiresAt: (d.rcEntitlementExpiresAt as Timestamp | null) ?? null,
    monthlyCredits,
    softDailyCredits,
    creditsRemaining: d.creditsRemaining as number,
    creditsResetAt: d.creditsResetAt as Timestamp,
    dailyCreditsUsed: (d.dailyCreditsUsed as number) ?? 0,
    dailyResetAt: d.dailyResetAt as Timestamp,
  };
}
