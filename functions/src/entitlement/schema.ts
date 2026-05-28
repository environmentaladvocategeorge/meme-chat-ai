import { Timestamp } from "firebase-admin/firestore";
import { PLANS, type PlanId } from "../billing/plans";

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
  creditsRemaining: number;
  creditsResetAt: Timestamp; // monthly rolling window
  advancedCreditsUsed: number;
  dailyCreditsUsed: number;
  dailyResetAt: Timestamp; // 24-hour rolling window
};

export const MONTHLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
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
    creditsRemaining: PLANS[plan].monthlyCredits,
    creditsResetAt: Timestamp.fromMillis(now.getTime() + MONTHLY_WINDOW_MS),
    advancedCreditsUsed: 0,
    dailyCreditsUsed: 0,
    dailyResetAt: Timestamp.fromMillis(now.getTime() + DAILY_WINDOW_MS),
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
  return {
    plan: d.plan as PlanId,
    planSource: (d.planSource as PlanSource) ?? "stub",
    rcAppUserId: (d.rcAppUserId as string | null) ?? null,
    rcActiveProductId: (d.rcActiveProductId as RevenueCatProductIdStored) ?? null,
    rcEntitlementExpiresAt: (d.rcEntitlementExpiresAt as Timestamp | null) ?? null,
    creditsRemaining: d.creditsRemaining as number,
    creditsResetAt: d.creditsResetAt as Timestamp,
    advancedCreditsUsed: (d.advancedCreditsUsed as number) ?? 0,
    dailyCreditsUsed: (d.dailyCreditsUsed as number) ?? 0,
    dailyResetAt: d.dailyResetAt as Timestamp,
  };
}
