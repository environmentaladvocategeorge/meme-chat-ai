import { describe, expect, it } from "@jest/globals";
import { stripMemeArtifacts } from "../sanitizeAgentText";

describe("stripMemeArtifacts", () => {
  it("removes a markdown image embed and tidies the leftover whitespace", () => {
    const input = "bruh 😭\n\n![Bruh meme](attachment://meme.png)";
    expect(stripMemeArtifacts(input)).toBe("bruh 😭");
  });

  it("removes a markdown image pointing at a real CDN url", () => {
    const input = "here you go\n\n![meme](https://cdn.klipy.com/x.gif)";
    expect(stripMemeArtifacts(input)).toBe("here you go");
  });

  it("removes an attachment link form", () => {
    const input = "lol [Bruh meme](attachment://meme.png) classic";
    expect(stripMemeArtifacts(input)).toBe("lol  classic");
  });

  it("removes a bare attachment placeholder token", () => {
    const input = "see attachment://meme.png for the vibe";
    expect(stripMemeArtifacts(input)).toBe("see  for the vibe");
  });

  it("leaves normal markdown (bold, code) untouched", () => {
    const input = "that's **wild** and `true`";
    expect(stripMemeArtifacts(input)).toBe("that's **wild** and `true`");
  });

  it("can reduce an image-only reply to empty text", () => {
    expect(stripMemeArtifacts("![x](attachment://m.png)")).toBe("");
  });
});
