import type { ModelId } from "./models";
import { PLANS, type PlanId } from "./plans";

// Model selection is purely plan-based and currently uniform: every tier
// (free/basic/plus/power) runs `mini` (gpt-5.4-mini). Tiers differ by credit
// budget, not model quality — the free agent must feel like the real product
// to drive conversion. Kept plan-keyed so a tier can diverge again later
// without touching callsites.
export function chooseModel(plan: PlanId): ModelId {
  return PLANS[plan].model;
}
