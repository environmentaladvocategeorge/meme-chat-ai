import { countTokens } from "../../../context/tokens";
import {
  compileMemoryBlock,
  MEDIA_MEMORY_HEADER,
  MEDIA_MEMORY_MAX_TOKENS,
  MEDIA_MEMORY_VIEW,
  MEMORY_BLOCK_HEADER,
  REPLY_MEMORY_VIEW,
  renderMemoryView,
} from "../compile";
import { consolidateFacts } from "../consolidate";
import { memoryEnabledForUser, planHasMemory } from "../gating";
import { factToLite, parseLiteFact } from "../repository";
import { MemoryService } from "../MemoryService";
import {
  MEMORY_MAX_FACTS,
  MEMORY_MAX_TOKENS,
  type MemoryFact,
  type MemoryOp,
} from "../types";

function fact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: overrides.id ?? "f1",
    text: overrides.text ?? "Works night shifts as an ER nurse",
    category: overrides.category ?? "identity",
    salience: overrides.salience ?? 2,
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: overrides.updatedAt ?? 1000,
    sourceConversationId: overrides.sourceConversationId ?? null,
  };
}

describe("planHasMemory", () => {
  it("excludes free, includes every paid tier", () => {
    expect(planHasMemory("free")).toBe(false);
    expect(planHasMemory("basic")).toBe(true);
    expect(planHasMemory("plus")).toBe(true);
    expect(planHasMemory("power")).toBe(true);
  });
});

describe("compileMemoryBlock", () => {
  it("returns an empty block when there are no facts", () => {
    expect(compileMemoryBlock([])).toEqual({ block: "", includedIds: [], tokens: 0 });
  });

  it("renders facts under the header and reports token count", () => {
    const { block, includedIds, tokens } = compileMemoryBlock([
      fact({ id: "a", text: "Has a cat named Biscuit" }),
    ]);
    expect(block).toContain(MEMORY_BLOCK_HEADER);
    expect(block).toContain("- Has a cat named Biscuit");
    expect(includedIds).toEqual(["a"]);
    expect(tokens).toBe(countTokens(block));
  });

  it("NEVER exceeds the 500-token cap, dropping lowest-ranked facts", () => {
    // 200 long facts would blow far past 500 tokens if all included.
    const many: MemoryFact[] = Array.from({ length: 200 }, (_, i) =>
      fact({
        id: `f${i}`,
        salience: 2,
        updatedAt: 1000 + i,
        text: `Fact number ${i} about the user that is reasonably wordy and detailed`,
      }),
    );
    const { block, tokens, includedIds } = compileMemoryBlock(many);
    expect(tokens).toBeLessThanOrEqual(MEMORY_MAX_TOKENS);
    expect(countTokens(block)).toBeLessThanOrEqual(MEMORY_MAX_TOKENS);
    expect(includedIds.length).toBeGreaterThan(0);
    expect(includedIds.length).toBeLessThan(many.length); // some were dropped
  });

  it("includes higher-salience facts first", () => {
    const facts = [
      fact({ id: "low", salience: 1, text: "low priority detail" }),
      fact({ id: "high", salience: 5, text: "core identity detail" }),
    ];
    const { includedIds } = compileMemoryBlock(facts);
    expect(includedIds[0]).toBe("high");
  });
});

