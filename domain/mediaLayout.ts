// mediaLayout
//
// Pure, framework-free geometry for laying out meme/GIF media. Memes and GIFs
// arrive from Klipy with intrinsic pixel dimensions (or none), and the UI scales
// them into two fixed contexts: square-ish chat-bubble attachments and a fixed-
// height horizontal picker strip. That scaling is fiddly, aspect-ratio-sensitive
// arithmetic that used to be copy-pasted across three components — so it lives
// here as testable functions instead. No React, no react-native imports.

// Any media carrying optional intrinsic dimensions. Klipy memes/GIFs sometimes
// omit them, so width/height are optional and may be null.
export type MediaSize = { width?: number | null; height?: number | null };

export type Size = { width: number; height: number };

// Chat-bubble attachment bounds. An attachment is fit within a max box while
// preserving aspect ratio, floored to a min width so a sliver-thin meme stays
// tappable, and falls back to a square when the source omitted dimensions.
export const ATTACHMENT_MAX_W = 220;
export const ATTACHMENT_MAX_H = 220;
export const ATTACHMENT_MIN_W = 96;
export const ATTACHMENT_FALLBACK = 160;

// Fit an attachment into the bubble box, preserving aspect ratio.
//
// Note: when an extremely tall image is clamped to ATTACHMENT_MAX_H, the derived
// width can dip below ATTACHMENT_MIN_W and gets floored — intentionally letting
// width win over an exact ratio so the meme never becomes a hairline. Height is
// not re-derived after that floor; this preserves the long-standing visual.
export function fitAttachment(media: MediaSize): Size {
  if (!media.width || !media.height) {
    return { width: ATTACHMENT_FALLBACK, height: ATTACHMENT_FALLBACK };
  }
  const ratio = media.width / media.height;
  let width = Math.min(ATTACHMENT_MAX_W, media.width);
  let height = width / ratio;
  if (height > ATTACHMENT_MAX_H) {
    height = ATTACHMENT_MAX_H;
    width = height * ratio;
  }
  width = Math.max(ATTACHMENT_MIN_W, width);
  return { width, height };
}

// Horizontal picker strip: every card is scaled to a fixed row height, its width
// derived from the aspect ratio and clamped so a freak-shaped item can't blow
// out (or collapse) the row. Falls back to a square (height×height) when the
// source omitted dimensions.
export function stripCardWidth(
  media: MediaSize,
  bounds: { height: number; min: number; max: number },
): number {
  if (!media.width || !media.height) return bounds.height;
  const ratio = media.width / media.height;
  const w = bounds.height * ratio;
  return Math.max(bounds.min, Math.min(bounds.max, w));
}
