import { streamAgentRequestSchema } from "../streamAgentRequest";

const VALID_URL =
  "https://static.klipy.com/ii/b34001f2c30672cdcb3d906c28815404/20/90/mKF2nrrU.webp";

function image(overrides: Record<string, unknown> = {}) {
  return {
    id: "img-1",
    source: "klipy",
    url: VALID_URL,
    previewUrl: VALID_URL,
    ...overrides,
  };
}

function images(n: number) {
  return Array.from({ length: n }, (_, i) => image({ id: `img-${i}` }));
}

function gif(overrides: Record<string, unknown> = {}) {
  return {
    id: "gif-1",
    source: "klipy-gif",
    url: VALID_URL,
    previewUrl: VALID_URL,
    frameSourceUrl: VALID_URL,
    ...overrides,
  };
}

describe("streamAgentRequestSchema", () => {
  it("accepts text-only", () => {
    expect(streamAgentRequestSchema.safeParse({ message: "hi" }).success).toBe(true);
  });

  it("accepts image-only (no text)", () => {
    const result = streamAgentRequestSchema.safeParse({ images: [image()] });
    expect(result.success).toBe(true);
  });

  it("accepts text + image", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "look",
      images: [image()],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty text + no images", () => {
    expect(streamAgentRequestSchema.safeParse({}).success).toBe(false);
    expect(streamAgentRequestSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("rejects whitespace-only text + no images", () => {
    expect(streamAgentRequestSchema.safeParse({ message: "   " }).success).toBe(false);
  });

  it("accepts exactly 3 images and rejects 4", () => {
    expect(streamAgentRequestSchema.safeParse({ images: images(3) }).success).toBe(true);
    expect(streamAgentRequestSchema.safeParse({ images: images(4) }).success).toBe(false);
  });

  it("accepts gif-only (no text)", () => {
    expect(streamAgentRequestSchema.safeParse({ gifs: [gif()] }).success).toBe(true);
  });

  it("accepts memes AND a gif on the same turn (independent caps)", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "combo",
      images: images(3),
      gifs: [gif()],
    });
    expect(result.success).toBe(true);
  });

  it("accepts exactly 1 gif and rejects 2", () => {
    expect(streamAgentRequestSchema.safeParse({ gifs: [gif()] }).success).toBe(true);
    expect(
      streamAgentRequestSchema.safeParse({ gifs: [gif(), gif({ id: "gif-2" })] }).success,
    ).toBe(false);
  });

  it("rejects a gif missing frameSourceUrl", () => {
    const bad = gif();
    delete (bad as Record<string, unknown>).frameSourceUrl;
    expect(streamAgentRequestSchema.safeParse({ gifs: [bad] }).success).toBe(false);
  });

  it("rejects a gif on a non-allowlisted host", () => {
    const result = streamAgentRequestSchema.safeParse({
      gifs: [gif({ frameSourceUrl: "https://evil.example.com/a.webp" })],
    });
    expect(result.success).toBe(false);
  });

  it("defaults gifs to [] when omitted", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.gifs).toEqual([]);
  });

  it("rejects a non-klipy source", () => {
    const result = streamAgentRequestSchema.safeParse({
      images: [image({ source: "upload" })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-https url", () => {
    const result = streamAgentRequestSchema.safeParse({
      images: [image({ url: "http://static.klipy.com/a.webp" })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-allowlisted host (tampered url)", () => {
    const result = streamAgentRequestSchema.safeParse({
      images: [image({ previewUrl: "https://evil.example.com/a.webp" })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported mimeType", () => {
    const result = streamAgentRequestSchema.safeParse({
      images: [image({ mimeType: "image/gif" })],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an over-long message", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "x".repeat(4001) });
    expect(result.success).toBe(false);
  });

  it("defaults message to '' and images to [] when omitted", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.images).toEqual([]);
    }
  });

  it("defaults levelOfRot to 2 when omitted", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.levelOfRot).toBe(2);
    }
  });

  it("accepts levelOfRot 1–3 and rejects out-of-range / non-integer", () => {
    for (const level of [1, 2, 3]) {
      const result = streamAgentRequestSchema.safeParse({ message: "hi", levelOfRot: level });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.levelOfRot).toBe(level);
    }
    expect(streamAgentRequestSchema.safeParse({ message: "hi", levelOfRot: 0 }).success).toBe(false);
    expect(streamAgentRequestSchema.safeParse({ message: "hi", levelOfRot: 4 }).success).toBe(false);
    expect(streamAgentRequestSchema.safeParse({ message: "hi", levelOfRot: 1.5 }).success).toBe(false);
  });
});
