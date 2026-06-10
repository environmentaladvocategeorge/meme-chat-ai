import { PLAN_RANK, type PlanId } from "../../billing/plans";

// Memory is a paid feature. Every paid tier (basic/plus/power) qualifies;
// free users never do.
export function planHasMemory(plan: PlanId): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK.basic;
}

// The effective gate used by the hot path (injection), cold path (extraction),
// and the trigger. Checks plan + whether the user has the toggle enabled.
export function memoryEnabledForUser(_uid: string, plan: PlanId): boolean {
  return planHasMemory(plan);
}
