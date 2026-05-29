import type { ModelId } from "./models";
import { PLANS, type PlanId } from "./plans";

// Model selection is purely plan-based: free/basic → nano, plus/power → mini.
// The old keyword/length classifier + advanced toggle were removed — revisit a
// learned classifier once we have labeled traffic.
export function chooseModel(plan: PlanId): ModelId {
  return PLANS[plan].model;
}
