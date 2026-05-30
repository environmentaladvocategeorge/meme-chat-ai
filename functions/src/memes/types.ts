// Lean meme shape returned to the client. Klipy's raw payload is large and
// nested (every size × format permutation); we collapse it to just what the
// UI needs to render a meme in a grid and full size.
export type TrendingMeme = {
  // Klipy ids are numbers; we stringify so they survive JSON / Firestore /
  // React keys without precision loss.
  id: string;
  slug: string;
  title: string;
  // Best display asset (md webp, falling back to md png). Already CDN-hosted.
  url: string;
  width: number;
  height: number;
  // Smaller asset for grids / lists (sm webp, fallback sm png).
  previewUrl: string;
  // Tiny inline base64 placeholder for progressive loading. null if Klipy
  // omitted it.
  blurPreview: string | null;
};

export type TrendingMemesResult = {
  memes: TrendingMeme[];
  page: number;
  perPage: number;
  hasNext: boolean;
};

// Accepted Klipy content-safety levels. Mirrors the API's `content_filter`.
export const CONTENT_FILTERS = ["off", "low", "medium", "high"] as const;
export type ContentFilter = (typeof CONTENT_FILTERS)[number];
