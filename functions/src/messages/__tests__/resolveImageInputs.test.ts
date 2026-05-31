import { getStorage } from "firebase-admin/storage";
import OpenAI from "openai";
import sharp from "sharp";
import {
  deleteUploadObjects,
  resolveImageInputs,
} from "../resolveImageInputs";
import type { MessageImage } from "../messageImage";

jest.mock("firebase-admin/storage");
jest.mock("sharp");
jest.mock("openai");

const UID = "uid-123";
const OWNED_PATH = "messageImages/uid-123/conv-1/img-abc.jpg";
const API_KEY = "sk-test";

// ----- mock wiring -----

// NOTE: jest.config sets resetMocks:true, so every mock's implementation is
// wiped before each test. Everything below is therefore (re)wired in
// beforeEach, not at module load.
let mockFile: {
  getMetadata: jest.Mock;
  download: jest.Mock;
  delete: jest.Mock;
};
let mockBucket: { file: jest.Mock };
let mockModerationCreate: jest.Mock;
// sharp() returns a chainable builder; every step returns the same object and
// toBuffer resolves to a tiny fake JPEG.
let sharpChain: {
  rotate: jest.Mock;
  resize: jest.Mock;
  jpeg: jest.Mock;
  toBuffer: jest.Mock;
};

const klipyImage: MessageImage = {
  id: "k1",
  source: "klipy",
  url: "https://static.klipy.com/full.png",
  previewUrl: "https://static.klipy.com/preview.png",
};

function uploadImage(overrides: Partial<Extract<MessageImage, { source: "upload" }>> = {}) {
  return {
    id: "u1",
    source: "upload" as const,
    path: OWNED_PATH,
    url: "https://firebasestorage.googleapis.com/v0/b/app/o/x?alt=media",
    width: 1280,
    height: 960,
    mimeType: "image/jpeg" as const,
    bytes: 250_000,
    ...overrides,
  };
}

// Convenience: configure a healthy upload (well-sized jpeg) + clean moderation.
function setHealthyUpload() {
  mockFile.getMetadata.mockResolvedValue([
    { size: 250_000, contentType: "image/jpeg" },
  ]);
  mockFile.download.mockResolvedValue([Buffer.from("rawphoto")]);
  mockModerationCreate.mockResolvedValue({ results: [{ flagged: false }] });
}

beforeEach(() => {
  // resetMocks:true has already wiped implementations — rebuild the whole graph.
  mockFile = {
    getMetadata: jest.fn(),
    download: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  mockBucket = { file: jest.fn(() => mockFile) };
  mockModerationCreate = jest.fn();
  sharpChain = {
    rotate: jest.fn(() => sharpChain),
    resize: jest.fn(() => sharpChain),
    jpeg: jest.fn(() => sharpChain),
    // Default to a non-empty fake JPEG so the data-url is well-formed.
    toBuffer: jest.fn().mockResolvedValue(Buffer.from("smalljpeg")),
  };

  (getStorage as jest.Mock).mockReturnValue({ bucket: () => mockBucket });
  (sharp as unknown as jest.Mock).mockReturnValue(sharpChain);
  (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
    moderations: { create: mockModerationCreate },
  }));
});

