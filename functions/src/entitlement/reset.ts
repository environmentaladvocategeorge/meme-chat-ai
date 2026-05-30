import { Timestamp } from "firebase-admin/firestore";
import { PLANS, computeDailyCap } from "../billing/plans";
import { nextEasternMidnightMs } from "./dailyWindow";
import { MONTHLY_WINDOW_MS, type ProfileBilling } from "./schema";

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
// Daily reset: zeros dailyCreditsUsed, advances dailyResetAt to the next global
// Eastern midnight. The daily counter is purely a soft cap; doesn't refill
// anything. Because the anchor is a fixed wall-clock boundary (not now + 24h),
// every user's window rolls at the same instant — the reset is applied lazily
// the next time the user is seen, but always relative to the same boundary.
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
      monthlyCredits: planCfg.monthlyCredits,
      creditsRemaining: planCfg.monthlyCredits,
      creditsResetAt: Timestamp.fromMillis(resetMs),
    };
  }

  if (state.dailyResetAt.toMillis() <= nowMs) {
    dailyReset = true;
    // Jump straight to the next global boundary regardless of how long the user
    // was dormant — no per-window hop loop, the anchor is absolute.
    const resetMs = nextEasternMidnightMs(nowMs);
    next = {
      ...next,
      // Refresh the stored daily cap each day so it tracks the current month's
      // length (28–31 days) and any plan change since the last reset.
      softDailyCredits: computeDailyCap(PLANS[next.plan].monthlyCredits, new Date(nowMs)),
      dailyCreditsUsed: 0,
      dailyResetAt: Timestamp.fromMillis(resetMs),
    };
  }

  return { monthlyReset, dailyReset, next };
}
