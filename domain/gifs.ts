// Client-side mirror of the lean GIF shapes returned by the getTrendingGifs /
// searchGifs callables. Kept in sync with functions/src/gifs/types.ts and
// functions/src/messages/messageGif.ts (the backend is the source of truth for
// validation) by convention.

export type TrendingGif = {
  id: string;
  slug: string;
  title: string;
  // Animated display asset (md webp/gif). CDN-hosted.
  url: string;
  width: number;
  height: number;
  // Still poster frame for grids / lists / blur.
  previewUrl: string;
  // Small animated asset the backend decodes into frames for the model.
  frameSourceUrl: string;
  // Tiny inline base64 placeholder for progressive loading, or null.
  blurPreview: string | null;
};

export type TrendingGifsResult = {
  gifs: TrendingGif[];
  page: number;
  perPage: number;
  hasNext: boolean;
};

// A GIF attachment carried on a chat message. Mirrors
// functions/src/messages/messageGif.ts. Rendered animated in the UI; the
// backend splits it into still frames for the model on the current turn.
export type MessageGif = {
  id: string;
  source: "klipy-gif";
  // Animated display asset shown in the UI.
  url: string;
  // Still poster frame for thumbnails / blur.
  previewUrl: string;
  // Small animated asset the backend decodes into frames.
  frameSourceUrl: string;
  width?: number;
  height?: number;
  mimeType?: "image/gif" | "image/webp";
  attribution?: string;
  gifId?: string;
  // Klipy's short human title of the GIF (e.g. "rat dancing"). Sent to the
  // backend so the model/media decider knows which named meme the user sent
  // instead of guessing from frames. Optional + additive: older clients omit it
  // and the backend gates every use on its presence, so nothing breaks. Only
  // set for Klipy GIFs — uploads never carry one. Never rendered to the user.
  title?: string;
};

// Exactly one GIF per message. The backend enforces this too (it's the source
// of truth); the client mirror is just for UX gating. Independent of the meme
// cap (MAX_MESSAGE_IMAGES) — a turn may carry memes AND one GIF.
export const MAX_MESSAGE_GIFS = 1;

// Convert a trending GIF into a stage-able message attachment.
export function trendingGifToMessageGif(gif: TrendingGif): MessageGif {
  return {
    id: gif.id,
    source: "klipy-gif",
    url: gif.url,
    previewUrl: gif.previewUrl,
    frameSourceUrl: gif.frameSourceUrl,
    width: gif.width,
    height: gif.height,
    attribution: "Powered by Klipy",
    gifId: gif.id,
    // Carry Klipy's title through so the backend can tell the model/decider the
    // GIF's name. Omitted when Klipy returned no title (keeps old behavior).
    ...(gif.title ? { title: gif.title } : {}),
  };
}