describe("resolveImageInputs", () => {
  it("returns empty for no images and touches nothing", async () => {
    const result = await resolveImageInputs(UID, [], API_KEY);
    expect(result).toEqual({ ok: true, modelImageUrls: [] });
    expect(getStorage).not.toHaveBeenCalled();
    expect(mockModerationCreate).not.toHaveBeenCalled();
  });

  it("passes klipy images through by previewUrl without storage or moderation", async () => {
    const result = await resolveImageInputs(UID, [klipyImage], API_KEY);
    expect(result).toEqual({
      ok: true,
      modelImageUrls: ["https://static.klipy.com/preview.png"],
    });
    expect(mockBucket.file).not.toHaveBeenCalled();
    expect(mockModerationCreate).not.toHaveBeenCalled();
  });

  it("ingests an upload BY PATH and emits a base64 data url", async () => {
    setHealthyUpload();
    const result = await resolveImageInputs(UID, [uploadImage()], API_KEY);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.modelImageUrls).toHaveLength(1);
    expect(result.modelImageUrls[0]).toMatch(/^data:image\/jpeg;base64,/);
    // Ingestion goes through the Storage path, never the client url.
    expect(mockBucket.file).toHaveBeenCalledWith(OWNED_PATH);
    // EXIF orientation honored, then downscaled + re-encoded to JPEG.
    expect(sharpChain.rotate).toHaveBeenCalled();
    expect(sharpChain.resize).toHaveBeenCalled();
    expect(sharpChain.jpeg).toHaveBeenCalled();
  });

  it("rejects an upload whose path is not owned by the caller (no fetch)", async () => {
    const result = await resolveImageInputs(
      "attacker",
      [uploadImage()],
      API_KEY,
    );
    expect(result).toEqual({ ok: false, reason: "ingest_failed" });
    // Never even opened the object — ownership is checked before any I/O.
    expect(mockBucket.file).not.toHaveBeenCalled();
  });

  it("rejects an upload whose stored size exceeds the cap", async () => {
    mockFile.getMetadata.mockResolvedValue([
      { size: 50 * 1024 * 1024, contentType: "image/jpeg" },
    ]);
    const result = await resolveImageInputs(UID, [uploadImage()], API_KEY);
    expect(result).toEqual({ ok: false, reason: "ingest_failed" });
    expect(mockFile.download).not.toHaveBeenCalled();
  });

  it("rejects an upload with a non-image stored content-type", async () => {
    mockFile.getMetadata.mockResolvedValue([
      { size: 1000, contentType: "application/pdf" },
    ]);
    const result = await resolveImageInputs(UID, [uploadImage()], API_KEY);
    expect(result).toEqual({ ok: false, reason: "ingest_failed" });
    expect(mockFile.download).not.toHaveBeenCalled();
  });

  it("maps a download/decode failure to ingest_failed", async () => {
    mockFile.getMetadata.mockResolvedValue([
      { size: 1000, contentType: "image/jpeg" },
    ]);
    mockFile.download.mockRejectedValue(new Error("object gone"));
    const result = await resolveImageInputs(UID, [uploadImage()], API_KEY);
    expect(result).toEqual({ ok: false, reason: "ingest_failed" });
  });

  it("flags a moderated upload and returns its path for deletion (not the model)", async () => {
    setHealthyUpload();
    mockModerationCreate.mockResolvedValue({ results: [{ flagged: true }] });

    const result = await resolveImageInputs(UID, [uploadImage()], API_KEY);
    expect(result).toEqual({
      ok: false,
      reason: "moderation",
      rejectedPaths: [OWNED_PATH],
    });
  });

  it("fails OPEN when the moderation API itself errors", async () => {
    setHealthyUpload();
    mockModerationCreate.mockRejectedValue(new Error("moderation 500"));

    const result = await resolveImageInputs(UID, [uploadImage()], API_KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.modelImageUrls).toHaveLength(1);
  });

  it("preserves order for a mixed klipy + upload turn", async () => {
    setHealthyUpload();
    const result = await resolveImageInputs(
      UID,
      [klipyImage, uploadImage()],
      API_KEY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.modelImageUrls[0]).toBe("https://static.klipy.com/preview.png");
    expect(result.modelImageUrls[1]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("rejects the whole turn when any one upload is flagged", async () => {
    setHealthyUpload();
    // First clean, second flagged.
    mockModerationCreate
      .mockResolvedValueOnce({ results: [{ flagged: false }] })
      .mockResolvedValueOnce({ results: [{ flagged: true }] });

    const result = await resolveImageInputs(
      UID,
      [uploadImage({ id: "u1", path: OWNED_PATH }), uploadImage({ id: "u2", path: "messageImages/uid-123/conv-1/img-2.jpg" })],
      API_KEY,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("moderation");
    expect(result).toMatchObject({
      rejectedPaths: ["messageImages/uid-123/conv-1/img-2.jpg"],
    });
  });
});

describe("deleteUploadObjects", () => {
  it("deletes each object with ignoreNotFound and never throws", async () => {
    mockFile.delete.mockResolvedValue(undefined);
    await deleteUploadObjects([OWNED_PATH, "messageImages/uid-123/conv-1/b.jpg"]);
    expect(mockBucket.file).toHaveBeenCalledTimes(2);
    expect(mockFile.delete).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it("swallows per-object deletion failures", async () => {
    mockFile.delete.mockRejectedValue(new Error("storage down"));
    await expect(
      deleteUploadObjects([OWNED_PATH]),
    ).resolves.toBeUndefined();
  });
});
