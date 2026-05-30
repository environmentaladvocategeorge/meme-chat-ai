// Lean GIF shape returned to the client. Klipy's raw GIF payload mirrors the
// meme payload (every size × format permutation) but adds animated formats
// (gif/webp/mp4/webm) plus a still `jpg` poster. We collapse it to: an animated
// display asset, a still poster for grids/blur, and the small animated asset
// the backend decodes into frames for the model.
export type TrendingGif = {
  // Klipy ids are numbers; stringified so they survive JSON / Firestore / React
  // keys without precision loss.
  id: string;
  slug: string;
  title: string;
  // Animated display asset (md webp, falling back to md gif / hd). CDN-hosted.
  url: string;
  width: number;
  height: number;
  // Still poster frame (sm jpg, fallback xs/md jpg) for grids / lists / blur.
  previewUrl: string;
  // Small animated asset (sm webp, fallback sm gif) the backend decodes into
  // sampled frames. Never displayed; never sent to the model directly.
  frameSourceUrl: string;
  // Tiny inline base64 placeholder for progressive loading. null if absent.
  blurPreview: string | null;
};

export type TrendingGifsResult = {
  gifs: TrendingGif[];
  page: number;
  perPage: number;
  hasNext: boolean;
};
