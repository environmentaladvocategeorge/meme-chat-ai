import {
  ALLOWED_IMAGE_HOSTS,
  isAllowedImageUrl,
  MAX_IMAGE_URL_LENGTH,
  messageImageSchema,
  summarizeImagesForLog,
} from "../messageImage";

const VALID_URL =
  "https://static.klipy.com/ii/b34001f2c30672cdcb3d906c28815404/20/90/mKF2nrrU.webp";

function validImage(overrides: Record<string, unknown> = {}) {
  return {
    id: "img-1",
    source: "klipy",
    url: VALID_URL,
    previewUrl: VALID_URL,
    ...overrides,
  };
}

describe("isAllowedImageUrl", () => {
  it("accepts an https Klipy CDN url", () => {
    expect(isAllowedImageUrl(VALID_URL)).toBe(true);
  });

  it("rejects http (non-https)", () => {
    expect(isAllowedImageUrl("http://static.klipy.com/a.webp")).toBe(false);
  });

  it("rejects a non-allowlisted host", () => {
    expect(isAllowedImageUrl("https://evil.example.com/a.webp")).toBe(false);
    expect(isAllowedImageUrl("https://klipy.com/a.webp")).toBe(false);
  });

  it("rejects a url longer than the bound", () => {
    const long = `https://static.klipy.com/${"a".repeat(MAX_IMAGE_URL_LENGTH)}.webp`;
    expect(long.length).toBeGreaterThan(MAX_IMAGE_URL_LENGTH);
    expect(isAllowedImageUrl(long)).toBe(false);
  });

  it("rejects garbage that isn't a url", () => {
    expect(isAllowedImageUrl("not a url")).toBe(false);
  });

  it("only allowlists static.klipy.com for now", () => {
    expect([...ALLOWED_IMAGE_HOSTS]).toEqual(["static.klipy.com"]);
  });
});

describe("messageImageSchema", () => {
  it("accepts a minimal valid Klipy image", () => {
    expect(messageImageSchema.safeParse(validImage()).success).toBe(true);
  });

  it("accepts optional metadata fields", () => {
    const result = messageImageSchema.safeParse(
      validImage({
        width: 200,
        height: 200,
        mimeType: "image/webp",
        attribution: "Klipy",
        memeId: "meme-42",
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a non-klipy source", () => {
    expect(messageImageSchema.safeParse(validImage({ source: "upload" })).success).toBe(
      false,
    );
  });

  it("rejects a non-https url", () => {
    const result = messageImageSchema.safeParse(
      validImage({ url: "http://static.klipy.com/a.webp" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a non-allowlisted host on previewUrl", () => {
    const result = messageImageSchema.safeParse(
      validImage({ previewUrl: "https://evil.example.com/a.webp" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an unsupported mimeType", () => {
    const result = messageImageSchema.safeParse(
      validImage({ mimeType: "image/gif" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(messageImageSchema.safeParse(validImage({ id: "" })).success).toBe(false);
  });
});

describe("summarizeImagesForLog", () => {
  it("emits url-free metadata only", () => {
    const summary = summarizeImagesForLog([
      validImage({ mimeType: "image/webp" }) as never,
      validImage({ id: "img-2", mimeType: "image/png" }) as never,
    ]);
    expect(summary).toEqual({
      imageCount: 2,
      source: ["klipy"],
      hosts: ["static.klipy.com"],
      mimeTypes: ["image/webp", "image/png"],
    });
    // No field should contain a full URL.
    expect(JSON.stringify(summary)).not.toContain("mKF2nrrU");
  });
});
