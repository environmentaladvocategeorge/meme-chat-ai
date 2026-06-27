import {
  buildWebSearchRouterMessages,
  buildWebSearchRouterSystemPrompt,
  parseWebSearchDecision,
} from "../decideWebSearch";
import { formatTavilyContext } from "../../web/tavilyClient";

describe("parseWebSearchDecision", () => {
  it("parses a search verdict with a cleaned query", () => {
    const d = parseWebSearchDecision(
      JSON.stringify({ search: true, query: "NBA Finals winner 2026-06" }),
    );
    expect(d).toEqual({ search: true, query: "NBA Finals winner 2026-06" });
  });

  it("trims and clamps an over-long query", () => {
    const long = "a".repeat(500);
    const d = parseWebSearchDecision(
      JSON.stringify({ search: true, query: `  ${long}  ` }),
    );
    expect(d.search).toBe(true);
    if (d.search) expect(d.query.length).toBe(200);
  });

  it("returns no-search for a false verdict", () => {
    expect(
      parseWebSearchDecision(JSON.stringify({ search: false, query: null })),
    ).toEqual({ search: false });
  });

  it("falls back to no-search when search is true but query is empty/missing", () => {
    expect(
      parseWebSearchDecision(JSON.stringify({ search: true, query: "  " })),
    ).toEqual({ search: false });
    expect(
      parseWebSearchDecision(JSON.stringify({ search: true, query: null })),
    ).toEqual({ search: false });
  });

  it("falls back to no-search on malformed or empty output", () => {
    expect(parseWebSearchDecision("")).toEqual({ search: false });
    expect(parseWebSearchDecision("not json")).toEqual({ search: false });
    expect(parseWebSearchDecision("{}")).toEqual({ search: false });
  });
});

describe("buildWebSearchRouterSystemPrompt", () => {
  it("injects today's date so the router can judge recency", () => {
    const prompt = buildWebSearchRouterSystemPrompt("2026-06-21");
    expect(prompt).toContain("2026-06-21");
    expect(prompt.toLowerCase()).toContain("search");
  });
});

describe("buildWebSearchRouterMessages", () => {
  it("emits a system + user message and includes history when present", () => {
    const msgs = buildWebSearchRouterMessages({
      todayIso: "2026-06-21",
      message: "yo who won the thing last night fr",
      history: "User: been watching the finals\nBot: who you got",
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(String(msgs[1].content)).toContain("Conversation so far:");
    expect(String(msgs[1].content)).toContain(
      "yo who won the thing last night fr",
    );
  });

  it("omits the history block when no history is supplied", () => {
    const msgs = buildWebSearchRouterMessages({
      todayIso: "2026-06-21",
      message: "what's the weather today",
    });
    expect(String(msgs[1].content)).not.toContain("Conversation so far:");
    expect(String(msgs[1].content)).toContain("what's the weather today");
  });
});

describe("formatTavilyContext", () => {
  it("formats answer + bounded sources into an injectable block", () => {
    const block = formatTavilyContext({
      answer: "Team A won the 2026 finals.",
      results: [
        { title: "Finals recap", url: "https://ex.com/a", content: "Team A beat Team B 4-2." },
        { title: "Box score", url: "https://ex.com/b", content: "Final game details." },
      ],
    });
    expect(block).toContain("Answer: Team A won the 2026 finals.");
    expect(block).toContain("Sources:");
    expect(block).toContain("Finals recap");
    expect(block).toContain("https://ex.com/a");
  });

  it("caps the number of sources at 4", () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      title: `Source ${i}`,
      url: `https://ex.com/${i}`,
      content: "snippet",
    }));
    const block = formatTavilyContext({ answer: "", results }) ?? "";
    expect(block).toContain("Source 0");
    expect(block).toContain("Source 3");
    expect(block).not.toContain("Source 4");
  });

  it("returns null when there is no answer and no results", () => {
    expect(formatTavilyContext({ answer: "", results: [] })).toBeNull();
    expect(formatTavilyContext({})).toBeNull();
  });
});
