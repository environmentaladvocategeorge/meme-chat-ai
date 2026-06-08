import { randomUUID } from "crypto";
import type { ModelUsage } from "../../billing/ledger";
import type { PlanId } from "../../billing/plans";
import { compileMemoryBlock } from "./compile";
import { consolidateFacts } from "./consolidate";
import { extractMemoryOps } from "./extract";
import { memoryEnabledForUser } from "./gating";
import { MemoryRepository } from "./repository";
import type { MemoryFact } from "./types";

export type MemoryServiceDeps = {
  repo?: MemoryRepository;
  // Injectable for tests; defaults to the live nano extractor.
  extractor?: typeof extractMemoryOps;
  // The eligibility gate (plan + canary allowlist). Injectable so tests aren't
  // coupled to the live canary config; defaults to memoryEnabledForUser.
  gate?: (uid: string, plan: PlanId) => boolean;
  newId?: () => string;
  now?: () => number;
};

export type RefreshResult = {
  // nano extraction usage so the caller can log/bill it (we absorb it today).
  usage: ModelUsage | null;
  // Whether stored memory actually changed this run.
  changed: boolean;
  factCount: number;
};

// The user-memory service: the single entry point the rest of the backend uses.
// Hot path = getMemoryBlock (one cheap read, paid-gated). Cold path =
// refreshFromConversation (offline extraction + consolidation + recompile). The
// 500-token cap is enforced in compileMemoryBlock; paid gating in planHasMemory.
export class MemoryService {
  private readonly repo: MemoryRepository;
  private readonly extractor: typeof extractMemoryOps;
  private readonly gate: (uid: string, plan: PlanId) => boolean;
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(deps: MemoryServiceDeps = {}) {
    this.repo = deps.repo ?? new MemoryRepository();
    this.extractor = deps.extractor ?? extractMemoryOps;
    this.gate = deps.gate ?? memoryEnabledForUser;
    this.newId = deps.newId ?? (() => randomUUID());
    this.now = deps.now ?? (() => Date.now());
  }

  // Hot path. Returns the precompiled memory block to inject into the system
  // prompt, or "" when the plan has no memory or the user has none yet. Never
  // throws — a memory read must not break a turn.
  async getMemoryBlock(uid: string, plan: PlanId): Promise<string> {
    if (!this.gate(uid, plan)) return "";
    try {
      const state = await this.repo.getState(uid);
      // Respect the user's on/off switch (defaults on when never set).
      if (!state || state.enabled === false) return "";
      return state.block ?? "";
    } catch {
      return "";
    }
  }

  // Whether memory is switched on for this user (defaults on). Used by the cold
  // path to skip extraction cheaply when the user turned memory off.
  async isEnabled(uid: string): Promise<boolean> {
    try {
      const state = await this.repo.getState(uid);
      return state?.enabled ?? true;
    } catch {
      return true;
    }
  }

  // Cold path. Extracts durable facts from a conversation transcript, reconciles
  // them with existing memory, and persists the recompiled block. No-op (and no
  // model call) for plans without memory.
  async refreshFromConversation(args: {
    uid: string;
    plan: PlanId;
    conversationId: string;
    transcript: string;
    apiKey: string;
  }): Promise<RefreshResult> {
    if (!this.gate(args.uid, args.plan)) {
      return { usage: null, changed: false, factCount: 0 };
    }

    // Respect the on/off switch — no extraction (and no model call) when off.
    const state = await this.repo.getState(args.uid);
    if (state && state.enabled === false) {
      return { usage: null, changed: false, factCount: state.factCount };
    }

    const existing = await this.repo.listFacts(args.uid);
    const { ops, usage } = await this.extractor({
      apiKey: args.apiKey,
      existing,
      transcript: args.transcript,
    });

    if (ops.length === 0) {
      return { usage, changed: false, factCount: existing.length };
    }

    const facts = consolidateFacts(
      existing,
      ops,
      { now: this.now(), newId: this.newId },
      args.conversationId,
    );
    const compiled = compileMemoryBlock(facts);
    await this.repo.persist(args.uid, facts, compiled);

    return { usage, changed: true, factCount: facts.length };
  }

  // User-facing read for the settings screen.
  listFacts(uid: string): Promise<MemoryFact[]> {
    return this.repo.listFacts(uid);
  }

  // Flip the on/off switch for a user.
  setEnabled(uid: string, enabled: boolean): Promise<void> {
    return this.repo.setEnabled(uid, enabled);
  }

  // Clear all memory for a user.
  clearAll(uid: string): Promise<void> {
    return this.repo.clearAll(uid);
  }

  // Delete one fact, then recompile the block from what remains.
  async deleteFact(uid: string, factId: string): Promise<void> {
    await this.repo.deleteFact(uid, factId);
    const remaining = await this.repo.listFacts(uid);
    const compiled = compileMemoryBlock(remaining);
    await this.repo.saveState(uid, compiled, remaining.length);
  }
}
