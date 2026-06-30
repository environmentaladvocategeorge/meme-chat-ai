import { GET_GIF_TOOL, runGetGif } from "../getGifTool";

const KLIPY = "https://static.klipy.com/ii/abc/20/90";

// A Klipy GIF whose normalized assets sit on the allowlisted host, so the
// shared messageGifSchema accepts it.
const SAMPLE_GIF = {
  id: 8041071659142944,
  slug: "happy-dance",
  title: "Happy Dance",
  file: {
    md: {
      webp: { url: `${KLIPY}/md.webp`, width: 498, height: 498 },
      gif: { url: `${KLIPY}/md.gif`, width: 498, height: 498 },
      jpg: { url: `${KLIPY}/md.jpg`, width: 498, height: 498 },
    },
    sm: {
      webp: { url: `${KLIPY}/sm.webp`, width: 220, height: 220 },
      jpg: { url: `${KLIPY}/sm.jpg`, width: 220, height: 220 },
    },
  },
  type: "gif",
};

// Distinct, all-valid gifs so a randomness pick lands on a deterministic id.
function sampleGif(id: number) {
  return { ...SAMPLE_GIF, id };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const deps = { apiKey: "app-key", customerId: "uid-1" };

describe("GET_GIF_TOOL definition", () => {
  it("declares a get_gif function with a required query parameter", () => {
    expect(GET_GIF_TOOL.function.name).toBe("get_gif");
    const params = GET_GIF_TOOL.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties).toHaveProperty("query");
    expect(params.properties).toHaveProperty("randomness_factor");
    expect(params.required).toContain("query");
    // randomness_factor is optional — it defaults to an exact (top-hit) pick.
    expect(params.required).not.toContain("randomness_factor");
  });
});

describe("runGetGif", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("returns the top Klipy GIF as a message attachment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_GIF], current_page: 1, per_page: 8, has_next: true },
      }),
    );

    const result = await runGetGif(JSON.stringify({ query: "happy dance" }), deps);

    expect(result.gif).toMatchObject({
      id: "8041071659142944",
      source: "klipy-gif",
      url: `${KLIPY}/md.webp`,
      previewUrl: `${KLIPY}/sm.jpg`,
      frameSourceUrl: `${KLIPY}/sm.webp`,
      attribution: "Powered by Klipy",
    });
    // Must NOT leak the GIF's title/URL back to the model.
    expect(JSON.parse(result.content)).toEqual({ found: true });
  });

  it("defaults to the top hit (randomness_factor omitted = exact)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: {
          data: [sampleGif(10), sampleGif(20), sampleGif(30)],
          has_next: false,
        },
      }),
    );
    // Even with a high rng roll, no factor means factor 1 → always index 0.
    const rng = jest.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const result = await runGetGif(JSON.stringify({ query: "mic drop" }), deps);
      expect(result.gif?.id).toBe("10");
    } finally {
      rng.mockRestore();
    }
  });

  it("samples a later hit when randomness_factor loosens the search", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: {
          data: [sampleGif(10), sampleGif(20), sampleGif(30), sampleGif(40)],
          has_next: false,
        },
      }),
    );
    // factor 3 over 4 hits → weights [3,2,1] + straggler 0.5 (total 6.5).
    // rng 0.8 → 5.2 lands in index 2's band → the third gif (id 30).
    const rng = jest.spyOn(Math, "random").mockReturnValue(0.8);
    try {
      const result = await runGetGif(
        JSON.stringify({ query: "cooked", randomness_factor: 3 }),
        deps,
      );
      expect(result.gif?.id).toBe("30");
    } finally {
      rng.mockRestore();
    }
  });

  it("never re-sends an excluded id (the user's own GIF), picking the next hit", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: {
          data: [sampleGif(10), sampleGif(20), sampleGif(30)],
          has_next: false,
        },
      }),
    );
    // factor 1 would normally lock to index 0 (id 10) — but 10 is excluded
    // (the user just sent it), so the pool collapses to [20, 30] and the top
    // hit becomes 20. The exact same asset is never re-sent.
    const result = await runGetGif(JSON.stringify({ query: "happy dance" }), {
      ...deps,
      excludeIds: new Set(["10"]),
    });
    expect(result.gif?.id).toBe("20");
  });

  it("returns no gif when every hit is excluded (text-only beats an echo)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [sampleGif(10), sampleGif(20)], has_next: false },
      }),
    );
    const result = await runGetGif(JSON.stringify({ query: "happy dance" }), {
      ...deps,
      excludeIds: new Set(["10", "20"]),
    });
    expect(result.gif).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({ found: false });
  });

  it("uses the injected look-&-pick selector when provided", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: {
          data: [sampleGif(10), sampleGif(20), sampleGif(30)],
          has_next: false,
        },
      }),
    );
    const selectIndex = jest.fn(async (titles: string[]) => ({
      index: 2, // pick the third hit regardless of randomness
      usage: {
        model: "gpt-5.4-nano" as const,
        inputTokens: 50,
        cachedInputTokens: 0,
        outputTokens: 3,
        reasoningTokens: 0,
      },
    }));
    const result = await runGetGif(
      JSON.stringify({ query: "happy dance", randomness_factor: 5 }),
      { ...deps, selectIndex },
    );
    expect(selectIndex).toHaveBeenCalledWith(["Happy Dance", "Happy Dance", "Happy Dance"]);
    expect(result.gif?.id).toBe("30");
    expect(result.selectUsage?.inputTokens).toBe(50);
  });

  it("clamps an out-of-range selector index to the top hit", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [sampleGif(10), sampleGif(20)], has_next: false },
      }),
    );
    const selectIndex = jest.fn(async () => ({
      index: 99,
      usage: {
        model: "gpt-5.4-nano" as const,
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
      },
    }));
    const result = await runGetGif(JSON.stringify({ query: "x", randomness_factor: 5 }), {
      ...deps,
      selectIndex,
    });
    expect(result.gif?.id).toBe("10");
  });

  it("hits the gifs/search endpoint with the model's query", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ result: true, data: { data: [SAMPLE_GIF], has_next: false } }),
    );

    await runGetGif(JSON.stringify({ query: "mic drop" }), deps);

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/api/v1/app-key/gifs/search");
    expect(calledUrl.searchParams.get("q")).toBe("mic drop");
    expect(calledUrl.searchParams.get("content_filter")).toBe("medium");
  });

  it("reports not-found when Klipy returns no gifs", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ result: true, data: { data: [], has_next: false } }),
    );

    const result = await runGetGif(JSON.stringify({ query: "x" }), deps);
    expect(result.gif).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({ found: false });
  });

  it("never throws on a Klipy outage — degrades to not-found", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 503));

    const result = await runGetGif(JSON.stringify({ query: "x" }), deps);
    expect(result.gif).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({ found: false, reason: "unavailable" });
  });

  it("rejects malformed tool arguments without calling Klipy", async () => {
    const result = await runGetGif("not json", deps);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toEqual({
      found: false,
      reason: "invalid_query",
    });
  });

  it("drops a GIF whose asset is not on the allowlisted host", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: {
          data: [
            {
              id: 1,
              file: { md: { webp: { url: "https://evil.example.com/a.webp" } } },
            },
          ],
          has_next: false,
        },
      }),
    );

    const result = await runGetGif(JSON.stringify({ query: "x" }), deps);
    expect(result.gif).toBeUndefined();
  });
});
