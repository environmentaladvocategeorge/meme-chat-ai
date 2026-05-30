import { z } from "zod";

// An image attachment carried on a chat message. Two sources, modeled as a
// discriminated union on `source`:
//
//   - "klipy": a CDN-hosted Klipy meme. Already public on Klipy's static CDN,
//     so the model is fed its `previewUrl` by URL (no server fetch/re-encode).
//   - "upload": a user-captured/picked photo the client compressed and uploaded
//     to Cloud Storage. The Storage `path` is the source of truth: the backend
//     re-validates ownership and ingests the bytes BY PATH via the Admin SDK —
//     it never trusts `url` for model input. `url` is a display download URL for
//     client rendering only.
//
// Firestore stores only this lean metadata (never image bytes / base64). The
// small "model copy" of an upload is generated transiently server-side.

export type KlipyMessageImage = {
  id: string;
  source: "klipy";
  // Display/full asset URL shown in the UI.
  url: string;
  // Smaller asset URL fed to the model as the image input.
  previewUrl: string;
  width?: number;
  height?: number;
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  attribution?: string;
  memeId?: string;
};

export type UploadedMessageImage = {
  id: string;
  source: "upload";
  // Cloud Storage object path — the source of truth for backend ingestion.
  // Always messageImages/{uid}/{conversationId}/{imageId}. The handler
  // re-checks the {uid} segment against the caller; the zod schema can't (uid
  // isn't known at parse time).
  path: string;
  // Display download URL (client rendering only; NEVER trusted for model input
  // or fetched server-side — ingestion goes through `path`).
  url: string;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
  // Stored (compressed) byte size, for logging + a defense-in-depth cap.
  bytes: number;
};

export type MessageImage = KlipyMessageImage | UploadedMessageImage;

// Max image attachments per user turn. Keeps per-turn image-token cost bounded
// (each low-detail image is ~IMAGE_TOKENS_LOW prompt tokens).
export const MAX_IMAGES = 3;

// Bound URL length so a malicious client can't push pathological payloads
// through validation/persistence.
export const MAX_IMAGE_URL_LENGTH = 2048;

// Hostname allowlist for Klipy URLs the model may be fed directly. Only Klipy's
// static CDN. Deliberately NOT broadened for uploads — uploads are ingested by
// Storage path via the Admin SDK, so no host ever needs to be added here.
export const ALLOWED_IMAGE_HOSTS = new Set(["static.klipy.com"]);

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

// ----- Upload constraints (re-enforced in the handler regardless of client) --

// Top-level Storage folder for user-uploaded chat photos. Mirrored in
// storage.rules.
export const MESSAGE_IMAGE_STORAGE_PREFIX = "messageImages";

// Hard cap on a stored (already client-compressed) upload. Mirrors
// storage.rules. 8 MB is generous for a ~1280px JPEG and bounds the Admin SDK
// download + sharp decode.
export const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;

// Only real photo formats for uploads (no webp — capture/pick yields jpeg/png).
export const UPLOAD_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;

// Sanity bound on declared dimensions so a client can't claim absurd sizes.
export const MAX_UPLOAD_IMAGE_DIMENSION = 8192;

// messageImages/{uid}/{conversationId}/{imageId} — three path segments after
// the prefix, none containing a slash, bounded length. The {uid} segment is
// matched against the caller in the handler (see isOwnedMessageImagePath).
const UPLOAD_PATH_RE = new RegExp(
  `^${MESSAGE_IMAGE_STORAGE_PREFIX}/[^/]{1,128}/[^/]{1,128}/[^/]{1,200}$`,
);

export function isValidUploadPath(value: string): boolean {
  return value.length <= 512 && UPLOAD_PATH_RE.test(value);
}

// Ownership gate used in the handler once the caller's uid is known: the path's
// uid segment must equal the caller. Defends against a client uploading under
// (or referencing) another user's namespace.
export function isOwnedMessageImagePath(uid: string, path: string): boolean {
  return (
    isValidUploadPath(path) &&
    path.startsWith(`${MESSAGE_IMAGE_STORAGE_PREFIX}/${uid}/`)
  );
}

// HTTPS + allowlisted host + bounded length. Anything else is rejected so the
// model never receives an attacker-controlled or arbitrary-origin URL.
export function isAllowedImageUrl(value: string): boolean {
  try {
    if (value.length > MAX_IMAGE_URL_LENGTH) return false;
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_IMAGE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

// Display URL for an UPLOAD. Not fed to the model and not fetched server-side,
// so we only need it to be a bounded https URL (Firebase download URLs live on
// firebasestorage.googleapis.com / *.firebasestorage.app — not worth pinning).
function isBoundedHttpsUrl(value: string): boolean {
  try {
    if (value.length > MAX_IMAGE_URL_LENGTH) return false;
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const klipyImageSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.literal("klipy"),
  url: z.string().refine(isAllowedImageUrl, "Invalid image URL"),
  previewUrl: z.string().refine(isAllowedImageUrl, "Invalid preview image URL"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.enum(ALLOWED_IMAGE_MIME_TYPES).optional(),
  attribution: z.string().max(256).optional(),
  memeId: z.string().max(128).optional(),
});

const uploadImageSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.literal("upload"),
  path: z.string().refine(isValidUploadPath, "Invalid image path"),
  url: z.string().refine(isBoundedHttpsUrl, "Invalid image URL"),
  width: z.number().int().positive().max(MAX_UPLOAD_IMAGE_DIMENSION),
  height: z.number().int().positive().max(MAX_UPLOAD_IMAGE_DIMENSION),
  mimeType: z.enum(UPLOAD_IMAGE_MIME_TYPES),
  bytes: z.number().int().positive().max(MAX_UPLOAD_IMAGE_BYTES),
});

export const messageImageSchema = z.discriminatedUnion("source", [
  klipyImageSchema,
  uploadImageSchema,
]);

export type ValidatedMessageImage = z.infer<typeof messageImageSchema>;

// Collapse a list of attachments into safe, URL-free metadata for logging.
// Never logs full asset URLs or Storage paths.
export function summarizeImagesForLog(images: MessageImage[]) {
  return {
    imageCount: images.length,
    source: Array.from(new Set(images.map((i) => i.source))),
    hosts: Array.from(
      new Set(
        images.flatMap((i) => {
          if (i.source !== "klipy") return [];
          try {
            return [new URL(i.previewUrl).hostname];
          } catch {
            return [];
          }
        }),
      ),
    ),
    mimeTypes: Array.from(
      new Set(images.flatMap((i) => (i.mimeType ? [i.mimeType] : []))),
    ),
  };
}
