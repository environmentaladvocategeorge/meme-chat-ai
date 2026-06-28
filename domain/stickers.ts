// Client-side mirror of the lean sticker shapes returned by the
// getTrendingStickers / searchStickers callables. Kept in sync with
// functions/src/stickers/types.ts and functions/src/messages/messageSticker.ts
// (the backend is the source of truth for validation) by convention.
//
// Stickers are a USER-SEND-ONLY feature: the model never sends stickers back.
// Unlike GIFs, a sticker ships a usable still `png` (with alpha), so `previewUrl`
// doubles as the grid poster and the backend's model input — there's no
// frameSourceUrl.

export type TrendingSticker = {
  id: string;
  slug: string;
  title: string;
  // Animated display asset (md webp/gif). CDN-hosted.
  url: string;
  width: number;
  height: number;
  // Still png frame (with alpha) for grids / lists / blur AND the model input.
  previewUrl: string;
  // Tiny inline base64 placeholder for progressive loading, or null.
  blurPreview: string | null;
};

export type TrendingStickersResult = {
  stickers: TrendingSticker[];
  page: number;
  perPage: number;
  hasNext: boolean;
};

// A sticker attachment carried on a chat message. Mirrors
// functions/src/messages/messageSticker.ts. Rendered animated (transparent) in
// the UI; the backend feeds the model the static png still.
export type MessageSticker = {
  id: string;
  source: "klipy-sticker";
  // Animated display asset shown in the UI.
  url: string;
  // Still png frame (with alpha) for thumbnails / blur / model input.
  previewUrl: string;
  width?: number;
  height?: number;
  mimeType?: "image/png" | "image/gif" | "image/webp";
  attribution?: string;
  stickerId?: string;
  // Klipy's short human title (e.g. "rawr dinosaur"). Sent to the backend so the
  // reply model knows what was sent. Optional + additive. Never rendered.
  title?: string;
  // The search term the user typed to find this sticker (absent when picked from
  // trending). Sent to the backend for extra reaction context. Never rendered.
  searchQuery?: string;
};

// Up to 3 stickers per message. The backend enforces this too (it's the source
// of truth); the client mirror is just for UX gating. Independent of the meme
// cap (MAX_MESSAGE_IMAGES) and the GIF cap (MAX_MESSAGE_GIFS) — a turn may carry
// memes AND a GIF AND up to 3 stickers.
export const MAX_MESSAGE_STICKERS = 3;

// Convert a trending sticker into a stage-able message attachment. `searchQuery`
// is stamped when the sticker was picked from a search (so the model knows what
// the user was looking for); omitted for trending picks.
export function trendingStickerToMessageSticker(
  sticker: TrendingSticker,
  searchQuery?: string,
): MessageSticker {
  const query = searchQuery?.trim();
  return {
    id: sticker.id,
    source: "klipy-sticker",
    url: sticker.url,
    previewUrl: sticker.previewUrl,
    width: sticker.width,
    height: sticker.height,
    attribution: "Powered by Klipy",
    stickerId: sticker.id,
    // Carry Klipy's title through so the backend can tell the model the sticker's
    // name. Omitted when Klipy returned no title.
    ...(sticker.title ? { title: sticker.title } : {}),
    ...(query ? { searchQuery: query } : {}),
  };
}
