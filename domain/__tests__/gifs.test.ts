import {
  MAX_MESSAGE_GIFS,
  trendingGifToMessageGif,
  type TrendingGif,
} from "../gifs";

function trending(overrides: Partial<TrendingGif> = {}): TrendingGif {
  return {
    id: "g1",
    slug: "rat-dancing",
    title: "rat dancing",
    url: "https://static.klipy.com/a.gif",
    width: 200,
    height: 150,
    previewUrl: "https://static.klipy.com/a.jpg",
    frameSourceUrl: "https://static.klipy.com/a-frames.webp",
    blurPreview: null,
    ...overrides,
  };
}

describe("MAX_MESSAGE_GIFS", () => {
  it("caps a message at one GIF", () => {
    expect(MAX_MESSAGE_GIFS).toBe(1);
  });
});

describe("trendingGifToMessageGif", () => {
  it("maps the asset urls + dimensions and stamps the source/attribution", () => {
    const gif = trendingGifToMessageGif(trending());
    expect(gif).toMatchObject({
      id: "g1",
      source: "klipy-gif",
      url: "https://static.klipy.com/a.gif",
      previewUrl: "https://static.klipy.com/a.jpg",
      frameSourceUrl: "https://static.klipy.com/a-frames.webp",
      width: 200,
      height: 150,
      attribution: "Powered by Klipy",
      gifId: "g1",
      title: "rat dancing",
    });
  });

  it("carries Klipy's title through when present", () => {
    expect(trendingGifToMessageGif(trending({ title: "cat vibing" })).title).toBe(
      "cat vibing",
    );
  });

  it("omits the title entirely when Klipy returned none (back-compat)", () => {
    const gif = trendingGifToMessageGif(trending({ title: "" }));
    expect("title" in gif).toBe(false);
  });
});
