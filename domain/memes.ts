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

// Image attachment carried on a chat message. Discriminated union on `source`,
// mirroring functions/src/messages/messageImage.ts (the backend is the source
// of truth for validation):
//   - "klipy": a CDN-hosted Klipy meme (fed to the model by URL).
//   - "upload": a user photo compressed + uploaded to Cloud Storage (the
//     backend ingests it by `path`; `url` is the display download URL).
// Common display fields (url/width/height/mimeType/attribution) live on both
// variants so the read-only renderers stay source-agnostic.
export type KlipyMessageImage = {
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
  // Klipy's short human title of the meme (e.g. "Distracted Boyfriend"). Sent to
  // the backend so the model/media decider knows which named meme the user sent
  // instead of guessing from pixels. Optional + additive: older clients omit it
  // and the backend gates every use on its presence, so nothing breaks. Only on
  // Klipy memes — uploads never carry one. Never rendered to the user.
  title?: string;
};

export type UploadedMessageImage = {
  id: string;
  source: "upload";
  // Cloud Storage object path (source of truth for the backend).
  path: string;
  // Display download URL for rendering (never fed to the model).
  url: string;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png";
  // Stored (compressed) byte size.
  bytes: number;
  // Present only for type-compat with the shared renderers; uploads carry no
  // third-party attribution.
  attribution?: never;
};

export type MessageImage = KlipyMessageImage | UploadedMessageImage;

// Max attachments per message. The backend enforces this too (it's the source
// of truth); the client mirror is just for UX gating.
export const MAX_MESSAGE_IMAGES = 3;

// Convert a trending meme into a stage-able message attachment. `url` is the
// full display asset; `previewUrl` is what the backend sends to the model.
export function trendingMemeToMessageImage(meme: TrendingMeme): KlipyMessageImage {
  return {
    id: meme.id,
    source: "klipy",
    url: meme.url,
    previewUrl: meme.previewUrl,
    width: meme.width,
    height: meme.height,
    attribution: "Powered by Klipy",
    memeId: meme.id,
    // Carry Klipy's title through so the backend can tell the model/decider the
    // meme's name. Omitted when Klipy returned no title (keeps old behavior).
    ...(meme.title ? { title: meme.title } : {}),
  };
}
