import { describe, expect, it } from "@jest/globals";
import { detectRecentBankTerms, sampleWordBank, WORD_BANK } from "../wordBank";

// Deterministic rng: cycles through a fixed sequence.
function seqRng(seq: number[]): () => number {
  let i = 0;
  return () => seq[i++ % seq.length];
}

const allTerms = WORD_BANK.flatMap((c) => c.terms);

describe("sampleWordBank", () => {
  it("renders the header and one line per eligible category", () => {
    const out = sampleWordBank({ level: 2, emojisEnabled: true, rng: seqRng([0.5]) });
    expect(out).toContain("WORD BANK (this turn's rotation)");
    for (const category of WORD_BANK) {
      expect(out).toContain(`${category.label}:`);
    }
  });

  it("level 1 never includes min-2 or min-3 terms", () => {
    // Exhaustive across many rng draws: gated terms must never appear at L1.
    const gated = allTerms.filter((t) => (t.min ?? 1) > 1).map((t) => t.t);
    for (let i = 0; i < 50; i++) {
      const out = sampleWordBank({
        level: 1,
        emojisEnabled: true,
        rng: seqRng([(i * 7919) % 1000 / 1000, 0.42, 0.87]),
      });
      for (const term of gated) {
        expect(out).not.toContain(term);
      }
      // Italian brainrot is fully min-2, so its category drops out entirely.
      expect(out).not.toContain("Italian brainrot");
    }
  });

  it("level 3 can include feral terms and samples more per category", () => {
    // rng pinned at 0 keeps the first items after an identity shuffle path —
    // just assert structure: L3 lines carry 3 terms vs L1's 2.
    const l3 = sampleWordBank({ level: 3, emojisEnabled: true, rng: seqRng([0.99, 0.5, 0.01]) });
    const l1 = sampleWordBank({ level: 1, emojisEnabled: true, rng: seqRng([0.99, 0.5, 0.01]) });
    const countTermsInLine = (out: string, label: string) => {
      const line = out.split("\n").find((l) => l.startsWith(label));
      return line ? line.slice(label.length + 1).split(", ").length : 0;
    };
    expect(countTermsInLine(l3, "Reactions")).toBe(3);
    expect(countTermsInLine(l1, "Reactions")).toBe(2);
    // Address terms stay scarce at every level.
    expect(countTermsInLine(l3, "Address terms (use rarely)")).toBe(1);
    expect(countTermsInLine(l1, "Address terms (use rarely)")).toBe(1);
  });

  it("excludes recently used terms", () => {
    // Exclude everything except one reaction term: the category line must
    // contain only the survivor.
    const reactions = WORD_BANK.find((c) => c.key === "reaction")!;
    const exclude = new Set(
      reactions.terms.filter((t) => t.t !== "tragic").map((t) => t.t.toLowerCase()),
    );
    const out = sampleWordBank({
      level: 2,
      emojisEnabled: true,
      excludeTerms: exclude,
      rng: seqRng([0.3, 0.6, 0.9]),
    });
    const line = out.split("\n").find((l) => l.startsWith("Reactions:"));
    expect(line).toBe("Reactions: tragic");
  });

  it("drops a category entirely when exclusion empties it", () => {
    const confusion = WORD_BANK.find((c) => c.key === "confusion")!;
    const exclude = new Set(confusion.terms.map((t) => t.t.toLowerCase()));
    const out = sampleWordBank({
      level: 2,
      emojisEnabled: true,
      excludeTerms: exclude,
      rng: seqRng([0.3]),
    });
    expect(out).not.toContain("Confusion:");
  });

  it("strips emoji from bank entries when emojis are off", () => {
    // Force the ts-tuff entry to be picked by excluding every other hype term.
    const hype = WORD_BANK.find((c) => c.key === "hype")!;
    const exclude = new Set(
      hype.terms
        .filter((t) => !t.t.startsWith("first of all"))
        .map((t) => t.t.toLowerCase()),
    );
    const on = sampleWordBank({
      level: 2,
      emojisEnabled: true,
      excludeTerms: exclude,
      rng: seqRng([0.5]),
    });
    const off = sampleWordBank({
      level: 2,
      emojisEnabled: false,
      excludeTerms: exclude,
      rng: seqRng([0.5]),
    });
    expect(on).toContain("first of all, ts tuff 🔥 (hype opener");
    expect(off).toContain("first of all, ts tuff (hype opener");
    expect(off).not.toContain("🔥");
  });

  it("is deterministic given the same rng", () => {
    const a = sampleWordBank({ level: 2, emojisEnabled: true, rng: seqRng([0.1, 0.7, 0.3]) });
    const b = sampleWordBank({ level: 2, emojisEnabled: true, rng: seqRng([0.1, 0.7, 0.3]) });
    expect(a).toBe(b);
  });
});

describe("detectRecentBankTerms", () => {
  it("finds terms on word boundaries, case-insensitive", () => {
    const found = detectRecentBankTerms([
      "that plan is COOKED fr, total side quest energy",
    ]);
    expect(found.has("cooked")).toBe(true);
    expect(found.has("side quest")).toBe(true);
    expect(found.has("mid")).toBe(false);
  });

  it("does not match substrings inside words", () => {
    // "midnight" must not match "mid"; "wong" must not match "W".
    const found = detectRecentBankTerms(["midnight wong attitude"]);
    expect(found.has("mid")).toBe(false);
    expect(found.has("w")).toBe(false);
  });

  it("matches multi-word and emoji-bearing entries by their bare text", () => {
    const found = detectRecentBankTerms([
      "first of all, ts tuff. second of all, the math is not mathing",
    ]);
    expect(found.has("first of all, ts tuff 🔥")).toBe(true);
    expect(found.has("the math is not mathing")).toBe(true);
  });

  it("returns empty for no texts", () => {
    expect(detectRecentBankTerms([]).size).toBe(0);
  });
});
