import { z } from "zod";
import { ALLOWED_IMAGE_HOSTS, isAllowedImageUrl } from "./messageImage";

// A sticker attachment carried on a chat message. Distinct from MessageImage
// and MessageGif because stickers are a user-send-only feature:
//   - rendered animated (transparent) in the UI (expo-image),
//   - UNLIKE GIFs, a sticker ships a usable still `png`, so on the *current*
//     user turn the backend feeds the model that static png directly (no frame
//     extraction) — `previewUrl` doubles as the model input,
//   - the model NEVER sends stickers back (no get_sticker tool, decider never
//     picks them); stickers are input-only so the reply can react in-character,
//   - capped at MAX_STICKERS per message (independent of the image / GIF caps),
//     and combinable with memes + a GIF in one turn.
// Klipy sticker assets are CDN-hosted on the same host as memes/GIFs, so the
// same host allowlist applies.
export type MessageSticker = {
  id: string;
  source: "klipy-sticker";
  // Animated display asset shown in the UI (md webp/gif). CDN-hosted.
  url: string;
  // Still png frame used for thumbnails / blur / list previews AND fed to the
  // model as the (low-detail) image input. Transparent (alpha) png.
  previewUrl: string;
  width?: number;
  height?: number;
  mimeType?: "image/png" | "image/gif" | "image/webp";
  attribution?: string;
  // Original Klipy id (mirrors `id`; kept for parity with MessageGif.gifId).
  stickerId?: string;
  // Short human title of the sticker (Klipy's title, e.g. "rawr dinosaur").
  // Persisted + surfaced to the reply model so it knows what was sent. Never
  // rendered to the user.
  title?: string;
  // The search term the user typed when they picked this sticker (absent when
  // picked from trending). Surfaced to the reply model for extra reaction
  // context ("they searched 'rawr'"). Never rendered to the user.
  searchQuery?: string;
};

// Up to 3 stickers per user turn. Independent of the image cap (MAX_IMAGES) and
// the GIF cap (MAX_GIFS) — a turn may carry memes AND a GIF AND up to 3 stickers.
export const MAX_STICKERS = 3;

export const ALLOWED_STICKER_MIME_TYPES = [
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export const messageStickerSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.literal("klipy-sticker"),
  url: z.string().refine(isAllowedImageUrl, "Invalid sticker URL"),
  previewUrl: z
    .string()
    .refine(isAllowedImageUrl, "Invalid sticker preview URL"),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.enum(ALLOWED_STICKER_MIME_TYPES).optional(),
  attribution: z.string().max(256).optional(),
  stickerId: z.string().max(128).optional(),
  title: z.string().max(200).optional(),
  searchQuery: z.string().max(100).optional(),
});

export type ValidatedMessageSticker = z.infer<typeof messageStickerSchema>;

// URL-free metadata for logging (mirrors summarizeGifsForLog).
export function summarizeStickersForLog(stickers: MessageSticker[]) {
  return {
    stickerCount: stickers.length,
    source: Array.from(new Set(stickers.map((s) => s.source))),
    hosts: Array.from(
      new Set(
        stickers.flatMap((s) => {
          try {
            return [new URL(s.url).hostname];
          } catch {
            return [];
          }
        }),
      ),
    ),
  };
}

// Re-export so callers that only deal with stickers don't also import
// messageImage.
export { ALLOWED_IMAGE_HOSTS as ALLOWED_STICKER_HOSTS };
