// Lean sticker shape returned to the client. Klipy's raw sticker payload mirrors
// the GIF payload (every size × format permutation) — animated formats
// (gif/webp) plus a still `png` (with alpha). We collapse it to: an animated
// display asset, and a still png poster that doubles as the model input.
//
// The key divergence from GIFs: stickers ship a usable still `png`, so we feed
// the model that static image directly (no frame extraction). Hence there is no
// `frameSourceUrl` here — `previewUrl` is both the grid poster and the model
// input.
export type TrendingSticker = {
  // Klipy ids are numbers; stringified so they survive JSON / Firestore / React
  // keys without precision loss.
  id: string;
  slug: string;
  title: string;
  // Animated display asset (md webp, falling back to md gif / hd). CDN-hosted.
  url: string;
  width: number;
  height: number;
  // Still png frame (sm png, fallback md/xs png) for grids / lists / blur AND
  // as the low-detail image fed to the model. Transparent (alpha) png.
  previewUrl: string;
  // Tiny inline base64 placeholder for progressive loading. null if absent.
  blurPreview: string | null;
};

export type TrendingStickersResult = {
  stickers: TrendingSticker[];
  page: number;
  perPage: number;
  hasNext: boolean;
};
