import { z } from "zod";
import {
  ALLOWED_IMAGE_HOSTS,
  isAllowedImageUrl,
} from "./messageImage";

// A GIF attachment carried on a chat message. Distinct from MessageImage
// because GIFs are handled very differently end to end:
//   - rendered animated in the UI (expo-image), not as a still,
//   - the model can't read an animated GIF, so on the *current* user turn the
//     backend decodes `frameSourceUrl` into 3 still frames (start/middle/end)
//     and feeds those as images while telling the model it was ONE gif,
//   - capped at one per message (separate from the image cap).
// Klipy GIF assets are CDN-hosted on the same host as memes, so the same host
// allowlist applies.
export type MessageGif = {
  id: string;
  source: "klipy-gif";
  // Animated display asset shown in the UI (md webp/gif). CDN-hosted.
  url: string;
  // Still poster frame (jpg) used for thumbnails / blur / list previews.
  previewUrl: string;
  // The small animated asset the backend decodes into sampled frames for the
  // model. Never shown to the user; never sent to the model as-is.
  frameSourceUrl: string;
  width?: number;
  height?: number;
  mimeType?: "image/gif" | "image/webp";
  attribution?: string;
  // Original Klipy id (mirrors `id`; kept for parity with MessageImage.memeId).
  gifId?: string;
  // Short human title of the GIF (Klipy's title, e.g. "rat dancing"). Persisted
  // so the media decider can see which reactions were already used and avoid
  // repeating them. Never rendered to the user.
  title?: string;
};

// Exactly one GIF per user turn. The image cap (MAX_IMAGES) is independent — a
// turn may carry up to MAX_IMAGES memes AND one GIF.
export const MAX_GIFS = 1;

export const ALLOWED_GIF_MIME_TYPES = ["image/gif", "image/webp"] as const;

export const messageGifSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.literal("klipy-gif"),
  url: z.string().refine(isAllowedImageUrl, "Invalid gif URL"),
  previewUrl: z.string().refine(isAllowedImageUrl, "Invalid gif preview URL"),
  frameSourceUrl: z
    .string()
    .refine(isAllowedImageUrl, "Invalid gif frame-source URL"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.enum(ALLOWED_GIF_MIME_TYPES).optional(),
  attribution: z.string().max(256).optional(),
  gifId: z.string().max(128).optional(),
  title: z.string().max(200).optional(),
});

export type ValidatedMessageGif = z.infer<typeof messageGifSchema>;

// URL-free metadata for logging (mirrors summarizeImagesForLog).
export function summarizeGifsForLog(gifs: MessageGif[]) {
  return {
    gifCount: gifs.length,
    source: Array.from(new Set(gifs.map((g) => g.source))),
    hosts: Array.from(
      new Set(
        gifs.flatMap((g) => {
          try {
            return [new URL(g.url).hostname];
          } catch {
            return [];
          }
        }),
      ),
    ),
  };
}

// Re-export so callers that only deal with GIFs don't also import messageImage.
export { ALLOWED_IMAGE_HOSTS as ALLOWED_GIF_HOSTS };