describe("renderMemoryView", () => {
  it("the REPLY view equals the legacy compileMemoryBlock byte-for-byte", () => {
    const facts = [
      fact({ id: "a", category: "preference", text: "loves spongebob", salience: 3 }),
      fact({ id: "b", category: "relationship", text: "has a roommate Sam", salience: 2 }),
      fact({ id: "c", category: "lore", text: "running joke about being cooked", salience: 4 }),
    ];
    expect(renderMemoryView(facts, REPLY_MEMORY_VIEW)).toEqual(
      compileMemoryBlock(facts),
    );
  });

  it("the MEDIA view includes only preference/lore/identity facts", () => {
    const facts = [
      fact({ id: "p", category: "preference", text: "knicks fan", salience: 3 }),
      fact({ id: "l", category: "lore", text: "always says we are cooked", salience: 3 }),
      fact({ id: "i", category: "identity", text: "from NYC", salience: 3 }),
      fact({ id: "r", category: "relationship", text: "dating Alex", salience: 3 }),
      fact({ id: "o", category: "ongoing", text: "studying for the bar", salience: 3 }),
    ];
    const { block, includedIds } = renderMemoryView(facts, MEDIA_MEMORY_VIEW);
    expect([...includedIds].sort()).toEqual(["i", "l", "p"]);
    expect(block).toContain(MEDIA_MEMORY_HEADER);
    expect(block).toContain("knicks fan");
    expect(block).not.toContain("dating Alex");
    expect(block).not.toContain("studying for the bar");
  });

  it("the MEDIA view is empty when the user has no taste-bearing facts", () => {
    const facts = [
      fact({ id: "r", category: "relationship", text: "dating Alex" }),
      fact({ id: "o", category: "ongoing", text: "studying for the bar" }),
    ];
    expect(renderMemoryView(facts, MEDIA_MEMORY_VIEW).block).toBe("");
  });

  it("the MEDIA view never exceeds its tighter token cap", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      fact({
        id: `p${i}`,
        category: "preference",
        salience: 2,
        updatedAt: 1000 + i,
        text: `prefers thing number ${i} in a fairly wordy descriptive way`,
      }),
    );
    const { tokens, includedIds } = renderMemoryView(many, MEDIA_MEMORY_VIEW);
    expect(tokens).toBeLessThanOrEqual(MEDIA_MEMORY_MAX_TOKENS);
    expect(includedIds.length).toBeGreaterThan(0);
    expect(includedIds.length).toBeLessThan(many.length);
  });
});

describe("consolidateFacts", () => {
  const deps = { now: 5000, newId: () => "new-id" };

  it("ADD inserts a new fact with stamped timestamps", () => {
    const ops: MemoryOp[] = [
      { operation: "ADD", text: "Loves spicy food", category: "preference", salience: 3 },
    ];
    const out = consolidateFacts([], ops, deps, "conv-1");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "new-id",
      text: "Loves spicy food",
      category: "preference",
      salience: 3,
      createdAt: 5000,
      updatedAt: 5000,
      sourceConversationId: "conv-1",
    });
  });

  it("UPDATE rewrites an existing fact instead of duplicating", () => {
    const out = consolidateFacts(
      [fact({ id: "a", text: "old", salience: 2 })],
      [{ operation: "UPDATE", targetId: "a", text: "new", salience: 4 }],
      deps,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", text: "new", salience: 4, updatedAt: 5000 });
  });

  it("REMOVE drops a fact; SKIP is a no-op", () => {
    const out = consolidateFacts(
      [fact({ id: "a" }), fact({ id: "b" })],
      [{ operation: "REMOVE", targetId: "a" }, { operation: "SKIP" }],
      deps,
    );
    expect(out.map((f) => f.id)).toEqual(["b"]);
  });

  it("enforces the fact cap, evicting lowest-salience first", () => {
    const existing: MemoryFact[] = Array.from({ length: MEMORY_MAX_FACTS }, (_, i) =>
      fact({ id: `f${i}`, salience: 3 }),
    );
    // Add one more high-salience fact -> over cap by one -> a salience-1 victim drops.
    const withVictim = [...existing, fact({ id: "victim", salience: 1 })];
    const out = consolidateFacts(
      withVictim,
      [{ operation: "ADD", text: "important", category: "identity", salience: 5 }],
      deps,
    );
    expect(out).toHaveLength(MEMORY_MAX_FACTS);
    expect(out.find((f) => f.id === "victim")).toBeUndefined();
    expect(out.find((f) => f.text === "important")).toBeDefined();
  });
});

