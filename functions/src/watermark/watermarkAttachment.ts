import { logger } from "firebase-functions";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import { isAllowedImageUrl } from "../messages/messageImage";
import { compositeWatermark } from "./watermark";

// Guard rails on the asset fetch.
const FETCH_TIMEOUT_MS = 8000;
const MAX_ASSET_BYTES = 16 * 1024 * 1024; // 16 MB

const requestSchema = z.object({
  // The still asset to watermark: a meme's display url, or a GIF's poster
  // (previewUrl). Must be an allowlisted KLIPY CDN https url.
  url: z.string().refine(isAllowedImageUrl, "Invalid asset URL"),
});

export type WatermarkResult = {
  // Base64-encoded PNG the client decodes and saves to the device gallery.
  dataBase64: string;
  mimeType: "image/png";
};

async function fetchAsset(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`asset fetch ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_ASSET_BYTES) {
      throw new Error("asset too large");
    }
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

// Core, extracted from the onCall wrapper so the contract is unit-testable.
// Fetches the (allowlisted) asset, composites the KLIPY watermark, and returns
// PNG bytes as base64. Maps failures to clean HttpsErrors.
export async function watermarkAttachmentImpl(
  uid: string | undefined,
  data: unknown,
): Promise<WatermarkResult> {
  if (!uid) {
    throw new HttpsError("unauthenticated", "auth-required");
  }

  const parsed = requestSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "invalid-request");
  }

  let source: Buffer;
  try {
    source = await fetchAsset(parsed.data.url);
  } catch (err) {
    logger.warn("[watermarkAttachment] asset fetch failed", {
      detail: err instanceof Error ? err.message : "unknown",
    });
    throw new HttpsError("unavailable", "asset-unavailable");
  }

  try {
    const out = await compositeWatermark(source);
    return { dataBase64: out.toString("base64"), mimeType: "image/png" };
  } catch (err) {
    logger.error("[watermarkAttachment] composite failed", { err });
    throw new HttpsError("internal", "watermark-failed");
  }
}

export const watermarkAttachment = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "512MiB",
  },
  async (req) => watermarkAttachmentImpl(req.auth?.uid, req.data),
);
