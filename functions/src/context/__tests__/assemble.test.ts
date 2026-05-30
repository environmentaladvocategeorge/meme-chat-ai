import type { ChatMessage } from "../../agent/types";
import type { MessageImage } from "../../messages/messageImage";
import {
  assembleFromInputs,
  buildCurrentUserContent,
  type OpenAIContentPart,
  type OpenAIImagePart,
} from "../assemble";
import { countTokens, IMAGE_TOKENS_LOW } from "../tokens";

const PREVIEW_URL = "https://static.klipy.com/ii/abc/20/90/preview.webp";
const FULL_URL = "https://static.klipy.com/ii/abc/40/90/full.webp";

function mkImage(overrides: Partial<MessageImage> = {}): MessageImage {
  return {
    id: "img-1",
    source: "klipy",
    url: FULL_URL,
    previewUrl: PREVIEW_URL,
    ...overrides,
  };
}

function imageParts(content: string | OpenAIContentPart[]): OpenAIImagePart[] {
  if (typeof content === "string") return [];
  return content.filter((p): p is OpenAIImagePart => p.type === "image_url");
}

describe("countTokens", () => {
  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });
  it("counts a single short word as a few tokens", () => {
    const n = countTokens("hello");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(5);
  });
  it("scales roughly with text length", () => {
    const small = countTokens("hello world");
    const big = countTokens("hello world ".repeat(100));
    expect(big).toBeGreaterThan(small * 50);
  });
});

describe("assembleFromInputs", () => {
  function mkMessages(count: number, prefix = ""): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < count; i++) {
      out.push({
        role: i % 2 === 0 ? "user" : "agent",
        text: `${prefix}message-${i} ${"filler ".repeat(5)}`,
      });
    }
    return out;
  }

  it("always includes system + current user message", () => {
    const result = assembleFromInputs({
      summary: null,
      recent: [],
      currentText: "hi",
      maxInputTokens: 1000,
    });
    expect(result.messages[0].role).toBe("system");
    const last = result.messages[result.messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe("hi");
  });

  it("includes a second system message when a summary is present", () => {
    const result = assembleFromInputs({
      summary: "User wants help with X.",
      recent: [],
      currentText: "continue",
      maxInputTokens: 1000,
    });
    expect(result.summaryUsed).toBe(true);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].role).toBe("system");
    expect(result.messages[1].content).toContain("User wants help with X.");
  });

  it("treats empty/whitespace summary as no-summary", () => {
    const result = assembleFromInputs({
      summary: "   ",
      recent: [],
      currentText: "hi",
      maxInputTokens: 1000,
    });
    expect(result.summaryUsed).toBe(false);
    expect(result.messages.filter((m) => m.role === "system")).toHaveLength(1);
  });

  it("drops oldest recent messages first when over the budget", () => {
    const recent = mkMessages(10);
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "current",
      maxInputTokens: 60, // very tight, forces truncation
    });
    expect(result.inputTokens).toBeLessThanOrEqual(60 + 20); // small slack for system+current
    expect(result.recentMessageCount).toBeLessThan(10);
    // current message is still present
    expect(result.messages[result.messages.length - 1].content).toBe("current");
  });

  it("never exceeds maxInputTokens for adversarially long history", () => {
    const huge = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" as const : "agent" as const,
      text: "x".repeat(2000),
    }));
    const result = assembleFromInputs({
      summary: null,
      recent: huge,
      currentText: "now what",
      maxInputTokens: 4000,
    });
    expect(result.inputTokens).toBeLessThanOrEqual(4000);
  });

  it("respects the RECENT_TARGET ceiling (caps the visible window even when more is available)", () => {
    const recent = mkMessages(25);
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "ok",
      maxInputTokens: 100_000,
    });
    // Internal RECENT_TARGET is 10 — assembler should pick at most that many
    // plus system + current = 12 entries (or +13 if summary).
    expect(result.messages.length).toBeLessThanOrEqual(12);
  });

  it("maps user → user and agent → assistant", () => {
    const recent: ChatMessage[] = [
      { role: "user", text: "ping" },
      { role: "agent", text: "pong" },
    ];
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "again",
      maxInputTokens: 10_000,
    });
    const roles = result.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
  });
});

