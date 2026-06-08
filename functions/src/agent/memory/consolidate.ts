import { MEMORY_MAX_FACTS, type MemoryFact, type MemoryOp } from "./types";

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

  let facts = [...byId.values()].filter((f) => f.text.trim().length > 0);

  if (facts.length > MEMORY_MAX_FACTS) {
    facts = facts
      .slice()
      .sort((a, b) => b.salience - a.salience || b.updatedAt - a.updatedAt)
      .slice(0, MEMORY_MAX_FACTS);
  }

  return facts;
}
