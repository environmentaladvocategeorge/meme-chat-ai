import {
  MAX_MESSAGE_GIFS,
  trendingGifToMessageGif,
  type TrendingGif,
} from "@/domain/gifs";
import {
  MAX_MESSAGE_IMAGES,
  trendingMemeToMessageImage,
  type TrendingMeme,
} from "@/domain/memes";

const meme: TrendingMeme = {
  id: "meme-1",
  slug: "distracted-boyfriend",
  title: "Distracted Boyfriend",
  url: "https://cdn.example/full.webp",
  width: 600,
  height: 400,
  previewUrl: "https://cdn.example/preview.webp",
  blurPreview: "data:image/png;base64,abc",
};

const gif: TrendingGif = {
  id: "gif-1",
  slug: "happy-dance",
  title: "Happy Dance",
  url: "https://cdn.example/full.gif",
  width: 480,
  height: 480,
  previewUrl: "https://cdn.example/poster.webp",
  frameSourceUrl: "https://cdn.example/frames.webp",
  blurPreview: null,
};

describe("trendingMemeToMessageImage", () => {
  it("maps a trending meme to a stage-able klipy image attachment", () => {
    expect(trendingMemeToMessageImage(meme)).toEqual({
      id: "meme-1",
      source: "klipy",
      url: "https://cdn.example/full.webp",
      previewUrl: "https://cdn.example/preview.webp",
      width: 600,
      height: 400,
      attribution: "Powered by Klipy",
      memeId: "meme-1",
      title: "Distracted Boyfriend",
    });
  });

  it("carries the meme id through to both id and memeId (dedupe key)", () => {
    const image = trendingMemeToMessageImage(meme);
    expect(image.id).toBe(meme.id);
    expect(image.memeId).toBe(meme.id);
  });

  it("carries Klipy's title so the backend can name the meme to the model", () => {
    expect(trendingMemeToMessageImage(meme).title).toBe("Distracted Boyfriend");
  });

  it("omits title when Klipy returned an empty one (back-compat)", () => {
    const image = trendingMemeToMessageImage({ ...meme, title: "" });
    expect("title" in image).toBe(false);
  });

  it("caps memes per message at 3", () => {
    expect(MAX_MESSAGE_IMAGES).toBe(3);
  });
});

describe("trendingGifToMessageGif", () => {
  it("maps a trending gif to a stage-able klipy-gif attachment", () => {
    expect(trendingGifToMessageGif(gif)).toEqual({
      id: "gif-1",
      source: "klipy-gif",
      url: "https://cdn.example/full.gif",
      previewUrl: "https://cdn.example/poster.webp",
      frameSourceUrl: "https://cdn.example/frames.webp",
      width: 480,
      height: 480,
      attribution: "Powered by Klipy",
      gifId: "gif-1",
      title: "Happy Dance",
    });
  });

  it("preserves the distinct frameSourceUrl the backend decodes for the model", () => {
    expect(trendingGifToMessageGif(gif).frameSourceUrl).toBe(gif.frameSourceUrl);
  });

  it("carries Klipy's title so the backend can name the GIF to the model", () => {
    expect(trendingGifToMessageGif(gif).title).toBe("Happy Dance");
  });

  it("omits title when Klipy returned an empty one (back-compat)", () => {
    const staged = trendingGifToMessageGif({ ...gif, title: "" });
    expect("title" in staged).toBe(false);
  });

  it("caps gifs per message at 1", () => {
    expect(MAX_MESSAGE_GIFS).toBe(1);
  });
});
