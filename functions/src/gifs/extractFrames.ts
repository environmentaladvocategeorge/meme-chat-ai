import { logger } from "firebase-functions";
import sharp from "sharp";
import { isAllowedImageUrl } from "../messages/messageImage";

// Multimodal models can't read an animated GIF, so on the current user turn we
// decode the GIF into a few still frames (start / middle / end) and feed those
// as images while telling the model it was ONE gif. This module owns that
// decode. It never throws — on any failure it falls back to the single still
// poster, and ultimately to no frames, so a GIF turn degrades but never breaks.

// How many frames we sample from a GIF. Three gives the model start/middle/end
// coverage without tripling image-token cost beyond what's reasonable.
export const GIF_FRAME_COUNT = 3;

// Decoded frames are downscaled and JPEG-encoded before becoming data URLs.
// The model sees them at detail:"low" anyway, so small is fine.
const FRAME_MAX_DIM = 512;
const JPEG_QUALITY = 70;

// Guard rails on the network fetch of the (small) animated asset.
const FETCH_TIMEOUT_MS = 6000;
const MAX_ASSET_BYTES = 12 * 1024 * 1024; // 12 MB

export type ExtractedGifFrames = {
  // Base64 `data:` image URLs, in order (start → end). Empty if extraction
  // failed entirely.
  frames: string[];
  // Total frames detected in the source GIF (0 when unknown / failed).
  frameCount: number;
  // True when we couldn't decode the animation and fell back to the single
  // still poster (one frame) — lets the model note phrase itself honestly.
  degraded: boolean;
};

// Picks up to GIF_FRAME_COUNT distinct frame indices spanning the animation:
// always the first and last, plus the middle. Collapses to fewer when the GIF
// has fewer frames than we want.
export function pickFrameIndices(pages: number): number[] {
  if (pages <= 1) return [0];
  if (pages === 2) return [0, 1];
  const mid = Math.floor(pages / 2);
  return [0, mid, pages - 1];
}

function toDataUrl(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

// Fetches an allowlisted asset with a timeout + size cap. Returns its bytes or
// throws.
async function fetchAsset(url: string): Promise<Buffer> {
  if (!isAllowedImageUrl(url)) {
    throw new Error("gif asset url not allowed");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`gif asset fetch ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_ASSET_BYTES) {
      throw new Error("gif asset too large");
    }
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

// Encodes a single frame (page index) of the source buffer as a downscaled
// JPEG data URL.
async function encodeFrame(source: Buffer, page: number): Promise<string> {
  const out = await sharp(source, { page })
    .resize(FRAME_MAX_DIM, FRAME_MAX_DIM, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return toDataUrl(out);
}

// Fallback: encode the still poster (already a single JPEG frame) as one data
// URL. Returns a degraded one-frame result, or an empty result if even this
// fails.
async function posterFallback(previewUrl: string): Promise<ExtractedGifFrames> {
  try {
    const source = await fetchAsset(previewUrl);
    const out = await sharp(source)
      .resize(FRAME_MAX_DIM, FRAME_MAX_DIM, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    return { frames: [toDataUrl(out)], frameCount: 1, degraded: true };
  } catch (err) {
    logger.warn("[extractGifFrames] poster fallback failed", {
      detail: err instanceof Error ? err.message : "unknown",
    });
    return { frames: [], frameCount: 0, degraded: true };
  }
}

// Decodes `gif.frameSourceUrl` into up to GIF_FRAME_COUNT still frames. Falls
// back to the still poster on any decode/fetch failure. Never throws.
export async function extractGifFrames(gif: {
  frameSourceUrl: string;
  previewUrl: string;
}): Promise<ExtractedGifFrames> {
  let source: Buffer;
  try {
    source = await fetchAsset(gif.frameSourceUrl);
  } catch (err) {
    logger.warn("[extractGifFrames] frame-source fetch failed", {
      detail: err instanceof Error ? err.message : "unknown",
    });
    return posterFallback(gif.previewUrl);
  }

  let pages: number;
  try {
    const meta = await sharp(source).metadata();
    pages = typeof meta.pages === "number" && meta.pages > 0 ? meta.pages : 1;
  } catch (err) {
    logger.warn("[extractGifFrames] metadata read failed", {
      detail: err instanceof Error ? err.message : "unknown",
    });
    return posterFallback(gif.previewUrl);
  }

  const indices = pickFrameIndices(pages);
  try {
    const frames = await Promise.all(
      indices.map((page) => encodeFrame(source, page)),
    );
    return { frames, frameCount: pages, degraded: false };
  } catch (err) {
    logger.warn("[extractGifFrames] frame encode failed", {
      detail: err instanceof Error ? err.message : "unknown",
    });
    return posterFallback(gif.previewUrl);
  }
}