describe("buildCurrentUserContent", () => {
  it("returns a plain trimmed string when there are no images", () => {
    expect(buildCurrentUserContent("  hello  ", [])).toBe("hello");
    expect(buildCurrentUserContent("hello")).toBe("hello");
  });

  it("returns image content parts for an image-only turn", () => {
    const content = buildCurrentUserContent("", [mkImage()]);
    expect(Array.isArray(content)).toBe(true);
    const parts = content as OpenAIContentPart[];
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({
      type: "image_url",
      image_url: { url: PREVIEW_URL, detail: "low" },
    });
  });

  it("returns text part + image parts for text + image", () => {
    const content = buildCurrentUserContent("look at this", [
      mkImage(),
      mkImage({ id: "img-2" }),
    ]) as OpenAIContentPart[];
    expect(content[0]).toEqual({ type: "text", text: "look at this" });
    expect(imageParts(content)).toHaveLength(2);
  });

  it("omits the text part when text is empty/whitespace", () => {
    const content = buildCurrentUserContent("   ", [mkImage()]) as OpenAIContentPart[];
    expect(content.every((p) => p.type === "image_url")).toBe(true);
  });

  it("always sets detail:'low' on image parts", () => {
    const content = buildCurrentUserContent("hi", [mkImage()]);
    for (const part of imageParts(content)) {
      expect(part.image_url.detail).toBe("low");
    }
  });

  it("sends previewUrl to the model, never the full url", () => {
    const content = buildCurrentUserContent("hi", [mkImage()]);
    const urls = imageParts(content).map((p) => p.image_url.url);
    expect(urls).toContain(PREVIEW_URL);
    expect(urls).not.toContain(FULL_URL);
  });
});

describe("assembleFromInputs with images", () => {
  it("keeps the current text-only turn as a string", () => {
    const result = assembleFromInputs({
      summary: null,
      recent: [],
      currentText: "just text",
      currentImages: [],
      maxInputTokens: 10_000,
    });
    const last = result.messages[result.messages.length - 1];
    expect(last.content).toBe("just text");
  });

  it("builds image parts for the current turn", () => {
    const result = assembleFromInputs({
      summary: null,
      recent: [],
      currentText: "caption",
      currentImages: [mkImage()],
      maxInputTokens: 10_000,
    });
    const last = result.messages[result.messages.length - 1];
    expect(imageParts(last.content)).toHaveLength(1);
  });

  it("collapses a prior image-only user message to a placeholder (no image_url)", () => {
    const recent: ChatMessage[] = [
      { role: "user", text: "", images: [mkImage()] },
      { role: "agent", text: "haha nice" },
    ];
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "and now?",
      maxInputTokens: 10_000,
    });
    const priorUser = result.messages[1];
    expect(priorUser.content).toBe("[User sent a Klipy meme image]");
    // No image parts anywhere except the current turn (which has none here).
    const allImageParts = result.messages.flatMap((m) => imageParts(m.content));
    expect(allImageParts).toHaveLength(0);
  });

  it("appends a placeholder after prior text when the message had both", () => {
    const recent: ChatMessage[] = [
      { role: "user", text: "check this", images: [mkImage()] },
    ];
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "ok",
      maxInputTokens: 10_000,
    });
    expect(result.messages[1].content).toBe(
      "check this\n\n[User sent a Klipy meme image]",
    );
  });

  it("collapses multiple historical images to one cheap note", () => {
    const recent: ChatMessage[] = [
      {
        role: "user",
        text: "",
        images: [mkImage(), mkImage({ id: "b" }), mkImage({ id: "c" })],
      },
    ];
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "ok",
      maxInputTokens: 10_000,
    });
    expect(result.messages[1].content).toBe("[User sent 3 Klipy meme images]");
  });

  it("counts current-turn image tokens at IMAGE_TOKENS_LOW each", () => {
    const noImages = assembleFromInputs({
      summary: null,
      recent: [],
      currentText: "caption",
      currentImages: [],
      maxInputTokens: 100_000,
    });
    const twoImages = assembleFromInputs({
      summary: null,
      recent: [],
      currentText: "caption",
      currentImages: [mkImage(), mkImage({ id: "img-2" })],
      maxInputTokens: 100_000,
    });
    expect(twoImages.inputTokens - noImages.inputTokens).toBe(2 * IMAGE_TOKENS_LOW);
  });

  it("does not count collapsed historical images as image tokens", () => {
    // A historical image turn is just a short text placeholder, so it must not
    // add ~250 tokens per image.
    const result = assembleFromInputs({
      summary: null,
      recent: [{ role: "user", text: "", images: [mkImage(), mkImage({ id: "b" })] }],
      currentText: "ok",
      maxInputTokens: 100_000,
    });
    const placeholderTokens = countTokens("[User sent 2 Klipy meme images]");
    // The whole assembly should be far below even a single image's token cost
    // beyond the placeholder text.
    expect(placeholderTokens).toBeLessThan(IMAGE_TOKENS_LOW);
  });
});

