const mockCreate = jest.fn();

jest.mock("firebase-functions", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("openai", () => ({
  __esModule: true,
  default: class {
    chat = {
      completions: { create: (...args: unknown[]) => mockCreate(...args) },
    };
  },
}));

import { pickBestMediaIndex } from "../pickBestMedia";

function completion(content: string, usage?: Record<string, unknown>) {
  return {
    choices: [{ message: { content } }],
    usage: usage ?? {
      prompt_tokens: 10,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 4 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

describe("pickBestMediaIndex", () => {
  const base = { apiKey: "k", message: "lol that's wild" };

  it("short-circuits to the top hit without an API call for <= 1 title", async () => {
    const none = await pickBestMediaIndex({ ...base, titles: [] });
    const one = await pickBestMediaIndex({ ...base, titles: ["only"] });

    expect(none).toEqual({
      index: 0,
      usage: { model: "gpt-5.4-nano", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    });
    expect(one.index).toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("honors a valid in-range index and maps usage from the completion", async () => {
    mockCreate.mockResolvedValue(completion(JSON.stringify({ index: 2 })));

    const r = await pickBestMediaIndex({ ...base, titles: ["a", "b", "c", "d"] });

    expect(r.index).toBe(2);
    expect(r.usage).toEqual({
      model: "gpt-5.4-nano",
      inputTokens: 10,
      cachedInputTokens: 4,
      outputTokens: 2,
      reasoningTokens: 0,
    });
  });

  it.each([
    ["out of range (too high)", JSON.stringify({ index: 9 })],
    ["negative", JSON.stringify({ index: -1 })],
    ["non-integer", JSON.stringify({ index: 1.5 })],
    ["not a number", JSON.stringify({ index: "two" })],
    ["missing field", JSON.stringify({})],
    ["malformed json", "{ not json"],
  ])("clamps a bad model index (%s) to the top hit", async (_label, content) => {
    mockCreate.mockResolvedValue(completion(content));
    const r = await pickBestMediaIndex({ ...base, titles: ["a", "b", "c"] });
    expect(r.index).toBe(0);
  });

  it("never throws — a thrown SDK error falls back to the top hit with zero usage", async () => {
    mockCreate.mockRejectedValue(new Error("boom"));

    const r = await pickBestMediaIndex({ ...base, titles: ["a", "b", "c"] });

    expect(r.index).toBe(0);
    expect(r.usage).toEqual({
      model: "gpt-5.4-nano",
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    });
  });
});
