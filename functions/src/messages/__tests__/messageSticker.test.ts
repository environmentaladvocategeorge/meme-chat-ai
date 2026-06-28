import {
  MAX_STICKERS,
  messageStickerSchema,
  summarizeStickersForLog,
  type MessageSticker,
} from "../messageSticker";

const valid = {
  id: "s1",
  source: "klipy-sticker" as const,
  url: "https://static.klipy.com/s.webp",
  previewUrl: "https://static.klipy.com/s.png",
};

describe("messageStickerSchema", () => {
  it("accepts a well-formed Klipy sticker", () => {
    expect(messageStickerSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional fields within bounds", () => {
    const r = messageStickerSchema.safeParse({
      ...valid,
      width: 200,
      height: 100,
      mimeType: "image/png",
      attribution: "Powered by Klipy",
      stickerId: "s1",
      title: "rawr dino",
      searchQuery: "dino",
    });
    expect(r.success).toBe(true);
  });

  it("rejects the wrong source discriminant", () => {
    expect(messageStickerSchema.safeParse({ ...valid, source: "klipy-gif" }).success).toBe(
      false,
    );
  });

  it("rejects a non-allowlisted host", () => {
    expect(
      messageStickerSchema.safeParse({ ...valid, url: "https://evil.example/s.webp" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-https preview URL", () => {
    expect(
      messageStickerSchema.safeParse({
        ...valid,
        previewUrl: "http://static.klipy.com/s.png",
      }).success,
    ).toBe(false);
  });

  it("does NOT require a frameSourceUrl (stickers ship a static png)", () => {
    // Stickers have no frame-source field at all — the schema must accept the
    // minimal valid shape without one.
    expect(messageStickerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an over-long title and an over-long search query", () => {
    expect(
      messageStickerSchema.safeParse({ ...valid, title: "x".repeat(201) }).success,
    ).toBe(false);
    expect(
      messageStickerSchema.safeParse({ ...valid, searchQuery: "x".repeat(101) }).success,
    ).toBe(false);
  });

  it("rejects non-positive / non-integer dimensions", () => {
    expect(messageStickerSchema.safeParse({ ...valid, width: 0 }).success).toBe(false);
    expect(messageStickerSchema.safeParse({ ...valid, height: 1.5 }).success).toBe(false);
  });

  it("caps a turn at three stickers", () => {
    expect(MAX_STICKERS).toBe(3);
  });
});

describe("summarizeStickersForLog", () => {
  it("returns URL-free count / source / host metadata", () => {
    const stickers: MessageSticker[] = [
      valid,
      { ...valid, id: "s2", url: "https://static.klipy.com/b.webp" },
    ];
    expect(summarizeStickersForLog(stickers)).toEqual({
      stickerCount: 2,
      source: ["klipy-sticker"],
      hosts: ["static.klipy.com"],
    });
  });

  it("skips a malformed url when collecting hosts", () => {
    const stickers = [{ ...valid, url: "not a url" }] as MessageSticker[];
    expect(summarizeStickersForLog(stickers).hosts).toEqual([]);
  });
});
