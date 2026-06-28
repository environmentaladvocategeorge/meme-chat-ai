import {
  buildDeciderAttachmentHint,
  buildMemeTitleNote,
  buildStickerNote,
  collectCurrentAttachmentTitles,
  hasAttachmentTitles,
} from "../attachmentMeta";
import type { MessageGif } from "../messageGif";
import type { MessageImage } from "../messageImage";
import type { MessageSticker } from "../messageSticker";

function klipySticker(
  overrides: Partial<MessageSticker> = {},
): MessageSticker {
  return {
    id: "s1",
    source: "klipy-sticker",
    url: "https://static.klipy.com/s.webp",
    previewUrl: "https://static.klipy.com/s.png",
    ...overrides,
  };
}

function klipyImage(overrides: Partial<MessageImage> = {}): MessageImage {
  return {
    id: "m1",
    source: "klipy",
    url: "https://static.klipy.com/m.webp",
    previewUrl: "https://static.klipy.com/m-sm.webp",
    ...overrides,
  } as MessageImage;
}

function uploadImage(): MessageImage {
  return {
    id: "u1",
    source: "upload",
    path: "messageImages/uid/conv/u1",
    url: "https://firebasestorage.googleapis.com/u1",
    width: 100,
    height: 100,
    mimeType: "image/jpeg",
    bytes: 1234,
  };
}

function klipyGif(title?: string): MessageGif {
  return {
    id: "g1",
    source: "klipy-gif",
    url: "https://static.klipy.com/g.webp",
    previewUrl: "https://static.klipy.com/g.jpg",
    frameSourceUrl: "https://static.klipy.com/g-sm.webp",
    ...(title !== undefined ? { title } : {}),
  };
}

describe("collectCurrentAttachmentTitles", () => {
  it("collects klipy meme titles in order and the gif title", () => {
    const titles = collectCurrentAttachmentTitles(
      [klipyImage({ title: "Gigachad" }), klipyImage({ id: "m2", title: "Doge" })],
      [klipyGif("rat dancing")],
    );
    expect(titles).toEqual({
      memes: ["Gigachad", "Doge"],
      gif: "rat dancing",
      stickers: [],
    });
  });

  it("ignores uploads and untitled klipy attachments (back-compat)", () => {
    const titles = collectCurrentAttachmentTitles(
      [uploadImage(), klipyImage({ id: "m3" })],
      [klipyGif()],
    );
    expect(titles).toEqual({ memes: [], gif: undefined, stickers: [] });
  });

  it("trims whitespace and drops blank titles", () => {
    const titles = collectCurrentAttachmentTitles(
      [klipyImage({ title: "  Spaced  " }), klipyImage({ id: "m4", title: "   " })],
      [klipyGif("   ")],
    );
    expect(titles).toEqual({ memes: ["Spaced"], gif: undefined, stickers: [] });
  });

  it("collects sticker titles + the first non-empty search query", () => {
    const titles = collectCurrentAttachmentTitles(
      undefined,
      undefined,
      [
        klipySticker({ title: "rawr", searchQuery: "dino" }),
        klipySticker({ id: "s2", title: "   " }),
        klipySticker({ id: "s3", title: "cool cat", searchQuery: "later" }),
      ],
    );
    expect(titles).toEqual({
      memes: [],
      gif: undefined,
      stickers: ["rawr", "cool cat"],
      stickerQuery: "dino",
    });
  });

  it("is safe on undefined inputs", () => {
    expect(collectCurrentAttachmentTitles(undefined, undefined)).toEqual({
      memes: [],
      gif: undefined,
      stickers: [],
    });
  });
});

describe("hasAttachmentTitles", () => {
  it("is false when nothing is titled, true otherwise", () => {
    expect(hasAttachmentTitles({ memes: [], gif: undefined })).toBe(false);
    expect(hasAttachmentTitles({ memes: ["x"], gif: undefined })).toBe(true);
    expect(hasAttachmentTitles({ memes: [], gif: "y" })).toBe(true);
    expect(hasAttachmentTitles({ memes: [], stickers: ["z"] })).toBe(true);
  });
});

describe("buildDeciderAttachmentHint", () => {
  it("returns null when there are no titles (payload unchanged for old clients)", () => {
    expect(buildDeciderAttachmentHint({ memes: [], gif: undefined })).toBeNull();
    // A sticker-free turn from a newer client (empty stickers array) is also a
    // no-op so the decider payload stays byte-identical.
    expect(
      buildDeciderAttachmentHint({ memes: [], gif: undefined, stickers: [] }),
    ).toBeNull();
  });

  it("quotes every meme + gif name in one hint line", () => {
    const hint = buildDeciderAttachmentHint({
      memes: ["Gigachad"],
      gif: "rat dancing",
    });
    expect(hint).toContain('"Gigachad"');
    expect(hint).toContain('"rat dancing"');
    expect(hint).toContain("recognizable reference");
  });

  it("keeps the original meme/GIF wording byte-identical when no stickers", () => {
    const withField = buildDeciderAttachmentHint({
      memes: ["Gigachad"],
      gif: undefined,
      stickers: [],
    });
    const withoutField = buildDeciderAttachmentHint({
      memes: ["Gigachad"],
      gif: undefined,
    });
    expect(withField).toBe(withoutField);
    expect(withField).toContain("meme/GIF named");
    expect(withField).not.toContain("sticker");
  });

  it("folds sticker names + the search term into the hint when present", () => {
    const hint = buildDeciderAttachmentHint({
      memes: ["Gigachad"],
      gif: undefined,
      stickers: ["rawr"],
      stickerQuery: "dino",
    });
    expect(hint).toContain('"Gigachad"');
    expect(hint).toContain('"rawr"');
    expect(hint).toContain('searched "dino"');
    expect(hint).toContain("meme/GIF/sticker");
  });
});

describe("buildStickerNote", () => {
  it("returns null when there are no stickers (back-compat)", () => {
    expect(buildStickerNote(0)).toBeNull();
  });

  it("names a single sticker with singular grammar + the search term", () => {
    const note = buildStickerNote(1, {
      memes: [],
      stickers: ["rawr"],
      stickerQuery: "dino",
    });
    expect(note).toContain("a sticker");
    expect(note).toContain('"rawr"');
    expect(note).toContain('searching "dino"');
    expect(note).toContain("don't read any names aloud");
  });

  it("uses plural grammar for multiple stickers and works without titles", () => {
    const note = buildStickerNote(2);
    expect(note).toContain("following 2 images are stickers");
    expect(note).not.toContain("named");
  });
});

describe("buildMemeTitleNote", () => {
  it("returns null when no meme titles are present", () => {
    expect(buildMemeTitleNote({ memes: [], gif: "x" })).toBeNull();
  });

  it("names a single meme with singular grammar", () => {
    const note = buildMemeTitleNote({ memes: ["Gigachad"], gif: undefined });
    expect(note).toContain("meme shown above is known as");
    expect(note).toContain('"Gigachad"');
  });

  it("names multiple memes with plural grammar", () => {
    const note = buildMemeTitleNote({ memes: ["Gigachad", "Doge"], gif: undefined });
    expect(note).toContain("memes shown above are known as");
    expect(note).toContain('"Gigachad", "Doge"');
  });
});
