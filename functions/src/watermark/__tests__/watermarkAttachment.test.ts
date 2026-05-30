import sharp from "sharp";
import { watermarkAttachmentImpl } from "../watermarkAttachment";

const ALLOWED = "https://static.klipy.com/ii/abc/20/90/x.png";

// A real small PNG the mocked fetch returns; the test then runs the real
// sharp compositor so we exercise the actual watermark path end to end.
async function samplePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 240, g: 240, b: 240 },
    },
  })
    .png()
    .toBuffer();
}

function arrayBufferResponse(buf: Buffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  } as unknown as Response;
}

describe("watermarkAttachmentImpl", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("rejects an unauthenticated caller", async () => {
    await expect(watermarkAttachmentImpl(undefined, { url: ALLOWED })).rejects.toThrow(
      /auth-required/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-allowlisted url before fetching", async () => {
    await expect(
      watermarkAttachmentImpl("uid-1", { url: "https://evil.example.com/a.png" }),
    ).rejects.toThrow(/invalid-request/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-https klipy url", async () => {
    await expect(
      watermarkAttachmentImpl("uid-1", { url: "http://static.klipy.com/a.png" }),
    ).rejects.toThrow(/invalid-request/);
  });

  it("returns a watermarked PNG (base64) the decoder can read back", async () => {
    fetchMock.mockResolvedValue(arrayBufferResponse(await samplePng()));

    const result = await watermarkAttachmentImpl("uid-1", { url: ALLOWED });

    expect(result.mimeType).toBe("image/png");
    expect(result.dataBase64.length).toBeGreaterThan(0);
    // The output is a valid PNG with the source's (capped) dimensions.
    const out = await sharp(Buffer.from(result.dataBase64, "base64")).metadata();
    expect(out.format).toBe("png");
    expect(out.width).toBe(400);
    expect(out.height).toBe(300);
  });

  it("maps a failed asset fetch to unavailable", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 } as unknown as Response);
    await expect(
      watermarkAttachmentImpl("uid-1", { url: ALLOWED }),
    ).rejects.toThrow(/asset-unavailable/);
  });
});