describe("denormalized facts round-trip (factToLite / parseLiteFact)", () => {
  it("survives a full round-trip with the render-relevant fields", () => {
    const f = fact({
      id: "x",
      text: "knicks fan",
      category: "preference",
      salience: 4,
      updatedAt: 4242,
    });
    const lite = factToLite(f);
    expect(lite).toEqual({
      id: "x",
      text: "knicks fan",
      category: "preference",
      salience: 4,
      updatedAt: 4242,
    });
    expect(parseLiteFact(lite)).toEqual(lite);
    // What renderMemoryView needs is preserved.
    expect(renderMemoryView([parseLiteFact(lite)!], MEDIA_MEMORY_VIEW).block).toContain(
      "knicks fan",
    );
  });

  it("drops malformed entries instead of throwing", () => {
    expect(parseLiteFact(null)).toBeNull();
    expect(parseLiteFact("nope")).toBeNull();
    expect(parseLiteFact({ id: "x", text: "t" })).toBeNull(); // missing/invalid category
    expect(parseLiteFact({ id: "", text: "t", category: "preference" })).toBeNull();
    expect(parseLiteFact({ id: "x", text: "", category: "preference" })).toBeNull();
    // Missing numeric fields default rather than fail.
    expect(parseLiteFact({ id: "x", text: "t", category: "lore" })).toEqual({
      id: "x",
      text: "t",
      category: "lore",
      salience: 1,
      updatedAt: 0,
    });
  });
});

