// Usage + reset-time helpers shared by the plan/usage page, the chat usage
// warnings, and the quota modal. Pure and framework-free so they're easy to
// unit-test; the live-ticking React wrapper lives in hooks/useResetCountdown.

import type { PlanId } from "@/domain/billing";

type TFn = (key: string, opts?: Record<string, unknown>) => string;

const HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * HOUR_MS;

// Threshold at which we start nudging the user toward an upgrade in-chat.
export const NEAR_LIMIT_RATIO = 0.9;

// ---------- reset-time formatting ----------

// Returns the human phrase for *when* an allowance resets, e.g.
//   "in 5 hours and 12 minutes"  (relative, < 6h away)
//   "in 8 minutes"
//   "on Jun 1, 3:05 PM"          (absolute, >= 6h away)
//   "soon"                       (no date / already elapsed)
// Callers wrap it in their own copy ("Refills {{when}}", "Resets {{when}}.").
export function formatResetMoment(
  resetAt: Date | null,
  now: number,
  t: TFn,
): string {
  if (!resetAt) return t("common.reset.soon");
  const diff = resetAt.getTime() - now;
  if (diff <= 0) return t("common.reset.soon");

  if (diff < SIX_HOURS_MS) {
    const totalMinutes = Math.max(1, Math.round(diff / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const minutesStr =
      minutes === 1
        ? t("common.reset.unitMinute", { count: 1 })
        : t("common.reset.unitMinutes", { count: minutes });

    if (hours > 0) {
      const hoursStr =
        hours === 1
          ? t("common.reset.unitHour", { count: 1 })
          : t("common.reset.unitHours", { count: hours });
      if (minutes === 0) return t("common.reset.inValue", { value: hoursStr });
      return t("common.reset.hoursAndMinutes", {
        hours: hoursStr,
        minutes: minutesStr,
      });
    }
    return t("common.reset.justMinutes", { minutes: minutesStr });
  }

  const date = resetAt.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return t("common.reset.on", { date });
}

// True when the reset is close enough that we render a live countdown rather
// than a static date — used to decide the re-render cadence in the hook.
export function isWithinCountdownWindow(resetAt: Date | null, now: number): boolean {
  if (!resetAt) return false;
  const diff = resetAt.getTime() - now;
  return diff > 0 && diff < SIX_HOURS_MS;
}

// ---------- usage state ----------

export type UsageInput = {
  plan: PlanId;
  creditsRemaining: number;
  monthlyCredits: number;
  dailyCreditsUsed: number;
  softDailyCredits: number;
  creditsResetAt: Date | null;
  dailyResetAt: Date | null;
};

export type UsageState = {
  monthlyRatioUsed: number; // 0..1
  dailyRatioUsed: number; // 0..1
  monthlyPercentLeft: number; // 0..100, rounded
  dailyPercentLeft: number; // 0..100, rounded
  // The binding constraint — whichever allowance has the least headroom.
  limitKind: "monthly" | "daily";
  // Percent left on the binding constraint. This is what actually gates the
  // next message, so it's what the in-chat warnings key off of.
  bindingPercentLeft: number;
  bindingResetAt: Date | null;
  nearLimit: boolean; // >= 90% of the binding allowance consumed
  atLimit: boolean; // binding allowance fully consumed — sends will be rejected
};

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// Free tier carries a *daily* soft cap (e.g. 20/day) well below the monthly
// budget (e.g. 200/mo) — which is why a user can have most of the month left
// yet hit "today's limit". This collapses both windows into a single picture
// so the UI can surface whichever one is actually binding.
export function computeUsageState(input: UsageInput): UsageState {
  const monthlyUsed = Math.max(0, input.monthlyCredits - input.creditsRemaining);
  const monthlyRatioUsed = clampRatio(
    input.monthlyCredits > 0 ? monthlyUsed / input.monthlyCredits : 0,
  );
  const dailyRatioUsed = clampRatio(
    input.softDailyCredits > 0
      ? input.dailyCreditsUsed / input.softDailyCredits
      : 0,
  );

  const dailyBinds = dailyRatioUsed >= monthlyRatioUsed;
  const bindingRatio = dailyBinds ? dailyRatioUsed : monthlyRatioUsed;

  return {
    monthlyRatioUsed,
    dailyRatioUsed,
    monthlyPercentLeft: Math.round((1 - monthlyRatioUsed) * 100),
    dailyPercentLeft: Math.round((1 - dailyRatioUsed) * 100),
    limitKind: dailyBinds ? "daily" : "monthly",
    bindingPercentLeft: Math.round((1 - bindingRatio) * 100),
    bindingResetAt: dailyBinds ? input.dailyResetAt : input.creditsResetAt,
    nearLimit: bindingRatio >= NEAR_LIMIT_RATIO,
    atLimit: bindingRatio >= 1,
  };
}
