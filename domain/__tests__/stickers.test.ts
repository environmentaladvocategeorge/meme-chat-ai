import {
  MAX_MESSAGE_STICKERS,
  trendingStickerToMessageSticker,
  type TrendingSticker,
} from "../stickers";

function trending(overrides: Partial<TrendingSticker> = {}): TrendingSticker {
  return {
    id: "s1",
    slug: "rawr-dino",
    title: "rawr dino",
    url: "https://static.klipy.com/s.webp",
    width: 200,
    height: 150,
    previewUrl: "https://static.klipy.com/s.png",
    blurPreview: null,
    ...overrides,
  };
}

describe("MAX_MESSAGE_STICKERS", () => {
  it("caps a message at three stickers", () => {
    expect(MAX_MESSAGE_STICKERS).toBe(3);
  });
});

describe("trendingStickerToMessageSticker", () => {
  it("maps the asset urls + dimensions and stamps the source/attribution", () => {
    const sticker = trendingStickerToMessageSticker(trending());
    expect(sticker).toMatchObject({
      id: "s1",
      source: "klipy-sticker",
      url: "https://static.klipy.com/s.webp",
      previewUrl: "https://static.klipy.com/s.png",
      width: 200,
      height: 150,
      attribution: "Powered by Klipy",
      stickerId: "s1",
      title: "rawr dino",
    });
  });

  it("stamps the search query when picked from a search", () => {
    const sticker = trendingStickerToMessageSticker(trending(), "  dino  ");
    expect(sticker.searchQuery).toBe("dino");
  });

  it("omits the search query for a trending pick", () => {
    const sticker = trendingStickerToMessageSticker(trending());
    expect("searchQuery" in sticker).toBe(false);
  });

  it("omits a blank search query", () => {
    const sticker = trendingStickerToMessageSticker(trending(), "   ");
    expect("searchQuery" in sticker).toBe(false);
  });

  it("omits the title entirely when Klipy returned none (back-compat)", () => {
    const sticker = trendingStickerToMessageSticker(trending({ title: "" }));
    expect("title" in sticker).toBe(false);
  });
});
