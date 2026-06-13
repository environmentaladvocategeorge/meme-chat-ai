import { MEMORY_MAX_FACTS, type MemoryFact, type MemoryOp } from "./types";

// ── Near-duplicate backstop ──────────────────────────────────────────────────
// The extractor is INSTRUCTED to UPDATE instead of re-ADDing the same theme,
// but a small model occasionally re-adds near-verbatim facts anyway (the
// repetitive-memory bug). This deterministic pass catches those: within a
// category, two facts whose content words overlap heavily are the same fact —
// keep the more recently updated one (tie: higher salience). The threshold is
// deliberately high so genuinely different tastes ("kawaii memes" vs "anime
// memes") never merge; thematic merging stays the model's job.
const NEAR_DUP_JACCARD = 0.6;

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
      // Crude singularization so "memes"/"meme" count as the same word.
      .map((w) => (w.endsWith("s") ? w.slice(0, -1) : w)),
  );
}

function isNearDuplicate(a: MemoryFact, b: MemoryFact): boolean {
  if (a.category !== b.category) return false;
  const wa = contentWords(a.text);
  const wb = contentWords(b.text);
  if (wa.size === 0 || wb.size === 0) return false;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  const union = wa.size + wb.size - intersection;
  return union > 0 && intersection / union >= NEAR_DUP_JACCARD;
}

// Keeps the first (higher-ranked) of every near-duplicate pair. Input must be
// ranked best-first; output preserves that order.
function dropNearDuplicates(ranked: MemoryFact[]): MemoryFact[] {
  const kept: MemoryFact[] = [];
  for (const fact of ranked) {
    if (!kept.some((k) => isNearDuplicate(k, fact))) kept.push(fact);
  }
  return kept;
}

export type ConsolidateDeps = {
  now: number; // epoch ms stamped onto created/updated facts
  newId: () => string; // id generator for ADD ops
};

// Pure consolidation: applies the extractor's ops onto the existing fact set,
// then enforces MEMORY_MAX_FACTS. ADD inserts new facts; UPDATE rewrites an
// existing one (the dedup path — the extractor is shown current facts so it
// prefers UPDATE over duplicate ADD); REMOVE drops one; SKIP is a no-op. When
// over the fact cap, the lowest-salience / oldest facts are evicted. Deterministic
// given `deps`, so it can be unit-tested without Firestore or a clock.
export function consolidateFacts(
  existing: MemoryFact[],
  ops: MemoryOp[],
  deps: ConsolidateDeps,
  sourceConversationId?: string | null,
): MemoryFact[] {
  const byId = new Map<string, MemoryFact>(
    existing.map((f) => [f.id, { ...f }]),
  );

  for (const op of ops) {
    switch (op.operation) {
      case "ADD": {
        const id = deps.newId();
        byId.set(id, {
          id,
          text: op.text.trim(),
          category: op.category,
          salience: op.salience ?? 1,
          createdAt: deps.now,
          updatedAt: deps.now,
          sourceConversationId: sourceConversationId ?? null,
        });
        break;
      }
      case "UPDATE": {
        const cur = byId.get(op.targetId);
        if (cur) {
          cur.text = op.text.trim();
          if (op.category) cur.category = op.category;
          if (typeof op.salience === "number") cur.salience = op.salience;
          cur.updatedAt = deps.now;
        }
        break;
      }
      case "REMOVE":
        byId.delete(op.targetId);
        break;
      case "SKIP":
        break;
    }
  }

  const facts = [...byId.values()].filter((f) => f.text.trim().length > 0);

  // Rank best-first (newest wins within a salience tier so a fresh re-ADD
  // supersedes its stale near-duplicate), drop near-duplicates, then cap.
  return dropNearDuplicates(
    facts
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt || b.salience - a.salience),
  )
    .sort((a, b) => b.salience - a.salience || b.updatedAt - a.updatedAt)
    .slice(0, MEMORY_MAX_FACTS);
}
