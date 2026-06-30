import { streamAgentRequestSchema } from "../streamAgentRequest";

// A valid upload attachment per the messageImage upload contract: a Storage
// `path` under messageImages/{uid}/{conversationId}/{imageId}, an https display
// url, dimensions, an image mime, and the stored byte size.
const validUpload = {
  id: "u1",
  source: "upload" as const,
  path: "messageImages/uid-1/conv-1/abc.jpg",
  url: "https://firebasestorage.googleapis.com/v0/b/p/o/abc.jpg?alt=media",
  width: 1280,
  height: 960,
  mimeType: "image/jpeg" as const,
  bytes: 200_000,
};

describe("streamAgentRequestSchema", () => {
  it("accepts a text-only message", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "hello" });
    expect(result.success).toBe(true);
  });

  it("accepts a message with valid klipy images", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "look at this",
      images: [
        {
          id: "m1",
          source: "klipy",
          url: "https://static.klipy.com/a.png",
          previewUrl: "https://static.klipy.com/a-preview.png",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects klipy images from a non-allowlisted host", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "x",
      images: [
        {
          id: "m1",
          source: "klipy",
          url: "https://evil.example.com/a.png",
          previewUrl: "https://evil.example.com/a-preview.png",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than MAX_IMAGES images", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      source: "klipy",
      url: `https://static.klipy.com/${i}.png`,
      previewUrl: `https://static.klipy.com/${i}-preview.png`,
    }));
    const result = streamAgentRequestSchema.safeParse({
      message: "x",
      images: many,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an image with an invalid (non-klipy, non-upload) source", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "x",
      images: [{ id: "m1", source: "tenor", url: "https://x/y.png" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid uploaded image", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "x",
      images: [validUpload],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an attachment-only upload turn (empty text)", () => {
    const result = streamAgentRequestSchema.safeParse({
      images: [validUpload],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an upload whose path is outside the messageImages prefix", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "x",
      images: [{ ...validUpload, path: "userUploads/uid-1/abc.jpg" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an upload missing the stored byte size", () => {
    const { bytes: _omit, ...noBytes } = validUpload;
    void _omit;
    const result = streamAgentRequestSchema.safeParse({
      message: "x",
      images: [noBytes],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a turn carrying both a klipy meme and an upload", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "combo",
      images: [
        {
          id: "m1",
          source: "klipy",
          url: "https://static.klipy.com/a.png",
          previewUrl: "https://static.klipy.com/a-preview.png",
        },
        validUpload,
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a turn with neither text nor any attachment", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "   " });
    expect(result.success).toBe(false);
  });

  it("defaults the answering prefs to true when omitted (back-compat)", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.respondWithEmojis).toBe(true);
      expect(result.data.respondWithMedia).toBe(true);
    }
  });

  it("preserves explicit false answering prefs", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "hi",
      respondWithEmojis: false,
      respondWithMedia: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.respondWithEmojis).toBe(false);
      expect(result.data.respondWithMedia).toBe(false);
    }
  });

  it("defaults bigBrain to false when omitted (back-compat with old clients)", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bigBrain).toBe(false);
    }
  });

  it("preserves an explicit bigBrain=true", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "hi",
      bigBrain: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bigBrain).toBe(true);
    }
  });

  // ---- Stickers (additive; old clients send none) ----

  const validSticker = {
    id: "s1",
    source: "klipy-sticker" as const,
    url: "https://static.klipy.com/s.webp",
    previewUrl: "https://static.klipy.com/s.png",
  };

  it("defaults stickers to [] when omitted (proves old clients are unaffected)", () => {
    const result = streamAgentRequestSchema.safeParse({ message: "hi" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stickers).toEqual([]);
    }
  });

  it("accepts a sticker-only turn (no text/images/gifs)", () => {
    const result = streamAgentRequestSchema.safeParse({ stickers: [validSticker] });
    expect(result.success).toBe(true);
  });

  it("accepts a turn combining a meme, a gif, and stickers", () => {
    const result = streamAgentRequestSchema.safeParse({
      message: "combo",
      images: [
        {
          id: "m1",
          source: "klipy",
          url: "https://static.klipy.com/a.png",
          previewUrl: "https://static.klipy.com/a-preview.png",
        },
      ],
      gifs: [
        {
          id: "g1",
          source: "klipy-gif",
          url: "https://static.klipy.com/g.webp",
          previewUrl: "https://static.klipy.com/g.jpg",
          frameSourceUrl: "https://static.klipy.com/g-sm.webp",
        },
      ],
      stickers: [validSticker, { ...validSticker, id: "s2" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than MAX_STICKERS stickers", () => {
    const many = Array.from({ length: 4 }, (_, i) => ({
      ...validSticker,
      id: `s${i}`,
    }));
    const result = streamAgentRequestSchema.safeParse({ stickers: many });
    expect(result.success).toBe(false);
  });

  it("rejects stickers from a non-allowlisted host", () => {
    const result = streamAgentRequestSchema.safeParse({
      stickers: [{ ...validSticker, url: "https://evil.example/s.webp" }],
    });
    expect(result.success).toBe(false);
  });
});
