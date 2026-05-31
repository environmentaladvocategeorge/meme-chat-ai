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
});
