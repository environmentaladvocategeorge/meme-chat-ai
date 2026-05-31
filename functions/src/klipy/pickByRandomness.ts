// Weight given to the lone "straggler" hit one slot past the model's requested
// window. Small on purpose: the model asked us to wander a little, not to ignore
// relevance, so the (factor+1)th result only wins on the occasional roll.
const STRAGGLER_WEIGHT = 0.5;

// Picks an index into a Klipy result list (already ranked best-first) given the
// model-supplied randomness factor. The point is to let the model express how
// literal its query was WITHOUT us reading each result to choose — that read
// would burn tokens for nothing.
//
//   factor 1  → always the top hit (index 0). Use for exact, literal searches
//               like a specific meme name the model is deliberately invoking.
//   factor N  → a front-biased weighted pick across the first N hits, plus slim
//               odds of reaching the (N+1)th. Use for looser/vibe queries (e.g.
//               "cooked") where any of the top few would land.
//
// Weights decay linearly across the window (index 0 gets weight N, index N-1
// gets 1), so earlier — more relevant — hits stay strongly favored. `rng` is
// injectable so tests can pin the outcome.
export function pickIndexByRandomness(
  count: number,
  factor: number,
  rng: () => number = Math.random,
): number {
  if (count <= 1) return 0;

  // Clamp the window to a sane integer and never past what Klipy returned.
  const f = Math.min(Math.max(1, Math.floor(factor)), count);
  if (f <= 1) return 0;

  // Normal window: indices 0..f-1 with linearly decaying (front-biased) weights.
  const weights: number[] = [];
  for (let i = 0; i < f; i++) weights.push(f - i);

  // Straggler: the (f+1)th hit at list index f, low odds, only when it exists.
  if (f < count) weights.push(STRAGGLER_WEIGHT);

  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    // i runs 0..f; when i === f it is the straggler, whose list index is also f.
    if (r < 0) return i;
  }
  return 0;
}
