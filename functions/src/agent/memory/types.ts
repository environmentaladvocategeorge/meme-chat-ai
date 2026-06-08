// Domain types for the user-memory service. Facts are stored per signed-in user
// and injected (paid-gated) into the agent's system prompt as a single compiled
// block that is HARD-CAPPED at MEMORY_MAX_TOKENS. All times here are epoch ms so
// the pure compile/consolidate logic stays Firestore-agnostic and testable; the
// repository converts to/from Firestore Timestamps at the boundary.

// Hard ceiling on the compiled memory block injected into the prompt. The compile
// step guarantees the rendered block never exceeds this (see compileMemoryBlock).
export const MEMORY_MAX_TOKENS = 500;

// Upper bound on stored facts per user. The 500-token block is the real budget;
// this just stops the facts subcollection from growing unbounded between compiles.
export const MEMORY_MAX_FACTS = 30;

export type MemoryCategory =
  | "identity" // durable who-they-are: name they go by, job, where they're from
  | "preference" // likes/dislikes, tastes, opinions they hold
  | "relationship" // people in their life (friend, ex, boss, pet) + dynamic
  | "ongoing" // current situations/goals (studying for X, training for Y)
  | "lore"; // running jokes, recurring bits, memorable Ls/Ws

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  "identity",
  "preference",
  "relationship",
  "ongoing",
  "lore",
] as const;

export function isMemoryCategory(value: unknown): value is MemoryCategory {
  return (
    typeof value === "string" &&
    (MEMORY_CATEGORIES as readonly string[]).includes(value)
  );
}

// A single durable fact the bot remembers about a user.
export type MemoryFact = {
  id: string;
  text: string;
  category: MemoryCategory;
  // Higher = more important. Drives compile ordering and eviction when over cap.
  salience: number;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  sourceConversationId?: string | null;
};

// What the extractor proposes for a conversation; applied against existing facts
// by consolidateFacts (dedup via UPDATE rather than blind ADD).
export type MemoryOp =
  | { operation: "ADD"; text: string; category: MemoryCategory; salience?: number }
  | {
      operation: "UPDATE";
      targetId: string;
      text: string;
      category?: MemoryCategory;
      salience?: number;
    }
  | { operation: "REMOVE"; targetId: string }
  | { operation: "SKIP" };

// Denormalized state read on the hot path (one doc read). `enabled` is the user's
// memory on/off switch (defaults true); `updatedAt` is when memory last changed
// (facts written), surfaced to the user as "last updated".
export type MemoryState = {
  enabled: boolean;
  block: string;
  blockTokens: number;
  factCount: number;
  updatedAt: number | null; // epoch ms, or null if never written
};
