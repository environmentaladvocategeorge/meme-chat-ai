import { Timestamp } from "firebase-admin/firestore";
import { PLANS } from "../billing/plans";
import {
  DAILY_WINDOW_MS,
  MONTHLY_WINDOW_MS,
  type ProfileBilling,
} from "./schema";

export type ResetDecision = {
  monthlyReset: boolean;
  dailyReset: boolean;
  next: ProfileBilling;
};

// Pure: given the current billing state + current time, returns the state
// after any expired monthly/daily windows have rolled forward. Caller
// (loadEntitlement) wraps this in a Firestore transaction and persists `next`
// only if a reset actually fired.
//
// Monthly reset: refills creditsRemaining to plan.monthlyCredits, zeros
// advancedCreditsUsed, advances creditsResetAt by exactly one window. Does
// NOT carry over leftover credits — monthly budget is use-it-or-lose-it.
//
// Daily reset: zeros dailyCreditsUsed, advances dailyResetAt. The daily
// counter is purely a soft cap; doesn't refill anything.
export function computeResets(state: ProfileBilling, nowMs: number): ResetDecision {
  let next = state;
  let monthlyReset = false;
  let dailyReset = false;

  if (state.creditsResetAt.toMillis() <= nowMs) {
    monthlyReset = true;
    const planCfg = PLANS[state.plan];
    // Advance the reset anchor in window-sized hops so a long-dormant user
    // doesn't get N months of credits stacked.
    let resetMs = state.creditsResetAt.toMillis();
    while (resetMs <= nowMs) resetMs += MONTHLY_WINDOW_MS;
    next = {
      ...next,
      creditsRemaining: planCfg.monthlyCredits,
      advancedCreditsUsed: 0,
      creditsResetAt: Timestamp.fromMillis(resetMs),
    };
  }

  if (state.dailyResetAt.toMillis() <= nowMs) {
    dailyReset = true;
    let resetMs = state.dailyResetAt.toMillis();
    while (resetMs <= nowMs) resetMs += DAILY_WINDOW_MS;
    next = {
      ...next,
      dailyCreditsUsed: 0,
      dailyResetAt: Timestamp.fromMillis(resetMs),
    };
  }

  return { monthlyReset, dailyReset, next };
}
