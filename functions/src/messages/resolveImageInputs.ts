import { getStorage } from "firebase-admin/storage";
import { logger } from "firebase-functions";
import OpenAI from "openai";
import sharp from "sharp";
import {
  isOwnedMessageImagePath,
  MAX_UPLOAD_IMAGE_BYTES,
  UPLOAD_IMAGE_MIME_TYPES,
  type MessageImage,
} from "./messageImage";

// Resolves the current turn's image attachments into the URLs fed to the model,
// applying the upload ingestion + moderation pipeline. This is the security
// boundary for user uploads:
//
//   - klipy images are curated/CDN-hosted → passed through by previewUrl, no
//     fetch, no moderation.
//   - upload images are ingested BY STORAGE PATH via the Admin SDK (never by
//     the client-supplied url), re-validated (ownership, content-type, size),
//     downscaled with sharp into a small JPEG "model copy", run through a
//     lightweight moderation check, and emitted as a base64 data URL.
//
// Note: the stored display copy is the client's ~50% compression; this extra
// downscale is purely the model copy. At detail:"low" the model bills a flat
// per-image token cost regardless, so this saves bandwidth, not tokens.

// The model sees images at detail:"low" (downsampled to ~512px), so a small
// JPEG is all it needs.
const MODEL_IMAGE_MAX_DIM = 512;
const MODEL_IMAGE_JPEG_QUALITY = 45;

// OpenAI's multimodal moderation model. Accepts image_url inputs.
const MODERATION_MODEL = "omni-moderation-latest";

export type ResolveImageInputsResult =
  | { ok: true; modelImageUrls: string[] }
  // A user upload tripped the moderation gate. `rejectedPaths` are the Storage
  // objects to delete; the turn must not proceed.
  | { ok: false; reason: "moderation"; rejectedPaths: string[] }
  // An upload couldn't be ingested (missing object, decode failure, etc.).
  | { ok: false; reason: "ingest_failed" };

function toDataUrl(buffer: Buffer): string {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

// Downloads an owned upload by path and re-encodes it as a small JPEG model
// copy. Re-validates ownership + content-type + size server-side; the client's
// checks are UX-only. Throws on any failure (caller maps to ingest_failed).
async function ingestUpload(
  uid: string,
  image: Extract<MessageImage, { source: "upload" }>,
): Promise<Buffer> {
  if (!isOwnedMessageImagePath(uid, image.path)) {
    throw new Error("upload path not owned by caller");
  }

  const file = getStorage().bucket().file(image.path);

  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  if (size <= 0 || size > MAX_UPLOAD_IMAGE_BYTES) {
    throw new Error(`upload size out of bounds: ${size}`);
  }
  const contentType = metadata.contentType ?? "";
  if (!(UPLOAD_IMAGE_MIME_TYPES as readonly string[]).includes(contentType)) {
    throw new Error(`upload content-type not allowed: ${contentType}`);
  }

  const [source] = await file.download();
  return sharp(source, { failOn: "none" })
    .rotate() // honor EXIF orientation before stripping metadata
    .resize(MODEL_IMAGE_MAX_DIM, MODEL_IMAGE_MAX_DIM, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: MODEL_IMAGE_JPEG_QUALITY })
    .toBuffer();
}

// Lightweight moderation gate on a single (small) image data URL. Returns true
// when the image is flagged. On any moderation API failure we FAIL OPEN (return
// false) and log — a moderation outage shouldn't block all image chat — while
// the per-IP rate limit + auth gate still apply.
async function isFlagged(apiKey: string, dataUrl: string): Promise<boolean> {
  try {
    const client = new OpenAI({ apiKey });
    const res = await client.moderations.create({
      model: MODERATION_MODEL,
      input: [{ type: "image_url", image_url: { url: dataUrl } }],
    });
    return res.results.some((r) => r.flagged);
  } catch (err) {
    logger.warn("[resolveImageInputs] moderation check failed; failing open", {
      detail: err instanceof Error ? err.message : "unknown",
    });
    return false;
  }
}

// Resolves all of the current turn's images to model-ready URLs, in order.
// `openaiApiKey` powers the moderation check for uploads.
export async function resolveImageInputs(
  uid: string,
  images: MessageImage[],
  openaiApiKey: string,
): Promise<ResolveImageInputsResult> {
  if (images.length === 0) return { ok: true, modelImageUrls: [] };

  const modelImageUrls: string[] = [];
  const rejectedPaths: string[] = [];

  for (const image of images) {
    if (image.source === "klipy") {
      modelImageUrls.push(image.previewUrl);
      continue;
    }

    let modelCopy: Buffer;
    try {
      modelCopy = await ingestUpload(uid, image);
    } catch (err) {
      logger.error("[resolveImageInputs] upload ingest failed", {
        detail: err instanceof Error ? err.message : "unknown",
      });
      return { ok: false, reason: "ingest_failed" };
    }

    const dataUrl = toDataUrl(modelCopy);
    if (await isFlagged(openaiApiKey, dataUrl)) {
      rejectedPaths.push(image.path);
      continue;
    }
    modelImageUrls.push(dataUrl);
  }

  if (rejectedPaths.length > 0) {
    return { ok: false, reason: "moderation", rejectedPaths };
  }
  return { ok: true, modelImageUrls };
}

// Best-effort deletion of rejected/abandoned upload objects. Never throws.
export async function deleteUploadObjects(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (path) => {
      try {
        await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
      } catch (err) {
        logger.warn("[resolveImageInputs] failed to delete upload object", {
          detail: err instanceof Error ? err.message : "unknown",
        });
      }
    }),
  );
}
