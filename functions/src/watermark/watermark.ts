import sharp from "sharp";
import {
  KLIPY_LOGO_HEIGHT,
  KLIPY_LOGO_PNG_BASE64,
  KLIPY_LOGO_WIDTH,
} from "./logo";

// Largest edge of the watermarked output. Bounds the returned payload (the
// client base64-decodes it to save) and keeps compositing cheap.
const MAX_DIM = 1080;

const LOGO_ASPECT = KLIPY_LOGO_WIDTH / KLIPY_LOGO_HEIGHT;

const LOGO = Buffer.from(KLIPY_LOGO_PNG_BASE64, "base64");

// Composites the KLIPY watermark onto a single still image, mirroring the
// in-app treatment: a soft dark gradient scrim across the bottom with the light
// KLIPY wordmark in the bottom-right corner. Animated inputs (gif/webp) are
// read as their first frame — downloads are a static watermarked still by
// design. Returns PNG bytes.
export async function compositeWatermark(source: Buffer): Promise<Buffer> {
  // Downscale-if-larger and flatten to a known orientation/format first, so the
  // scrim + logo are sized against the final canvas. failOn:"none" tolerates
  // slightly malformed CDN assets.
  const resized = await sharp(source, { failOn: "none" })
    .resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const meta = await sharp(resized).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W === 0 || H === 0) {
    // Nothing usable to size against — return the resized image unchanged
    // rather than failing the download.
    return resized;
  }

  // Bottom gradient scrim (transparent → 50% black) over the lower ~22% so the
  // light wordmark stays legible on bright images.
  const scrimH = Math.max(24, Math.round(H * 0.22));
  const scrimSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="black" stop-opacity="0"/><stop offset="1" stop-color="black" stop-opacity="0.5"/></linearGradient></defs><rect x="0" y="${H - scrimH}" width="${W}" height="${scrimH}" fill="url(#g)"/></svg>`;

  // Logo ~26% of width, clamped, bottom-right with a small margin.
  const logoW = Math.round(Math.min(200, Math.max(64, W * 0.26)));
  const logoH = Math.round(logoW / LOGO_ASPECT);
  const logo = await sharp(LOGO).resize(logoW, logoH).png().toBuffer();
  const margin = Math.round(W * 0.025) + 4;

  return sharp(resized)
    .composite([
      { input: Buffer.from(scrimSvg), top: 0, left: 0 },
      {
        input: logo,
        top: Math.max(0, H - logoH - margin),
        left: Math.max(0, W - logoW - margin),
      },
    ])
    .png()
    .toBuffer();
}