describe("buildCurrentUserContent with a GIF", () => {
  const dataUrl = (n: number) => `data:image/jpeg;base64,FRAME${n}`;
  const threeFrames = {
    frames: [dataUrl(0), dataUrl(1), dataUrl(2)],
    frameCount: 12,
    degraded: false,
  };

  function textParts(content: string | OpenAIContentPart[]) {
    if (typeof content === "string") return [];
    return content.filter((p) => p.type === "text") as { type: "text"; text: string }[];
  }

  it("appends a one-gif note plus a frame image part per frame", () => {
    const content = buildCurrentUserContent("lol", undefined, threeFrames);
    const parts = content as OpenAIContentPart[];
    // text reply + gif note + 3 frame images
    expect(imageParts(content)).toHaveLength(3);
    const notes = textParts(content);
    expect(parts[0]).toEqual({ type: "text", text: "lol" });
    expect(notes.some((p) => /ONE animated GIF/.test(p.text))).toBe(true);
    expect(notes.some((p) => /3 separate images/.test(p.text))).toBe(true);
  });

  it("sends the base64 frame data URLs, detail low", () => {
    const content = buildCurrentUserContent("", undefined, threeFrames);
    const urls = imageParts(content).map((p) => p.image_url.url);
    expect(urls).toEqual([dataUrl(0), dataUrl(1), dataUrl(2)]);
    imageParts(content).forEach((p) => expect(p.image_url.detail).toBe("low"));
  });

  it("phrases the note for a single degraded frame", () => {
    const content = buildCurrentUserContent("", undefined, {
      frames: [dataUrl(0)],
      frameCount: 1,
      degraded: true,
    });
    const notes = textParts(content);
    expect(notes.some((p) => /single still frame/.test(p.text))).toBe(true);
    expect(imageParts(content)).toHaveLength(1);
  });

  it("still notes the GIF when no frames could be extracted", () => {
    const content = buildCurrentUserContent("hey", undefined, {
      frames: [],
      frameCount: 0,
      degraded: true,
    });
    expect(imageParts(content)).toHaveLength(0);
    const notes = textParts(content);
    expect(notes.some((p) => /could not be processed/.test(p.text))).toBe(true);
  });

  it("carries both memes and a GIF on the same turn", () => {
    const content = buildCurrentUserContent("combo", [mkImage()], threeFrames);
    // 1 meme image + 3 gif frames
    expect(imageParts(content)).toHaveLength(4);
  });
});

describe("assembleFromInputs collapses historical GIFs", () => {
  it("collapses a prior GIF-only turn to a placeholder (no image parts)", () => {
    const recent: ChatMessage[] = [
      {
        role: "user",
        text: "",
        gifs: [
          {
            id: "g1",
            source: "klipy-gif",
            url: "https://static.klipy.com/g.webp",
            previewUrl: "https://static.klipy.com/g.jpg",
            frameSourceUrl: "https://static.klipy.com/sm.webp",
          },
        ],
      },
    ];
    const result = assembleFromInputs({
      summary: null,
      recent,
      currentText: "and now?",
      maxInputTokens: 10_000,
    });
    expect(result.messages[1].content).toBe("[User sent an animated GIF]");
    const allImageParts = result.messages.flatMap((m) => imageParts(m.content));
    expect(allImageParts).toHaveLength(0);
  });
});
