// Client-side mirror of the lean meme shape returned by the getTrendingMemes
// callable. Kept in sync with functions/src/memes/types.ts by convention.

export type TrendingMeme = {
  id: string;
  slug: string;
  title: string;
  // Best display asset (CDN-hosted webp, png fallback).
  url: string;
  width: number;
  height: number;
  // Smaller asset for grids / lists.
  previewUrl: string;
  // Tiny inline base64 placeholder for progressive loading, or null.
  blurPreview: string | null;
};

export type TrendingMemesResult = {
  memes: TrendingMeme[];
  page: number;
  perPage: number;
  hasNext: boolean;
};

export const CONTENT_FILTERS = ["off", "low", "medium", "high"] as const;
export type ContentFilter = (typeof CONTENT_FILTERS)[number];

// Generic image attachment carried on a chat message. Mirrors
// functions/src/messages/messageImage.ts (the backend is the source of truth
// for validation). This release only supports `source: "klipy"`.
export type MessageImage = {
  id: string;
  source: "klipy";
  // Display/full asset URL shown in the UI.
  url: string;
  // Smaller asset URL the backend feeds to the model.
  previewUrl: string;
  width?: number;
  height?: number;
  mimeType?: "image/png" | "image/jpeg" | "image/webp";
  attribution?: string;
  memeId?: string;
};

// Max attachments per message. The backend enforces this too (it's the source
// of truth); the client mirror is just for UX gating.
export const MAX_MESSAGE_IMAGES = 3;

// Convert a trending meme into a stage-able message attachment. `url` is the
// full display asset; `previewUrl` is what the backend sends to the model.
export function trendingMemeToMessageImage(meme: TrendingMeme): MessageImage {
  return {
    id: meme.id,
    source: "klipy",
    url: meme.url,
    previewUrl: meme.previewUrl,
    width: meme.width,
    height: meme.height,
    attribution: "Powered by Klipy",
    memeId: meme.id,
  };
}
