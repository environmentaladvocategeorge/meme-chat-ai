import {
  isAllowedImageUrl,
  isOwnedMessageImagePath,
  isValidUploadPath,
  MAX_UPLOAD_IMAGE_BYTES,
  MAX_UPLOAD_IMAGE_DIMENSION,
  messageImageSchema,
  summarizeImagesForLog,
  type MessageImage,
} from "../messageImage";

// A valid, owned upload path used across the upload cases.
const OWNED_PATH = "messageImages/uid-123/conv-1/img-abc.jpg";

describe("messageImage", () => {
  describe("isAllowedImageUrl", () => {
    it("accepts an https url on the allowlisted Klipy host", () => {
      expect(isAllowedImageUrl("https://static.klipy.com/meme/abc.png")).toBe(
        true,
      );
    });

    it("rejects non-https urls", () => {
      expect(isAllowedImageUrl("http://static.klipy.com/x.png")).toBe(false);
    });

    it("rejects urls on other hosts", () => {
      expect(isAllowedImageUrl("https://evil.example.com/x.png")).toBe(false);
    });

    it("rejects garbage", () => {
      expect(isAllowedImageUrl("not a url")).toBe(false);
    });
  });

  describe("isValidUploadPath", () => {
    it("accepts the canonical three-segment path", () => {
      expect(isValidUploadPath(OWNED_PATH)).toBe(true);
    });

    it("rejects a path under the wrong prefix", () => {
      expect(isValidUploadPath("profiles/uid-123/conv-1/img.jpg")).toBe(false);
    });

    it("rejects a path with too few segments", () => {
      expect(isValidUploadPath("messageImages/uid-123/img.jpg")).toBe(false);
    });

    it("rejects a path with an extra (nested) segment", () => {
      expect(
        isValidUploadPath("messageImages/uid-123/conv-1/sub/img.jpg"),
      ).toBe(false);
    });

    it("rejects an over-long path", () => {
      const huge = `messageImages/uid/conv/${"a".repeat(600)}.jpg`;
      expect(isValidUploadPath(huge)).toBe(false);
    });
  });

  describe("isOwnedMessageImagePath", () => {
    it("accepts a path under the caller's namespace", () => {
      expect(isOwnedMessageImagePath("uid-123", OWNED_PATH)).toBe(true);
    });

    it("rejects a path under another user's namespace", () => {
      expect(isOwnedMessageImagePath("attacker", OWNED_PATH)).toBe(false);
    });

    it("rejects a structurally invalid path even for the right uid", () => {
      expect(
        isOwnedMessageImagePath("uid-123", "messageImages/uid-123/img.jpg"),
      ).toBe(false);
    });

    it("is not fooled by a uid that is a prefix of another", () => {
      // "uid-1" must not match a path owned by "uid-123".
      expect(isOwnedMessageImagePath("uid-1", OWNED_PATH)).toBe(false);
    });
  });

  describe("messageImageSchema — klipy variant", () => {
    it("accepts a well-formed klipy image", () => {
      const image: MessageImage = {
        id: "klipy-1",
        source: "klipy",
        url: "https://static.klipy.com/full.png",
        previewUrl: "https://static.klipy.com/preview.png",
      };
      expect(messageImageSchema.safeParse(image).success).toBe(true);
    });

    it("rejects a klipy image with a disallowed host", () => {
      const image = {
        id: "klipy-1",
        source: "klipy",
        url: "https://evil.example.com/full.png",
        previewUrl: "https://evil.example.com/preview.png",
      };
      expect(messageImageSchema.safeParse(image).success).toBe(false);
    });

    it("rejects an unknown source literal", () => {
      const image = {
        id: "x",
        source: "tenor",
        url: "https://static.klipy.com/full.png",
        previewUrl: "https://static.klipy.com/preview.png",
      };
      expect(messageImageSchema.safeParse(image).success).toBe(false);
    });
  });

  describe("messageImageSchema — upload variant", () => {
    const validUpload = {
      id: "img-abc",
      source: "upload" as const,
      path: OWNED_PATH,
      url: "https://firebasestorage.googleapis.com/v0/b/app/o/x?alt=media",
      width: 1280,
      height: 960,
      mimeType: "image/jpeg" as const,
      bytes: 250_000,
    };

    it("accepts a well-formed upload image", () => {
      expect(messageImageSchema.safeParse(validUpload).success).toBe(true);
    });

    it("rejects an upload with a structurally invalid path", () => {
      const bad = { ...validUpload, path: "messageImages/uid/img.jpg" };
      expect(messageImageSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects a non-https display url", () => {
      const bad = { ...validUpload, url: "http://insecure.example.com/x.jpg" };
      expect(messageImageSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects an unsupported mime type (no webp for uploads)", () => {
      const bad = { ...validUpload, mimeType: "image/webp" };
      expect(messageImageSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects bytes over the cap", () => {
      const bad = { ...validUpload, bytes: MAX_UPLOAD_IMAGE_BYTES + 1 };
      expect(messageImageSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects dimensions over the cap", () => {
      const bad = { ...validUpload, width: MAX_UPLOAD_IMAGE_DIMENSION + 1 };
      expect(messageImageSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects an upload missing required fields", () => {
      const { width: _omit, ...bad } = validUpload;
      void _omit;
      expect(messageImageSchema.safeParse(bad).success).toBe(false);
    });
  });

  describe("summarizeImagesForLog", () => {
    it("collapses klipy images to safe metadata (host, no urls)", () => {
      const images: MessageImage[] = [
        {
          id: "1",
          source: "klipy",
          url: "https://static.klipy.com/a.png",
          previewUrl: "https://static.klipy.com/a-preview.png",
        },
      ];
      const summary = summarizeImagesForLog(images);
      expect(summary.imageCount).toBe(1);
      expect(summary.hosts).toEqual(["static.klipy.com"]);
      expect(summary.source).toEqual(["klipy"]);
    });

    it("never leaks upload paths or urls (no host emitted for uploads)", () => {
      const images: MessageImage[] = [
        {
          id: "u1",
          source: "upload",
          path: OWNED_PATH,
          url: "https://firebasestorage.googleapis.com/secret",
          width: 100,
          height: 100,
          mimeType: "image/jpeg",
          bytes: 1000,
        },
      ];
      const summary = summarizeImagesForLog(images);
      expect(summary.imageCount).toBe(1);
      expect(summary.source).toEqual(["upload"]);
      // Hosts are derived from klipy previewUrls only; uploads contribute none.
      expect(summary.hosts).toEqual([]);
      expect(JSON.stringify(summary)).not.toContain("firebasestorage");
      expect(JSON.stringify(summary)).not.toContain("messageImages");
    });

    it("reports both sources for a mixed turn", () => {
      const images: MessageImage[] = [
        {
          id: "1",
          source: "klipy",
          url: "https://static.klipy.com/a.png",
          previewUrl: "https://static.klipy.com/a-preview.png",
        },
        {
          id: "u1",
          source: "upload",
          path: OWNED_PATH,
          url: "https://firebasestorage.googleapis.com/x",
          width: 100,
          height: 100,
          mimeType: "image/jpeg",
          bytes: 1000,
        },
      ];
      const summary = summarizeImagesForLog(images);
      expect(summary.imageCount).toBe(2);
      expect(new Set(summary.source)).toEqual(new Set(["klipy", "upload"]));
    });
  });
});
