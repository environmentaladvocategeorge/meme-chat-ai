import { MODEL_RANK, isMiniFamily, type ModelId } from "./models";
import { PLANS, type PlanId } from "./plans";

export type Classification = "easy" | "medium" | "hard";

// v1 keyword + length heuristic. Document as v1; replace with a learned
// classifier once we have labeled traffic. Keep it cheap — runs on the
// streaming hot path.
// Matched against the lowercased request text via word-boundary regex so short
// tokens (api, code) don't false-positive inside "capital", "decode", etc.
const HARD_KEYWORDS = [
  "code",
  "implement",
  "debug",
  "explain",
  "in detail",
  "step by step",
  "compare",
  "analyze",
  "analysis",
  "design",
  "architect",
  "refactor",
  "optimize",
  "algorithm",
  "proof",
  "derive",
  "why does",
  "how does",
  "function",
  "functions",
  "script",
  "class",
  "method",
  "endpoint",
  "api",
  "write me",
  "write a",
  "make me a",
  "build me a",
];

const HARD_KEYWORD_REGEX = new RegExp(
  "\\b(?:" + HARD_KEYWORDS.map((k) => k.replace(/\s+/g, "\\s+")).join("|") + ")\\b",
  "i",
);

const EASY_GREETINGS = [
  "hi",
  "hello",
  "hey",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "cool",
  "got it",
  "nice",
  "lol",
  "👍",
];

export function classifyRequest(userText: string): Classification {
  const text = userText.trim();
  const lower = text.toLowerCase();

  if (text.includes("```") || text.length > 600) return "hard";
  if (HARD_KEYWORD_REGEX.test(lower)) return "hard";

  if (text.length < 40) {
    for (const g of EASY_GREETINGS) {
      if (lower === g || lower.startsWith(g + " ") || lower.startsWith(g + "!")) {
        return "easy";
      }
    }
    // Short question with no hard keyword — treat as easy unless it ends in "?"
    // and contains a verb that suggests substance.
    if (!lower.includes("?")) return "easy";
  }

  return "medium";
}

export type ChooseModelArgs = {
  plan: PlanId;
  classification: Classification;
  advanced: boolean;
  // How many advanced-cap credits the user has already burned this month.
  advancedCreditsUsed: number;
};

// Pure function. Never trust caller-provided fields — entitlement loader
// supplies plan + advancedCreditsUsed from authoritative profile state.
export function chooseModel(args: ChooseModelArgs): ModelId {
  const planCfg = PLANS[args.plan];

  const advancedAvailable =
    planCfg.advancedMode &&
    args.advanced &&
    args.advancedCreditsUsed < planCfg.advancedMonthlyCreditCap;

  // mini family is only reachable when advanced is on AND the user paid for it
  // AND there's headroom under the monthly advanced cap.
  const candidates = advancedAvailable
    ? planCfg.allowedModels.slice()
    : planCfg.allowedModels.filter((m) => !isMiniFamily(m));

  if (candidates.length === 0) {
    // Defensive — every plan must allow at least nano. Falling through to
    // nano keeps the request answerable rather than 500'ing.
    return "nano";
  }

  const sorted = candidates.slice().sort((a, b) => MODEL_RANK[a] - MODEL_RANK[b]);

  if (args.classification === "easy") {
    return sorted[0];
  }
  if (args.classification === "hard") {
    return sorted[sorted.length - 1];
  }
  // medium → plan default if reachable, else cheapest candidate.
  return candidates.includes(planCfg.defaultModel) ? planCfg.defaultModel : sorted[0];
}
