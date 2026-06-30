import { countMessagesTokens, countTokens, IMAGE_TOKENS_LOW } from "../tokens";

describe("countTokens", () => {
  it("returns 0 for empty text", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts more tokens for longer text", () => {
    const short = countTokens("hi");
    const long = countTokens("hi there friend, how are you doing today?");
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("is deterministic across calls", () => {
    expect(countTokens("brainrot maxxing")).toBe(countTokens("brainrot maxxing"));
  });
});

describe("countMessagesTokens", () => {
  it("is just the reply overhead for an empty conversation", () => {
    expect(countMessagesTokens([])).toBe(3);
  });

  it("adds per-message + role overhead for each message", () => {
    const empty = countMessagesTokens([]);
    const one = countMessagesTokens([{ role: "user", content: "" }]);
    // reply(3) + message(3) + countTokens("user") + 0 content
    expect(one).toBe(empty + 3 + countTokens("user"));
  });

  it("counts each low-detail image as IMAGE_TOKENS_LOW", () => {
    const textOnly = countMessagesTokens([{ role: "user", content: [] }]);
    const withImage = countMessagesTokens([
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "https://x", detail: "low" } }],
      },
    ]);
    expect(withImage - textOnly).toBe(IMAGE_TOKENS_LOW);
  });

  it("sums text + image parts in mixed content", () => {
    const total = countMessagesTokens([
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          { type: "image_url", image_url: { url: "https://x", detail: "low" } },
        ],
      },
    ]);
    expect(total).toBe(
      3 + 3 + countTokens("user") + countTokens("look at this") + IMAGE_TOKENS_LOW,
    );
  });
});
