jest.mock("firebase-functions", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { formatTavilyContext, tavilySearch } from "../tavilyClient";

describe("formatTavilyContext", () => {
  it("returns null when there is no answer and no usable results", () => {
    expect(formatTavilyContext({})).toBeNull();
    expect(formatTavilyContext({ answer: "  ", results: [] })).toBeNull();
  });

  it("includes the answer alone when there are no results", () => {
    expect(formatTavilyContext({ answer: "Paris is the capital." })).toBe(
      "Answer: Paris is the capital.",
    );
  });

  it("formats sources and caps them at MAX_SOURCES (4)", () => {
    const results = Array.from({ length: 6 }, (_, i) => ({
      title: `T${i}`,
      url: `https://x/${i}`,
      content: `snippet ${i}`,
    }));
    const out = formatTavilyContext({ answer: "A", results })!;

    expect(out).toContain("Answer: A");
    expect(out).toContain("Sources:");
    expect((out.match(/^- /gm) ?? []).length).toBe(4);
    expect(out).toContain("T0");
    expect(out).not.toContain("T4");
  });

  it("skips result entries that have neither title nor snippet", () => {
    const out = formatTavilyContext({
      results: [{ url: "https://x" }, { title: "Keep", content: "yes" }],
    })!;
    expect(out).toContain("Keep");
    expect((out.match(/^- /gm) ?? []).length).toBe(1);
  });

  it("truncates a long snippet with an ellipsis", () => {
    const long = "x".repeat(400);
    const out = formatTavilyContext({ results: [{ title: "T", content: long }] })!;
    expect(out).toContain("…");
    expect(out.length).toBeLessThan(400);
  });
});

describe("tavilySearch", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockFetchOnce(resp: unknown) {
    const fn = jest.fn(async (..._args: unknown[]) => resp);
    global.fetch = fn as never;
    return fn;
  }

  it("returns the formatted block on a 2xx with a usable body", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ answer: "hi" }) });
    expect(await tavilySearch({ apiKey: "k", query: "q" })).toEqual({
      contextText: "Answer: hi",
    });
  });

  it("sends a bearer-authed POST at the basic depth tier", async () => {
    const fn = mockFetchOnce({ ok: true, json: async () => ({ answer: "hi" }) });
    await tavilySearch({ apiKey: "secret", query: "weather today" });

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).toMatchObject({
      query: "weather today",
      search_depth: "basic",
      include_answer: true,
    });
  });

  it("returns null on a non-2xx response", async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await tavilySearch({ apiKey: "k", query: "q" })).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network");
    }) as never;
    expect(await tavilySearch({ apiKey: "k", query: "q" })).toBeNull();
  });

  it("returns null when the body parses but has nothing usable", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ results: [] }) });
    expect(await tavilySearch({ apiKey: "k", query: "q" })).toBeNull();
  });

  it("returns null when JSON parsing throws", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    });
    expect(await tavilySearch({ apiKey: "k", query: "q" })).toBeNull();
  });
});
