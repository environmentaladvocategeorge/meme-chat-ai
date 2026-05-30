import {
  fetchTrendingMemes,
  KlipyError,
  normalizeMeme,
  searchMemes,
} from "../klipy";

const SAMPLE_MEME = {
  id: 4895743751814617,
  slug: "3-am-video-game-meme",
  title: "3 Am Video Game Meme",
  file: {
    hd: {
      png: { url: "https://cdn/hd.png", width: 498, height: 467, size: 90568 },
      webp: { url: "https://cdn/hd.webp", width: 498, height: 467, size: 27248 },
    },
    md: {
      png: { url: "https://cdn/md.png", width: 498, height: 467, size: 130936 },
      webp: { url: "https://cdn/md.webp", width: 498, height: 467, size: 34304 },
    },
    sm: {
      png: { url: "https://cdn/sm.png", width: 220, height: 206, size: 31971 },
      webp: { url: "https://cdn/sm.webp", width: 220, height: 206, size: 10350 },
    },
    xs: {
      png: { url: "https://cdn/xs.png", width: 97, height: 90, size: 6999 },
      webp: { url: "https://cdn/xs.webp", width: 97, height: 90, size: 2896 },
    },
  },
  type: "static-meme",
  blur_preview: "data:image/jpeg;base64,AAAA",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("normalizeMeme", () => {
  it("collapses a Klipy meme to the lean shape, preferring md webp", () => {
    const result = normalizeMeme(SAMPLE_MEME);
    expect(result).toEqual({
      id: "4895743751814617",
      slug: "3-am-video-game-meme",
      title: "3 Am Video Game Meme",
      url: "https://cdn/md.webp",
      width: 498,
      height: 467,
      previewUrl: "https://cdn/sm.webp",
      blurPreview: "data:image/jpeg;base64,AAAA",
    });
  });

  it("stringifies the id so large numbers keep precision", () => {
    expect(normalizeMeme(SAMPLE_MEME)?.id).toBe("4895743751814617");
  });

  it("falls back to hd when md is missing", () => {
    const { md, ...rest } = SAMPLE_MEME.file;
    const result = normalizeMeme({ ...SAMPLE_MEME, file: rest });
    expect(result?.url).toBe("https://cdn/hd.webp");
  });

  it("falls back to png when webp is absent", () => {
    const result = normalizeMeme({
      ...SAMPLE_MEME,
      file: { md: { png: { url: "https://cdn/md.png", width: 1, height: 2 } } },
    });
    expect(result?.url).toBe("https://cdn/md.png");
  });

  it("returns null when there is no usable asset", () => {
    expect(normalizeMeme({ id: 1, file: {} })).toBeNull();
  });

  it("returns null when there is no id", () => {
    expect(normalizeMeme({ file: SAMPLE_MEME.file })).toBeNull();
  });

  it("nulls blurPreview when absent", () => {
    const { blur_preview, ...rest } = SAMPLE_MEME;
    expect(normalizeMeme(rest)?.blurPreview).toBeNull();
  });
});

describe("fetchTrendingMemes", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("builds the correct URL with app_key in the path and query params", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_MEME], current_page: 2, per_page: 10, has_next: true },
      }),
    );

    await fetchTrendingMemes({
      apiKey: "my-app-key",
      page: 2,
      perPage: 10,
      customerId: "uid-123",
      locale: "us",
      contentFilter: "high",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/api/v1/my-app-key/static-memes/trending");
    expect(calledUrl.searchParams.get("page")).toBe("2");
    expect(calledUrl.searchParams.get("per_page")).toBe("10");
    expect(calledUrl.searchParams.get("customer_id")).toBe("uid-123");
    expect(calledUrl.searchParams.get("locale")).toBe("us");
    expect(calledUrl.searchParams.get("content_filter")).toBe("high");
  });

  it("normalizes the response and pagination metadata", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_MEME], current_page: 1, per_page: 24, has_next: false },
      }),
    );

    const result = await fetchTrendingMemes({
      apiKey: "k",
      page: 1,
      perPage: 24,
      customerId: "uid",
    });

    expect(result.memes).toHaveLength(1);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(24);
    expect(result.hasNext).toBe(false);
  });

  it("skips unusable entries instead of failing the whole page", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_MEME, { id: 9, file: {} }], has_next: false },
      }),
    );

    const result = await fetchTrendingMemes({
      apiKey: "k",
      page: 1,
      perPage: 24,
      customerId: "uid",
    });
    expect(result.memes).toHaveLength(1);
  });

  it("throws KlipyError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 403));
    await expect(
      fetchTrendingMemes({ apiKey: "k", page: 1, perPage: 24, customerId: "u" }),
    ).rejects.toThrow(KlipyError);
  });

  it("throws KlipyError when result is not true", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ result: false }));
    await expect(
      fetchTrendingMemes({ apiKey: "k", page: 1, perPage: 24, customerId: "u" }),
    ).rejects.toThrow(KlipyError);
  });

  it("throws KlipyError when the transport fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(
      fetchTrendingMemes({ apiKey: "k", page: 1, perPage: 24, customerId: "u" }),
    ).rejects.toThrow(KlipyError);
  });
});

describe("searchMemes", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("hits the /search path and includes the q query param", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_MEME], current_page: 1, per_page: 24, has_next: true },
      }),
    );

    await searchMemes({
      apiKey: "my-app-key",
      query: "dancing cat",
      page: 1,
      perPage: 24,
      customerId: "uid-1",
      locale: "us",
      contentFilter: "medium",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/api/v1/my-app-key/static-memes/search");
    expect(calledUrl.searchParams.get("q")).toBe("dancing cat");
    expect(calledUrl.searchParams.get("customer_id")).toBe("uid-1");
    expect(calledUrl.searchParams.get("content_filter")).toBe("medium");
  });

  it("normalizes search results the same way as trending", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_MEME], current_page: 2, per_page: 8, has_next: false },
      }),
    );

    const result = await searchMemes({
      apiKey: "k",
      query: "cat",
      page: 2,
      perPage: 8,
      customerId: "u",
    });

    expect(result.memes).toHaveLength(1);
    expect(result.page).toBe(2);
    expect(result.hasNext).toBe(false);
  });
});