describe("MemoryService gating", () => {
  it("returns '' for free plan and never reads the repo", async () => {
    const repo = { getState: jest.fn() } as never;
    const svc = new MemoryService({ repo });
    expect(await svc.getMemoryBlock("u1", "free")).toBe("");
    expect((repo as { getState: jest.Mock }).getState).not.toHaveBeenCalled();
  });

  it("returns the stored block for a paid plan", async () => {
    const repo = {
      getState: jest.fn(async () => ({
        enabled: true,
        block: "BLOCK",
        blockTokens: 1,
        factCount: 1,
        updatedAt: null,
      })),
    } as never;
    const svc = new MemoryService({ repo, gate: () => true });
    expect(await svc.getMemoryBlock("u1", "plus")).toBe("BLOCK");
  });

  it("renders the reply block from stored facts (not the stale block field)", async () => {
    const repo = {
      getState: jest.fn(async () => ({
        enabled: true,
        block: "STALE",
        blockTokens: 1,
        factCount: 1,
        updatedAt: null,
        facts: [
          { id: "p", text: "knicks fan", category: "preference", salience: 5, updatedAt: 1 },
        ],
      })),
    } as never;
    const svc = new MemoryService({ repo, gate: () => true });
    const block = await svc.getMemoryBlock("u1", "plus");
    expect(block).toContain("knicks fan");
    expect(block).not.toContain("STALE");
  });

  it("getMemoryViews returns empties for free plan without reading the repo", async () => {
    const repo = { getState: jest.fn() } as never;
    const svc = new MemoryService({ repo });
    expect(await svc.getMemoryViews("u1", "free")).toEqual({ reply: "", media: "" });
    expect((repo as { getState: jest.Mock }).getState).not.toHaveBeenCalled();
  });

  it("getMemoryViews renders reply (all) + media (taste only) from facts", async () => {
    const repo = {
      getState: jest.fn(async () => ({
        enabled: true,
        block: "STALE",
        blockTokens: 1,
        factCount: 2,
        updatedAt: null,
        facts: [
          { id: "p", text: "knicks fan", category: "preference", salience: 5, updatedAt: 2 },
          { id: "r", text: "dating Alex", category: "relationship", salience: 4, updatedAt: 1 },
        ],
      })),
    } as never;
    const svc = new MemoryService({ repo, gate: () => true });
    const views = await svc.getMemoryViews("u1", "plus");
    expect(views.reply).toContain("knicks fan");
    expect(views.reply).toContain("dating Alex"); // reply = every category
    expect(views.reply).not.toContain("STALE"); // rendered from facts
    expect(views.media).toContain("knicks fan");
    expect(views.media).not.toContain("dating Alex"); // media = taste only
  });

  it("getMemoryViews falls back to the stored block (reply only) when facts absent", async () => {
    const repo = {
      getState: jest.fn(async () => ({
        enabled: true,
        block: "LEGACY BLOCK",
        blockTokens: 1,
        factCount: 1,
        updatedAt: null,
        // no `facts` — a doc written before per-consumer views shipped
      })),
    } as never;
    const svc = new MemoryService({ repo, gate: () => true });
    expect(await svc.getMemoryViews("u1", "plus")).toEqual({
      reply: "LEGACY BLOCK",
      media: "",
    });
  });

  it("getMemoryViews returns empties when memory is toggled OFF", async () => {
    const repo = {
      getState: jest.fn(async () => ({
        enabled: false,
        block: "B",
        blockTokens: 1,
        factCount: 1,
        updatedAt: null,
        facts: [
          { id: "p", text: "x", category: "preference", salience: 1, updatedAt: 1 },
        ],
      })),
    } as never;
    const svc = new MemoryService({ repo, gate: () => true });
    expect(await svc.getMemoryViews("u1", "plus")).toEqual({ reply: "", media: "" });
  });

  it("returns '' for a paid plan when memory is toggled OFF", async () => {
    const repo = {
      getState: jest.fn(async () => ({
        enabled: false,
        block: "BLOCK",
        blockTokens: 1,
        factCount: 1,
        updatedAt: null,
      })),
    } as never;
    const svc = new MemoryService({ repo, gate: () => true });
    expect(await svc.getMemoryBlock("u1", "plus")).toBe("");
  });

  it("skips extraction when memory is toggled OFF (no model call)", async () => {
    const extractor = jest.fn();
    const repo = {
      getState: jest.fn(async () => ({
        enabled: false,
        block: "",
        blockTokens: 0,
        factCount: 3,
        updatedAt: null,
      })),
      listFacts: jest.fn(),
    } as never;
    const svc = new MemoryService({
      repo,
      extractor: extractor as never,
      gate: () => true,
    });
    const res = await svc.refreshFromConversation({
      uid: "u1",
      plan: "plus",
      conversationId: "c1",
      transcript: "hi",
      apiKey: "k",
    });
    expect(res.changed).toBe(false);
    expect(extractor).not.toHaveBeenCalled();
  });

  it("skips extraction entirely for free plan (no model call)", async () => {
    const extractor = jest.fn();
    const repo = { listFacts: jest.fn() } as never;
    const svc = new MemoryService({ repo, extractor: extractor as never });
    const res = await svc.refreshFromConversation({
      uid: "u1",
      plan: "free",
      conversationId: "c1",
      transcript: "hi",
      apiKey: "k",
    });
    expect(res.changed).toBe(false);
    expect(extractor).not.toHaveBeenCalled();
  });

  it("persists a recompiled block on a paid refresh that yields ops", async () => {
    const persist = jest.fn(async () => undefined);
    const repo = {
      getState: jest.fn(async () => null),
      listFacts: jest.fn(async () => [] as MemoryFact[]),
      persist,
    } as never;
    const extractor = jest.fn(async () => ({
      ops: [{ operation: "ADD", text: "Has a dog", category: "relationship", salience: 2 }],
      usage: null,
    }));
    const svc = new MemoryService({
      repo,
      extractor: extractor as never,
      gate: () => true,
      newId: () => "id-1",
      now: () => 1234,
    });
    const res = await svc.refreshFromConversation({
      uid: "u1",
      plan: "plus",
      conversationId: "c1",
      transcript: "i have a dog",
      apiKey: "k",
    });
    expect(res.changed).toBe(true);
    expect(res.factCount).toBe(1);
    expect(persist).toHaveBeenCalledTimes(1);
    const call = (persist.mock.calls[0] ?? []) as unknown[];
    const facts = call[1] as MemoryFact[];
    const compiled = call[2] as { tokens: number };
    expect(facts[0].text).toBe("Has a dog");
    expect(compiled.tokens).toBeLessThanOrEqual(MEMORY_MAX_TOKENS);
  });
});
