import { GET_MEME_TOOL, runGetMeme } from "../getMemeTool";

const KLIPY_URL =
  "https://static.klipy.com/ii/b34001f2c30672cdcb3d906c28815404/20/90/mKF2nrrU.webp";

// A Klipy meme whose normalized assets sit on the allowlisted host, so the
// shared messageImageSchema accepts it.
const SAMPLE_MEME = {
  id: 4895743751814617,
  slug: "celebration",
  title: "Celebration Dance",
  file: {
    md: {
      webp: { url: KLIPY_URL, width: 498, height: 467 },
    },
    sm: {
      webp: { url: KLIPY_URL, width: 220, height: 206 },
    },
  },
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const deps = { apiKey: "app-key", customerId: "uid-1" };

describe("GET_MEME_TOOL definition", () => {
  it("declares a get_meme function with a required query parameter", () => {
    expect(GET_MEME_TOOL.type).toBe("function");
    expect(GET_MEME_TOOL.function.name).toBe("get_meme");
    const params = GET_MEME_TOOL.function.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(params.properties).toHaveProperty("query");
    expect(params.required).toContain("query");
  });
});

describe("runGetMeme", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("returns the top Klipy result as a message attachment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_MEME], current_page: 1, per_page: 8, has_next: true },
      }),
    );

    const result = await runGetMeme(JSON.stringify({ query: "party" }), deps);

    expect(result.meme).toMatchObject({
      id: "4895743751814617",
      source: "klipy",
      url: KLIPY_URL,
      attribution: "Powered by Klipy",
    });
    expect(JSON.parse(result.content)).toEqual({
      found: true,
      title: "Celebration Dance",
    });
  });

  it("searches the /search endpoint with the model's query", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_MEME], has_next: false },
      }),
    );

    await runGetMeme(JSON.stringify({ query: "monday tired" }), deps);

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/api/v1/app-key/static-memes/search");
    expect(calledUrl.searchParams.get("q")).toBe("monday tired");
    expect(calledUrl.searchParams.get("customer_id")).toBe("uid-1");
    // Defaults to a conservative safety level for a consumer chat app.
    expect(calledUrl.searchParams.get("content_filter")).toBe("medium");
  });

  it("reports not-found (no attachment) when Klipy returns no memes", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ result: true, data: { data: [], has_next: false } }),
    );

    const result = await runGetMeme(JSON.stringify({ query: "x" }), deps);
    expect(result.meme).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({ found: false });
  });

  it("never throws on a Klipy outage — degrades to not-found", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 503));

    const result = await runGetMeme(JSON.stringify({ query: "x" }), deps);
    expect(result.meme).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({
      found: false,
      reason: "unavailable",
    });
  });

  it("rejects malformed tool arguments without calling Klipy", async () => {
    const result = await runGetMeme("not json", deps);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toEqual({
      found: false,
      reason: "invalid_query",
    });
  });

  it("drops a result whose asset is not on the allowlisted host", async () => {
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

    const result = await runGetMeme(JSON.stringify({ query: "x" }), deps);
    expect(result.meme).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual({ found: false });
  });
});
