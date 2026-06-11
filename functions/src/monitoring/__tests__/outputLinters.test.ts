import { describe, expect, it } from "@jest/globals";
import { countEmoji, lintAgentReply } from "../outputLinters";

const ctx = (rotLevel: number, emojisEnabled = true) => ({ rotLevel, emojisEnabled });

const rules = (text: string, c = ctx(2)) => lintAgentReply(text, c).map((f) => f.rule);

describe("countEmoji", () => {
  it("counts pictographic emoji, ignoring variation selectors", () => {
    expect(countEmoji("no emoji here")).toBe(0);
    expect(countEmoji("fire 🔥 skull 💀")).toBe(2);
    expect(countEmoji("✨✨✨")).toBe(3);
  });
});

describe("emoji range per rot level", () => {
  it("rot 2 flags zero emoji and flags more than four", () => {
    expect(rules("dry reply, no emoji", ctx(2))).toContain("emoji_count_out_of_range");
    expect(rules("way 😂 too 💀 many 😭 emoji 🔥 fr 🫡", ctx(2))).toContain(
      "emoji_count_out_of_range",
    );
    expect(rules("just right 💀 fr", ctx(2))).not.toContain("emoji_count_out_of_range");
  });

  it("rot 1 allows zero or one, flags two", () => {
    expect(rules("plain is fine", ctx(1))).not.toContain("emoji_count_out_of_range");
    expect(rules("one 💀", ctx(1))).not.toContain("emoji_count_out_of_range");
    expect(rules("two 💀🔥", ctx(1))).toContain("emoji_count_out_of_range");
  });

  it("rot 3 expects three to eight", () => {
    expect(rules("only 💀 two 🔥", ctx(3))).toContain("emoji_count_out_of_range");
    expect(rules("chaos 💀🔥😭✨ reigns", ctx(3))).not.toContain("emoji_count_out_of_range");
  });

  it("emojis off flags any emoji at all and skips the range rule", () => {
    expect(rules("sneaky 💀", ctx(2, false))).toContain("emoji_count_out_of_range");
    expect(rules("clean words only", ctx(2, false))).not.toContain(
      "emoji_count_out_of_range",
    );
  });
});

describe("markdown list detector", () => {
  it("flags dash, star, and numbered markers at line start", () => {
    for (const text of ["- item one", "  * item", "1. first thing", "2) second"]) {
      expect(rules(`intro 💀\n${text}`)).toContain("markdown_list");
    }
  });

  it("ignores hyphens and numbers mid-sentence", () => {
    expect(rules("that 2-step plan is mid 💀 a 5.4 rating fr")).not.toContain(
      "markdown_list",
    );
  });
});

describe("banned-tell detector", () => {
  it.each([
    "It's important to note that mortgages compound.",
    "I'd be happy to help with that!",
    "Great question! Let me explain.",
    "Let's break it down simply.",
    "Here's a comprehensive overview of the topic.",
    "There are several things to consider here.",
    "First, you preheat. Second, you bake.",
  ])("flags: %s", (text) => {
    expect(rules(`${text} 💀`)).toContain("banned_tell");
  });

  it("does not flag normal in-voice text", () => {
    expect(
      rules("nah the first option is mid 💀 the move is the second link fr"),
    ).not.toContain("banned_tell");
  });
});

describe("goblin/gremlin leak detector", () => {
  it("flags goblin/gremlin as a descriptor", () => {
    expect(rules("you're in full gremlin behavior rn 💀")).toContain(
      "goblin_gremlin_leak",
    );
    expect(rules("absolute goblin energy 💀")).toContain("goblin_gremlin_leak");
  });

  it("allows the literal mode name only", () => {
    expect(rules("you got goblin mode turned on fr 💀")).not.toContain(
      "goblin_gremlin_leak",
    );
    // Mode name present AND a stray descriptor still flags.
    expect(rules("goblin mode? you're a little goblin fr 💀")).toContain(
      "goblin_gremlin_leak",
    );
  });
});

describe("dash detector", () => {
  it("flags em dash, en dash, and double hyphen", () => {
    expect(rules("this — right here 💀")).toContain("dash");
    expect(rules("pages 3–5 💀")).toContain("dash");
    expect(rules("wait -- what 💀")).toContain("dash");
  });

  it("ignores single hyphens", () => {
    expect(rules("that low-taper fade is tuff 💀")).not.toContain("dash");
  });
});

describe("tripwire", () => {
  it("matches injected words without echoing them in the finding", () => {
    const findings = lintAgentReply("contains badword here 💀", {
      ...ctx(2),
      tripwireWords: ["badword"],
    });
    const hit = findings.find((f) => f.rule === "tripwire_word");
    expect(hit).toBeDefined();
    expect(hit?.detail).not.toContain("badword");
  });

  it("is disabled with no list", () => {
    expect(rules("contains badword here 💀")).not.toContain("tripwire_word");
  });
});

describe("clean reply", () => {
  it("returns no findings for an in-voice, in-range reply", () => {
    expect(
      lintAgentReply(
        "4th century BCE is your answer 📚 private book stashes start showing up then.\n\nAristotle ran a library out of his house, his student inherited the whole hoard 💀",
        ctx(2),
      ),
    ).toEqual([]);
  });
});
