import type { SamplingOverrides } from "./streamAgent";

// Replay nudges the model away from repeating its previous answer. On gpt-5.x
// reasoning models the usual levers are off the table — they reject a
// non-default `temperature` AND a non-default `top_p` (only 1.0 is accepted, so
// a 0.9 400s the turn). That leaves a fresh integer `seed`, which reshuffles the
// sampling RNG, as the one safe knob to shake the wording loose.
// Postgres-style 32-bit ceiling keeps the seed comfortably within any int range.
const SEED_MAX = 2_147_483_647;

// `rng` is injectable so tests can pin the seed deterministically; defaults to
// Math.random in production.
export function randomReplaySampling(rng: () => number = Math.random): SamplingOverrides {
  const seed = Math.floor(rng() * SEED_MAX);
  return { seed };
}
