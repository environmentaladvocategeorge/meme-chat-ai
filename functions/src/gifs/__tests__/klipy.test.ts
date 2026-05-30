import {
  fetchTrendingGifs,
  KlipyError,
  normalizeGif,
  searchGifs,
} from "../klipy";

const SAMPLE_GIF = {
  id: 8041071659142944,
  slug: "hello-hi-662",
  title: "Hello",
  file: {
    hd: {
      gif: { url: "https://cdn/hd.gif", width: 498, height: 498 },
      webp: { url: "https://cdn/hd.webp", width: 498, height: 498 },
      jpg: { url: "https://cdn/hd.jpg", width: 498, height: 498 },
    },
    md: {
      gif: { url: "https://cdn/md.gif", width: 498, height: 498 },
      webp: { url: "https://cdn/md.webp", width: 498, height: 498 },
      jpg: { url: "https://cdn/md.jpg", width: 498, height: 498 },
    },
    sm: {
      gif: { url: "https://cdn/sm.gif", width: 220, height: 220 },
      webp: { url: "https://cdn/sm.webp", width: 220, height: 220 },
      jpg: { url: "https://cdn/sm.jpg", width: 220, height: 220 },
    },
    xs: {
      gif: { url: "https://cdn/xs.gif", width: 90, height: 90 },
      webp: { url: "https://cdn/xs.webp", width: 90, height: 90 },
      jpg: { url: "https://cdn/xs.jpg", width: 90, height: 90 },
    },
  },
  type: "gif",
  blur_preview: "data:image/jpeg;base64,AAAA",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("normalizeGif", () => {
  it("picks md webp display, sm jpg poster, sm webp frame source", () => {
    expect(normalizeGif(SAMPLE_GIF)).toEqual({
      id: "8041071659142944",
      slug: "hello-hi-662",
      title: "Hello",
      url: "https://cdn/md.webp",
      width: 498,
      height: 498,
      previewUrl: "https://cdn/sm.jpg",
      frameSourceUrl: "https://cdn/sm.webp",
      blurPreview: "data:image/jpeg;base64,AAAA",
    });
  });

  it("stringifies the id so large numbers keep precision", () => {
    expect(normalizeGif(SAMPLE_GIF)?.id).toBe("8041071659142944");
  });

  it("falls back to md gif for display when webp is absent", () => {
    const result = normalizeGif({
      ...SAMPLE_GIF,
      file: { md: { gif: { url: "https://cdn/md.gif", width: 1, height: 2 } } },
    });
    expect(result?.url).toBe("https://cdn/md.gif");
  });

  it("falls back to the display asset for frame source when no small animated asset exists", () => {
    const result = normalizeGif({
      ...SAMPLE_GIF,
      file: { md: { webp: { url: "https://cdn/md.webp", width: 1, height: 2 } } },
    });
    expect(result?.frameSourceUrl).toBe("https://cdn/md.webp");
  });

  it("returns null when there is no animated asset", () => {
    expect(normalizeGif({ id: 1, file: { md: { jpg: { url: "https://cdn/x.jpg" } } } })).toBeNull();
  });

  it("returns null when there is no id", () => {
    expect(normalizeGif({ file: SAMPLE_GIF.file })).toBeNull();
  });

  it("nulls blurPreview when absent", () => {
    const { blur_preview, ...rest } = SAMPLE_GIF;
    expect(normalizeGif(rest)?.blurPreview).toBeNull();
  });
});

describe("fetchTrendingGifs", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("hits the gifs/trending path with format_filter", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_GIF], current_page: 2, per_page: 10, has_next: true },
      }),
    );

    const result = await fetchTrendingGifs({
      apiKey: "my-app-key",
      page: 2,
      perPage: 10,
      customerId: "uid-123",
      locale: "us",
      contentFilter: "high",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/api/v1/my-app-key/gifs/trending");
    expect(calledUrl.searchParams.get("format_filter")).toBe("gif,webp,jpg");
    expect(calledUrl.searchParams.get("content_filter")).toBe("high");
    expect(result.gifs).toHaveLength(1);
    expect(result.page).toBe(2);
    expect(result.hasNext).toBe(true);
  });

  it("throws KlipyError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 403));
    await expect(
      fetchTrendingGifs({ apiKey: "k", page: 1, perPage: 24, customerId: "u" }),
    ).rejects.toThrow(KlipyError);
  });
});

describe("searchGifs", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("hits the gifs/search path and includes q", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_GIF], current_page: 1, per_page: 24, has_next: false },
      }),
    );

    await searchGifs({
      apiKey: "my-app-key",
      query: "dancing cat",
      page: 1,
      perPage: 24,
      customerId: "uid-1",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/api/v1/my-app-key/gifs/search");
    expect(calledUrl.searchParams.get("q")).toBe("dancing cat");
  });
});
