import {
  formatMessageTimestamp,
  shouldRenderMarkdown,
} from "@/components/chat/messageFormat";

describe("shouldRenderMarkdown", () => {
  it("returns false for plain prose", () => {
    expect(shouldRenderMarkdown("just a normal sentence, no markup")).toBe(
      false,
    );
  });

  it.each([
    ["fenced code", "```js\nconst x = 1\n```"],
    ["inline code", "use the `useTheme` hook"],
    ["bold", "this is **important**"],
    ["italics", "this is *subtle*"],
    ["heading", "# Title"],
    ["dash bullet", "- first item"],
    ["star bullet", "* first item"],
    ["ordered list", "1. first item"],
    ["blockquote", "> a quote"],
  ])("detects %s", (_label, text) => {
    expect(shouldRenderMarkdown(text)).toBe(true);
  });

  it("detects markdown on a later line, not just the first", () => {
    expect(shouldRenderMarkdown("intro line\n- a bullet later")).toBe(true);
  });

  it("does not treat a bare asterisk or hash as markdown", () => {
    expect(shouldRenderMarkdown("2 * 3 = 6")).toBe(false);
    expect(shouldRenderMarkdown("issue #42 is open")).toBe(false);
  });
});

describe("formatMessageTimestamp", () => {
  it("returns null for missing or invalid dates", () => {
    expect(formatMessageTimestamp(null)).toBeNull();
    expect(formatMessageTimestamp(undefined)).toBeNull();
    expect(formatMessageTimestamp(new Date("not-a-date"))).toBeNull();
  });

  it("shows time only for a message sent earlier today", () => {
    const now = new Date();
    const earlierToday = new Date(now.getTime() - 60 * 60 * 1000);
    const label = formatMessageTimestamp(earlierToday) ?? "";

    // Same-day path returns just a clock time — no month name in it.
    expect(label).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
    expect(label.length).toBeGreaterThan(0);
  });

  it("includes the month and day for an earlier date this year", () => {
    const now = new Date();
    // A date safely in the past but within the same calendar year.
    const monthIndex = now.getMonth() === 0 ? 11 : 0;
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const sameYearPast = new Date(year, monthIndex, 15, 15, 5);
    const label = formatMessageTimestamp(sameYearPast) ?? "";

    expect(label).toMatch(
      /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/,
    );
  });

  it("includes the year for a date in a prior year", () => {
    const label = formatMessageTimestamp(new Date(2019, 5, 1, 15, 5)) ?? "";
    expect(label).toContain("2019");
  });
});
