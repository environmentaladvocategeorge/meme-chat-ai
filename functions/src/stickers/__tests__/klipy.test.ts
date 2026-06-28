import {
  fetchTrendingStickers,
  KlipyError,
  normalizeSticker,
  searchStickers,
} from "../klipy";

// Klipy stickers mirror the GIF payload but carry a still `png` (with alpha)
// instead of a jpg poster — that png is both the grid poster and the model input
// (no frame extraction), so there's no frameSourceUrl.
const SAMPLE_STICKER = {
  id: 7041071659142944,
  slug: "rawr-dino-1",
  title: "Rawr",
  file: {
    hd: {
      gif: { url: "https://cdn/hd.gif", width: 498, height: 498 },
      webp: { url: "https://cdn/hd.webp", width: 498, height: 498 },
      png: { url: "https://cdn/hd.png", width: 498, height: 498 },
    },
    md: {
      gif: { url: "https://cdn/md.gif", width: 498, height: 498 },
      webp: { url: "https://cdn/md.webp", width: 498, height: 498 },
      png: { url: "https://cdn/md.png", width: 498, height: 498 },
    },
    sm: {
      gif: { url: "https://cdn/sm.gif", width: 220, height: 220 },
      webp: { url: "https://cdn/sm.webp", width: 220, height: 220 },
      png: { url: "https://cdn/sm.png", width: 220, height: 220 },
    },
    xs: {
      gif: { url: "https://cdn/xs.gif", width: 90, height: 90 },
      webp: { url: "https://cdn/xs.webp", width: 90, height: 90 },
      png: { url: "https://cdn/xs.png", width: 90, height: 90 },
    },
  },
  type: "sticker",
  blur_preview: "data:image/png;base64,AAAA",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("normalizeSticker", () => {
  it("picks md webp display, sm png still (doubles as model input)", () => {
    expect(normalizeSticker(SAMPLE_STICKER)).toEqual({
      id: "7041071659142944",
      slug: "rawr-dino-1",
      title: "Rawr",
      url: "https://cdn/md.webp",
      width: 498,
      height: 498,
      previewUrl: "https://cdn/sm.png",
      blurPreview: "data:image/png;base64,AAAA",
    });
  });

  it("stringifies the id so large numbers keep precision", () => {
    expect(normalizeSticker(SAMPLE_STICKER)?.id).toBe("7041071659142944");
  });

  it("falls back to md gif for display when webp is absent", () => {
    const result = normalizeSticker({
      ...SAMPLE_STICKER,
      file: {
        md: {
          gif: { url: "https://cdn/md.gif", width: 1, height: 2 },
          png: { url: "https://cdn/md.png", width: 1, height: 2 },
        },
      },
    });
    expect(result?.url).toBe("https://cdn/md.gif");
  });

  it("falls back to the still png for display when no animated asset exists", () => {
    const result = normalizeSticker({
      ...SAMPLE_STICKER,
      file: { sm: { png: { url: "https://cdn/sm.png", width: 1, height: 2 } } },
    });
    // A static-only sticker: display falls back to the still png.
    expect(result?.url).toBe("https://cdn/sm.png");
    expect(result?.previewUrl).toBe("https://cdn/sm.png");
  });

  it("returns null when there is no still png (nothing to feed the model)", () => {
    expect(
      normalizeSticker({ id: 1, file: { md: { webp: { url: "https://cdn/x.webp" } } } }),
    ).toBeNull();
  });

  it("returns null when there is no id", () => {
    expect(normalizeSticker({ file: SAMPLE_STICKER.file })).toBeNull();
  });

  it("nulls blurPreview when absent", () => {
    const { blur_preview, ...rest } = SAMPLE_STICKER;
    void blur_preview;
    expect(normalizeSticker(rest)?.blurPreview).toBeNull();
  });
});

describe("fetchTrendingStickers", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("hits the stickers/trending path with the webp,gif,png format_filter", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_STICKER], current_page: 2, per_page: 10, has_next: true },
      }),
    );

    const result = await fetchTrendingStickers({
      apiKey: "my-app-key",
      page: 2,
      perPage: 10,
      customerId: "uid-123",
      locale: "us",
      contentFilter: "high",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/api/v1/my-app-key/stickers/trending");
    expect(calledUrl.searchParams.get("format_filter")).toBe("webp,gif,png");
    expect(calledUrl.searchParams.get("content_filter")).toBe("high");
    expect(result.stickers).toHaveLength(1);
    expect(result.page).toBe(2);
    expect(result.hasNext).toBe(true);
  });

  it("throws KlipyError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 403));
    await expect(
      fetchTrendingStickers({ apiKey: "k", page: 1, perPage: 24, customerId: "u" }),
    ).rejects.toThrow(KlipyError);
  });
});

describe("searchStickers", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("hits the stickers/search path and includes q", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: true,
        data: { data: [SAMPLE_STICKER], current_page: 1, per_page: 24, has_next: false },
      }),
    );

    await searchStickers({
      apiKey: "my-app-key",
      query: "rawr dino",
      page: 1,
      perPage: 24,
      customerId: "uid-1",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl.pathname).toBe("/api/v1/my-app-key/stickers/search");
    expect(calledUrl.searchParams.get("q")).toBe("rawr dino");
  });
});
