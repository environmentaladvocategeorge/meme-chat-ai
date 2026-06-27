import { buildCurrentUserContent } from "../assemble";
import type { ExtractedGifFrames } from "../../gifs/extractFrames";

// buildCurrentUserContent is source-agnostic: it receives already-resolved
// model-ready image URLs (a Klipy CDN previewUrl, or a base64 data URL for an
// ingested upload) plus optional decoded GIF frames, and shapes the current
// user turn's content. These tests pin that shaping.

const KLIPY_URL = "https://static.klipy.com/preview.png";
const UPLOAD_DATA_URL = "data:image/jpeg;base64,AAAA";

describe("buildCurrentUserContent", () => {
  it("returns a plain string for a text-only turn", () => {
    expect(buildCurrentUserContent("hello", [], undefined)).toBe("hello");
  });

  it("returns an empty string for an empty, attachment-free turn", () => {
    expect(buildCurrentUserContent("   ", undefined, undefined)).toBe("");
  });

  it("emits one low-detail image_url part per resolved url, after the text", () => {
    const content = buildCurrentUserContent(
      "look at these",
      [KLIPY_URL, UPLOAD_DATA_URL],
      undefined,
    );
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: "text", text: "look at these" });
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: KLIPY_URL, detail: "low" },
    });
    expect(parts[2]).toEqual({
      type: "image_url",
      image_url: { url: UPLOAD_DATA_URL, detail: "low" },
    });
  });

  it("omits the text part for an image-only (no text) turn", () => {
    const content = buildCurrentUserContent("", [UPLOAD_DATA_URL], undefined);
    const parts = content as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "image_url" });
  });

  it("treats an upload data url identically to a klipy url (source-agnostic)", () => {
    const content = buildCurrentUserContent("", [UPLOAD_DATA_URL], undefined);
    const parts = content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({
      type: "image_url",
      image_url: { url: UPLOAD_DATA_URL, detail: "low" },
    });
  });

  it("appends a GIF note part followed by one image_url part per frame", () => {
    const gifFrames: ExtractedGifFrames = {
      frames: ["data:image/jpeg;base64,F1", "data:image/jpeg;base64,F2"],
      frameCount: 12,
      degraded: false,
    };
    const content = buildCurrentUserContent("react", undefined, gifFrames);
    const parts = content as Array<Record<string, unknown>>;
    // text, gif-note (text), frame, frame
    expect(parts).toHaveLength(4);
    expect(parts[0]).toEqual({ type: "text", text: "react" });
    expect(parts[1]).toMatchObject({ type: "text" });
    expect(String((parts[1] as { text: string }).text)).toContain("ONE animated GIF");
    expect(parts[2]).toMatchObject({ type: "image_url" });
    expect(parts[3]).toMatchObject({ type: "image_url" });
  });

  it("combines images and gif frames in order (images before gif note)", () => {
    const gifFrames: ExtractedGifFrames = {
      frames: ["data:image/jpeg;base64,F1"],
      frameCount: 1,
      degraded: true,
    };
    const content = buildCurrentUserContent("", [KLIPY_URL], gifFrames);
    const parts = content as Array<Record<string, unknown>>;
    // image, gif-note (text), frame
    expect(parts[0]).toMatchObject({ type: "image_url" });
    expect(parts[1]).toMatchObject({ type: "text" });
    expect(parts[2]).toMatchObject({ type: "image_url" });
  });

  // ---- Klipy "meme name" metadata (newer clients) ----

  it("does NOT add a meme/gif title note when titles are absent (back-compat)", () => {
    // Older clients pass no attachmentTitles → output must be byte-identical to
    // the pre-title behavior (just the image part).
    const content = buildCurrentUserContent("", [KLIPY_URL], undefined, {
      memes: [],
      gif: undefined,
    });
    const parts = content as Array<Record<string, unknown>>;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "image_url" });
  });

  it("names the meme(s) in a text part right after the image parts", () => {
    const content = buildCurrentUserContent("lol", [KLIPY_URL], undefined, {
      memes: ["Gigachad"],
      gif: undefined,
    });
    const parts = content as Array<Record<string, unknown>>;
    // text, image, meme-title note
    expect(parts[0]).toEqual({ type: "text", text: "lol" });
    expect(parts[1]).toMatchObject({ type: "image_url" });
    expect(parts[2]).toMatchObject({ type: "text" });
    expect(String((parts[2] as { text: string }).text)).toContain('"Gigachad"');
  });

  it("folds the gif title into the gif note instead of a separate part", () => {
    const gifFrames: ExtractedGifFrames = {
      frames: ["data:image/jpeg;base64,F1", "data:image/jpeg;base64,F2"],
      frameCount: 12,
      degraded: false,
    };
    const content = buildCurrentUserContent("", undefined, gifFrames, {
      memes: [],
      gif: "rat dancing",
    });
    const parts = content as Array<Record<string, unknown>>;
    // gif-note (text), frame, frame
    expect(parts[0]).toMatchObject({ type: "text" });
    const note = String((parts[0] as { text: string }).text);
    expect(note).toContain("ONE animated GIF");
    expect(note).toContain('"rat dancing"');
    expect(parts[1]).toMatchObject({ type: "image_url" });
    expect(parts[2]).toMatchObject({ type: "image_url" });
  });

  it("does not add a meme note when only a gif (no meme images) is present", () => {
    const gifFrames: ExtractedGifFrames = {
      frames: ["data:image/jpeg;base64,F1"],
      frameCount: 1,
      degraded: false,
    };
    const content = buildCurrentUserContent("", undefined, gifFrames, {
      memes: ["should-not-leak"],
      gif: "rat dancing",
    });
    const parts = content as Array<Record<string, unknown>>;
    // Only the gif note + frame — the meme note is gated on hasImages.
    expect(parts).toHaveLength(2);
    expect(String((parts[0] as { text: string }).text)).not.toContain(
      "should-not-leak",
    );
  });
});
