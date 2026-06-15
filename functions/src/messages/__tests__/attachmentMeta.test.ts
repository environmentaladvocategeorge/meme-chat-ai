import {
  buildDeciderAttachmentHint,
  buildMemeTitleNote,
  collectCurrentAttachmentTitles,
  hasAttachmentTitles,
} from "../attachmentMeta";
import type { MessageGif } from "../messageGif";
import type { MessageImage } from "../messageImage";

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
    expect(titles).toEqual({ memes: ["Gigachad", "Doge"], gif: "rat dancing" });
  });

  it("ignores uploads and untitled klipy attachments (back-compat)", () => {
    const titles = collectCurrentAttachmentTitles(
      [uploadImage(), klipyImage({ id: "m3" })],
      [klipyGif()],
    );
    expect(titles).toEqual({ memes: [], gif: undefined });
  });

  it("trims whitespace and drops blank titles", () => {
    const titles = collectCurrentAttachmentTitles(
      [klipyImage({ title: "  Spaced  " }), klipyImage({ id: "m4", title: "   " })],
      [klipyGif("   ")],
    );
    expect(titles).toEqual({ memes: ["Spaced"], gif: undefined });
  });

  it("is safe on undefined inputs", () => {
    expect(collectCurrentAttachmentTitles(undefined, undefined)).toEqual({
      memes: [],
      gif: undefined,
    });
  });
});

describe("hasAttachmentTitles", () => {
  it("is false when nothing is titled, true otherwise", () => {
    expect(hasAttachmentTitles({ memes: [], gif: undefined })).toBe(false);
    expect(hasAttachmentTitles({ memes: ["x"], gif: undefined })).toBe(true);
    expect(hasAttachmentTitles({ memes: [], gif: "y" })).toBe(true);
  });
});

describe("buildDeciderAttachmentHint", () => {
  it("returns null when there are no titles (payload unchanged for old clients)", () => {
    expect(buildDeciderAttachmentHint({ memes: [], gif: undefined })).toBeNull();
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
