import type { ModelId } from "./models";
import { PLANS, type PlanId } from "./plans";

// Model selection is purely plan-based and currently uniform: every tier
// (free/basic/plus/power) runs `gpt-5.4-mini`. Tiers differ by credit budget,
// not model quality — the free agent must feel like the real product to drive
// conversion. Kept plan-keyed so a tier can diverge again later without
// touching callsites.
export function chooseModel(plan: PlanId): ModelId {
  return PLANS[plan].model;
}

// The reply model for a single turn. Defaults to the plan's standard model, but
// when the user has Big Brain on for this turn we upgrade the REPLY to the full
// gpt-5.4 model. This is available on every tier (no plan gate): the pricier
// model simply costs more credits, so the user's own budget self-regulates it —
// that's the "uses your limit faster" trade. Only the reply upgrades; the media
// decider, routers, and memory extraction stay on their cheap models.
export function chooseReplyModel(
  plan: PlanId,
  opts?: { bigBrain?: boolean },
): ModelId {
  if (opts?.bigBrain) return "gpt-5.4";
  return chooseModel(plan);
}
