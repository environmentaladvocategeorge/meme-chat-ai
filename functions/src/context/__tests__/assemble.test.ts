import type { ChatMessage } from "../../agent/types";
import { assembleFromInputs } from "../assemble";
import { countTokens } from "../tokens";

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });
  it("counts a single short word as a few tokens", () => {
    const n = countTokens("hello");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(5);
  });
  it("scales roughly with text length", () => {
    const small = countTokens("hello world");
    const big = countTokens("hello world ".repeat(100));
    expect(big).toBeGreaterThan(small * 50);
  });
});

describe("assembleFromInputs", () => {
  function mkMessages(count: number, prefix = ""): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < count; i++) {
      out.push({
        role: i % 2 === 0 ? "user" : "agent",
        text: `${prefix}message-${i} ${"filler ".repeat(5)}`,
      });
    }
    return out;
  }

  it("always includes system + current user message", () => {
    const result = assembleFromInputs({
      summary: null,
      recent: [],
      currentText: "hi",
      maxInputTokens: 1000,
    });
    expect(result.messages[0].role).toBe("system");
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe("hi");
  });

  it("includes a second system message when a summary is present", () => {
    const result = assembleFromInputs({
      summary: "User wants help with X.",
      recent: [],
      currentText: "continue",
      maxInputTokens: 1000,
    });
    expect(result.summaryUsed).toBe(true);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].role).toBe("system");
    expect(result.messages[1].content).toContain("User wants help with X.");
  });

  it("treats empty/whitespace summary as no-summary", () => {
    const result = assembleFromInputs({
      summary: "   ",
      recent: [],
      currentText: "hi",
      maxInputTokens: 1000,
    });
    expect(result.summaryUsed).toBe(false);
    expect(result.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("drops oldest recent messages first when over the budget", () => {
    const recent = mkMessages(10);
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "current",
      maxInputTokens: 60, // very tight, forces truncation
    });
    expect(result.inputTokens).toBeLessThanOrEqual(60 + 20); // small slack for system+current
    expect(result.recentMessageCount).toBeLessThan(10);
    // current message is still present
    expect(result.messages[result.messages.length - 1].content).toBe("current");
  });

  it("never exceeds maxInputTokens for adversarially long history", () => {
    const huge = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "agent" as const,
      text: "x".repeat(2000),
    }));
    const result = assembleFromInputs({
      summary: null,
      recent: huge,
      currentText: "now what",
      maxInputTokens: 4000,
    });
    expect(result.inputTokens).toBeLessThanOrEqual(4000);
  });

  it("respects the RECENT_TARGET ceiling (caps the visible window even when more is available)", () => {
    const recent = mkMessages(25);
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "ok",
      maxInputTokens: 100_000,
    });
    // Internal RECENT_TARGET is 10 — assembler should pick at most that many
    // plus system + current = 12 entries (or +13 if summary).
    expect(result.messages.length).toBeLessThanOrEqual(12);
  });

  it("maps user → user and agent → assistant", () => {
    const recent: ChatMessage[] = [
      { role: "user", text: "ping" },
      { role: "agent", text: "pong" },
    ];
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "again",
      maxInputTokens: 10_000,
    });
    const roles = result.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
  });
});
