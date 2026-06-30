import {
  asNumber,
  asString,
  type KlipyAsset,
  KlipyError,
  type KlipyRequestParams,
  requestKlipyList,
} from "../klipy/client";
import type { ContentFilter } from "../memes/types";
import type { TrendingSticker, TrendingStickersResult } from "./types";

export { KlipyError };

// Klipy sticker format_filter: we need the animated webp/gif (display) and the
// still png (poster + model input). png carries the alpha channel stickers rely
// on. Dropping mp4/webm keeps the payload lean.
const STICKER_FORMAT_FILTER = "webp,gif,png";

// ---- Raw Klipy sticker response shapes (only the fields we read) ----

type KlipyStickerFormat = {
  gif?: KlipyAsset;
  webp?: KlipyAsset;
  png?: KlipyAsset;
};

type KlipyStickerFile = {
  hd?: KlipyStickerFormat;
  md?: KlipyStickerFormat;
  sm?: KlipyStickerFormat;
  xs?: KlipyStickerFormat;
};

type KlipySticker = {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  file?: KlipyStickerFile;
  blur_preview?: unknown;
};

type Asset = { url: string; width: number; height: number };

function pickFormat(
  format: KlipyStickerFormat | undefined,
  key: "gif" | "webp" | "png",
): Asset | null {
  const asset = format?.[key];
  const url = asString(asset?.url);
  if (!url) return null;
  return { url, width: asNumber(asset?.width), height: asNumber(asset?.height) };
}

// Walks (size, format) candidates in priority order, returning the first present
// asset. Lets each role (display / still) express its own preference list.
function pickFirst(
  file: KlipyStickerFile,
  candidates: Array<[keyof KlipyStickerFile, "gif" | "webp" | "png"]>,
): Asset | null {
  for (const [size, key] of candidates) {
    const asset = pickFormat(file[size], key);
    if (asset) return asset;
  }
  return null;
}

// Collapses one Klipy sticker into our lean shape. Returns null when the entry
// is unusable (no id, or no still png to feed the model) so callers can skip it.
export function normalizeSticker(raw: KlipySticker): TrendingSticker | null {
  const id = raw.id;
  const idStr =
    typeof id === "number" && Number.isFinite(id) ? String(id) : asString(id);
  if (!idStr) return null;

  const file = raw.file ?? {};

  // Still (png, with alpha): the model input + grid poster. Smallest-first so
  // the model fetch stays cheap. Required — without it we have nothing to feed
  // the model, so skip the entry.
  const still = pickFirst(file, [
    ["sm", "png"],
    ["md", "png"],
    ["xs", "png"],
    ["hd", "png"],
  ]);
  if (!still) return null;

  // Display (animated): prefer animated webp (smaller, high quality), fall back
  // to gif, stepping down sizes. Falls back to the still png if no animated
  // asset exists (stickers can be static).
  const display =
    pickFirst(file, [
      ["md", "webp"],
      ["md", "gif"],
      ["hd", "webp"],
      ["hd", "gif"],
      ["sm", "webp"],
      ["sm", "gif"],
    ]) ?? still;

  const blur = asString(raw.blur_preview);

  return {
    id: idStr,
    slug: asString(raw.slug),
    title: asString(raw.title),
    url: display.url,
    width: display.width,
    height: display.height,
    previewUrl: still.url,
    blurPreview: blur || null,
  };
}

export type FetchTrendingStickersParams = {
  apiKey: string;
  page: number;
  perPage: number;
  customerId: string;
  locale?: string;
  contentFilter?: ContentFilter;
};

export type SearchStickersParams = FetchTrendingStickersParams & {
  query: string;
};

function toBaseParams(
  params: SearchStickersParams | FetchTrendingStickersParams,
): KlipyRequestParams {
  return {
    apiKey: params.apiKey,
    page: params.page,
    perPage: params.perPage,
    customerId: params.customerId,
    query: "query" in params ? params.query : undefined,
    locale: params.locale,
    contentFilter: params.contentFilter,
    formatFilter: STICKER_FORMAT_FILTER,
  };
}

function toResult(list: {
  items: TrendingSticker[];
  page: number;
  perPage: number;
  hasNext: boolean;
}): TrendingStickersResult {
  return {
    stickers: list.items,
    page: list.page,
    perPage: list.perPage,
    hasNext: list.hasNext,
  };
}

export async function fetchTrendingStickers(
  params: FetchTrendingStickersParams,
): Promise<TrendingStickersResult> {
  const list = await requestKlipyList(
    "stickers",
    "trending",
    toBaseParams(params),
    (raw) => normalizeSticker((raw ?? {}) as KlipySticker),
  );
  return toResult(list);
}

export async function searchStickers(
  params: SearchStickersParams,
): Promise<TrendingStickersResult> {
  const list = await requestKlipyList(
    "stickers",
    "search",
    toBaseParams(params),
    (raw) => normalizeSticker((raw ?? {}) as KlipySticker),
  );
  return toResult(list);
}
