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
