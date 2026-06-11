import type { SamplingOverrides } from "./streamAgent";

// Replay nudges the model away from repeating its previous answer. We vary two
// safe levers (gpt-5.x reasoning models reject a non-default temperature):
//   - a fresh integer `seed`, which reshuffles the sampling RNG, and
//   - a mildly randomized `top_p` in [0.85, 1.0], which widens/narrows the
//     candidate token pool just enough to shake the wording loose.
const TOP_P_MIN = 0.85;
const TOP_P_MAX = 1.0;
// Postgres-style 32-bit ceiling keeps the seed comfortably within any int range.
const SEED_MAX = 2_147_483_647;

// `rng` is injectable so tests can pin the bounds deterministically; defaults to
// Math.random in production.
export function randomReplaySampling(rng: () => number = Math.random): SamplingOverrides {
  const topP = Number((TOP_P_MIN + rng() * (TOP_P_MAX - TOP_P_MIN)).toFixed(2));
  const seed = Math.floor(rng() * SEED_MAX);
  return { topP, seed };
}

// Dial → top_p for NORMAL turns. With temperature off the table, top_p is the
// only sampling garnish: Lightly Cooked narrows the token pool slightly toward
// its controlled register; 2 and 3 keep the default (1.0 IS the default, so
// there is no "wider than normal" — the few-shot examples in the rot blocks
// are the real intensity dial). Returning undefined omits sampling params
// entirely, keeping those requests byte-identical to before.
const LIGHTLY_COOKED_TOP_P = 0.9;

export function rotLevelSampling(level: number): SamplingOverrides | undefined {
  return Math.round(level) <= 1 ? { topP: LIGHTLY_COOKED_TOP_P } : undefined;
}
