import { z } from "zod";

// A generic image attachment carried on a chat message. The shape is
// intentionally future-proof (arbitrary uploads, multiple providers), but this
// release only accepts `source: "klipy"`. Klipy assets are already CDN-hosted,
// so we input them to the model by URL — no server-side fetch/re-encode yet
// (that's the conditional Phase 4 fallback).
export type MessageImage = {
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

// Max image attachments per user turn. Keeps per-turn image-token cost bounded
// (each low-detail image is ~IMAGE_TOKENS_LOW prompt tokens).
export const MAX_IMAGES = 3;

// Bound URL length so a malicious client can't push pathological payloads
// through validation/persistence.
export const MAX_IMAGE_URL_LENGTH = 2048;

// Hostname allowlist. Only Klipy's static CDN for now. Broaden deliberately —
// every host added here is a host the model is allowed to fetch on our behalf.
export const ALLOWED_IMAGE_HOSTS = new Set(["static.klipy.com"]);

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

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

export const messageImageSchema = z.object({
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

export type ValidatedMessageImage = z.infer<typeof messageImageSchema>;

// Collapse a list of attachments into safe, URL-free metadata for logging.
export function summarizeImagesForLog(images: MessageImage[]) {
  return {
    imageCount: images.length,
    source: Array.from(new Set(images.map((i) => i.source))),
    hosts: Array.from(
      new Set(
        images.flatMap((i) => {
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
