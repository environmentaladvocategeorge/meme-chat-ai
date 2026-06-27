import {
  CONTENT_FILTERS,
  MAX_MESSAGE_IMAGES,
  trendingMemeToMessageImage,
  type TrendingMeme,
} from "../memes";

function meme(overrides: Partial<TrendingMeme> = {}): TrendingMeme {
  return {
    id: "m1",
    slug: "distracted-boyfriend",
    title: "Distracted Boyfriend",
    url: "https://static.klipy.com/m.webp",
    width: 300,
    height: 200,
    previewUrl: "https://static.klipy.com/m-p.webp",
    blurPreview: null,
    ...overrides,
  };
}

describe("constants", () => {
  it("caps a turn at three images", () => {
    expect(MAX_MESSAGE_IMAGES).toBe(3);
  });
  it("exposes the four content-filter levels in order", () => {
    expect(CONTENT_FILTERS).toEqual(["off", "low", "medium", "high"]);
  });
});

describe("trendingMemeToMessageImage", () => {
  it("maps to a klipy attachment with attribution + memeId + title", () => {
    expect(trendingMemeToMessageImage(meme())).toMatchObject({
      id: "m1",
      source: "klipy",
      url: "https://static.klipy.com/m.webp",
      previewUrl: "https://static.klipy.com/m-p.webp",
      width: 300,
      height: 200,
      attribution: "Powered by Klipy",
      memeId: "m1",
      title: "Distracted Boyfriend",
    });
  });

  it("omits the title when Klipy returned none (back-compat)", () => {
    expect("title" in trendingMemeToMessageImage(meme({ title: "" }))).toBe(false);
  });
});
