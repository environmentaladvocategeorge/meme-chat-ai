import {
  MAX_GIFS,
  messageGifSchema,
  summarizeGifsForLog,
  type MessageGif,
} from "../messageGif";

const valid = {
  id: "g1",
  source: "klipy-gif" as const,
  url: "https://static.klipy.com/a.gif",
  previewUrl: "https://static.klipy.com/a.jpg",
  frameSourceUrl: "https://static.klipy.com/a-frames.webp",
};

describe("messageGifSchema", () => {
  it("accepts a well-formed Klipy GIF", () => {
    expect(messageGifSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts optional fields within bounds", () => {
    const r = messageGifSchema.safeParse({
      ...valid,
      width: 200,
      height: 100,
      mimeType: "image/webp",
      attribution: "Powered by Klipy",
      gifId: "g1",
      title: "rat dancing",
    });
    expect(r.success).toBe(true);
  });

  it("rejects the wrong source discriminant", () => {
    expect(messageGifSchema.safeParse({ ...valid, source: "klipy" }).success).toBe(false);
  });

  it("rejects a non-allowlisted host", () => {
    expect(
      messageGifSchema.safeParse({ ...valid, url: "https://evil.example/a.gif" }).success,
    ).toBe(false);
  });

  it("rejects a non-https URL on a frame source", () => {
    expect(
      messageGifSchema.safeParse({
        ...valid,
        frameSourceUrl: "http://static.klipy.com/a.webp",
      }).success,
    ).toBe(false);
  });

  it("requires frameSourceUrl", () => {
    const { frameSourceUrl, ...rest } = valid;
    expect(messageGifSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-enum mimeType and an over-long title", () => {
    expect(messageGifSchema.safeParse({ ...valid, mimeType: "image/png" }).success).toBe(false);
    expect(messageGifSchema.safeParse({ ...valid, title: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects non-positive / non-integer dimensions", () => {
    expect(messageGifSchema.safeParse({ ...valid, width: 0 }).success).toBe(false);
    expect(messageGifSchema.safeParse({ ...valid, height: 1.5 }).success).toBe(false);
  });

  it("caps a turn at exactly one GIF", () => {
    expect(MAX_GIFS).toBe(1);
  });
});

describe("summarizeGifsForLog", () => {
  it("returns URL-free count / source / host metadata", () => {
    const gifs: MessageGif[] = [
      valid,
      { ...valid, id: "g2", url: "https://static.klipy.com/b.gif" },
    ];
    expect(summarizeGifsForLog(gifs)).toEqual({
      gifCount: 2,
      source: ["klipy-gif"],
      hosts: ["static.klipy.com"],
    });
  });

  it("skips a malformed url when collecting hosts", () => {
    const gifs = [{ ...valid, url: "not a url" }] as MessageGif[];
    expect(summarizeGifsForLog(gifs).hosts).toEqual([]);
  });
});
