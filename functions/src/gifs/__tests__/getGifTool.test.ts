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
    expect(params.required).toContain("query");
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
