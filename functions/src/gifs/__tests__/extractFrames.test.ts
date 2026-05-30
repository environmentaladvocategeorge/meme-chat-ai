import { extractGifFrames, pickFrameIndices } from "../extractFrames";

jest.mock("sharp");
import sharp from "sharp";

const mockSharp = sharp as unknown as jest.Mock;

const FRAME_SOURCE = "https://static.klipy.com/gif/sm.webp";
const POSTER = "https://static.klipy.com/gif/sm.jpg";

// A chainable sharp stand-in: metadata() reports `pages`, the encode chain
// (resize → jpeg → toBuffer) yields a tiny buffer.
function makeInstance(pages: number) {
  const instance: Record<string, unknown> = {
    metadata: jest.fn(async () => ({ pages })),
    resize: jest.fn(() => instance),
    jpeg: jest.fn(() => instance),
    toBuffer: jest.fn(async () => Buffer.from("frame-bytes")),
  };
  return instance;
}

function okFetch(): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(64),
  } as unknown as Response;
}

describe("pickFrameIndices", () => {
  it("returns a single index for a one-frame gif", () => {
    expect(pickFrameIndices(1)).toEqual([0]);
  });

  it("returns both indices for a two-frame gif", () => {
    expect(pickFrameIndices(2)).toEqual([0, 1]);
  });

  it("returns start/middle/end for a three-frame gif", () => {
    expect(pickFrameIndices(3)).toEqual([0, 1, 2]);
  });

  it("spans first/middle/last for a long gif", () => {
    expect(pickFrameIndices(30)).toEqual([0, 15, 29]);
  });
});

describe("extractGifFrames", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockSharp.mockReset();
  });

  it("decodes three frames from a multi-frame gif", async () => {
    fetchMock.mockResolvedValue(okFetch());
    mockSharp.mockReturnValue(makeInstance(12));

    const result = await extractGifFrames({
      frameSourceUrl: FRAME_SOURCE,
      previewUrl: POSTER,
    });

    expect(result.degraded).toBe(false);
    expect(result.frameCount).toBe(12);
    expect(result.frames).toHaveLength(3);
    result.frames.forEach((f) =>
      expect(f.startsWith("data:image/jpeg;base64,")).toBe(true),
    );
  });

  it("emits one frame for a single-frame gif", async () => {
    fetchMock.mockResolvedValue(okFetch());
    mockSharp.mockReturnValue(makeInstance(1));

    const result = await extractGifFrames({
      frameSourceUrl: FRAME_SOURCE,
      previewUrl: POSTER,
    });

    expect(result.frames).toHaveLength(1);
    expect(result.degraded).toBe(false);
  });

  it("falls back to the poster when the frame-source fetch fails", async () => {
    // First fetch (frame source) rejects; second fetch (poster) succeeds.
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(okFetch());
    mockSharp.mockReturnValue(makeInstance(1));

    const result = await extractGifFrames({
      frameSourceUrl: FRAME_SOURCE,
      previewUrl: POSTER,
    });

    expect(result.degraded).toBe(true);
    expect(result.frames).toHaveLength(1);
  });

  it("returns no frames (degraded) when even the poster fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const result = await extractGifFrames({
      frameSourceUrl: FRAME_SOURCE,
      previewUrl: POSTER,
    });

    expect(result.degraded).toBe(true);
    expect(result.frames).toHaveLength(0);
    expect(result.frameCount).toBe(0);
  });

  it("refuses to fetch a non-allowlisted frame source, falling back", async () => {
    fetchMock.mockResolvedValue(okFetch());
    mockSharp.mockReturnValue(makeInstance(1));

    const result = await extractGifFrames({
      frameSourceUrl: "https://evil.example.com/x.webp",
      previewUrl: POSTER,
    });

    // Frame-source fetch is blocked before any network call; poster fallback
    // (allowlisted) still runs.
    expect(result.degraded).toBe(true);
    const fetchedUrls = fetchMock.mock.calls.map((c) => c[0]);
    expect(fetchedUrls).not.toContain("https://evil.example.com/x.webp");
  });
});
