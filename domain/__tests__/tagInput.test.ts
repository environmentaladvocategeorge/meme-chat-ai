import { addTag, normalizeTag, removeTag, toggleTag } from "../tagInput";

describe("normalizeTag", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normalizeTag("  hello   world  ")).toBe("hello world");
    expect(normalizeTag("   ")).toBe("");
  });
});

describe("addTag", () => {
  it("appends a normalized tag", () => {
    expect(addTag([], "  deadpan ", 5)).toEqual(["deadpan"]);
  });
  it("ignores blank input", () => {
    expect(addTag(["a"], "   ", 5)).toEqual(["a"]);
  });
  it("dedupes case-insensitively", () => {
    expect(addTag(["Deadpan"], "deadpan", 5)).toEqual(["Deadpan"]);
  });
  it("refuses to exceed the cap", () => {
    expect(addTag(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });
});

describe("removeTag", () => {
  it("removes case-insensitively", () => {
    expect(removeTag(["Deadpan", "dry"], "deadpan")).toEqual(["dry"]);
  });
});

describe("toggleTag", () => {
  it("adds when absent, removes when present", () => {
    expect(toggleTag(["a"], "b", 5)).toEqual(["a", "b"]);
    expect(toggleTag(["a", "b"], "A", 5)).toEqual(["b"]);
  });
  it("respects the cap when adding", () => {
    expect(toggleTag(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  });
});
