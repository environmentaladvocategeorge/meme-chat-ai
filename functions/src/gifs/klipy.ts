import {
  asNumber,
  asString,
  type KlipyAsset,
  KlipyError,
  type KlipyRequestParams,
  requestKlipyList,
} from "../klipy/client";
import type { ContentFilter } from "../memes/types";
import type { TrendingGif, TrendingGifsResult } from "./types";

export { KlipyError };

// Klipy GIF format_filter: we only need the animated webp/gif (display +
// frame-source) and the jpg poster (still preview). Dropping mp4/webm keeps the
// payload smaller.
const GIF_FORMAT_FILTER = "gif,webp,jpg";

// ---- Raw Klipy GIF response shapes (only the fields we read) ----

type KlipyGifFormat = {
  gif?: KlipyAsset;
  webp?: KlipyAsset;
  jpg?: KlipyAsset;
};

type KlipyGifFile = {
  hd?: KlipyGifFormat;
  md?: KlipyGifFormat;
  sm?: KlipyGifFormat;
  xs?: KlipyGifFormat;
};

type KlipyGif = {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  file?: KlipyGifFile;
  blur_preview?: unknown;
};

type Asset = { url: string; width: number; height: number };

function pickFormat(
  format: KlipyGifFormat | undefined,
  key: "gif" | "webp" | "jpg",
): Asset | null {
  const asset = format?.[key];
  const url = asString(asset?.url);
  if (!url) return null;
  return { url, width: asNumber(asset?.width), height: asNumber(asset?.height) };
}

// Walks (size, format) candidates in priority order, returning the first present
// asset. Lets each role (display / poster / frame-source) express its own
// preference list cleanly.
function pickFirst(
  file: KlipyGifFile,
  candidates: Array<[keyof KlipyGifFile, "gif" | "webp" | "jpg"]>,
): Asset | null {
  for (const [size, key] of candidates) {
    const asset = pickFormat(file[size], key);
    if (asset) return asset;
  }
  return null;
}

// Collapses one Klipy GIF into our lean shape. Returns null when the entry is
// unusable (no id, or no animated asset to display) so callers can skip it.
export function normalizeGif(raw: KlipyGif): TrendingGif | null {
  const id = raw.id;
  const idStr =
    typeof id === "number" && Number.isFinite(id) ? String(id) : asString(id);
  if (!idStr) return null;

  const file = raw.file ?? {};

  // Display (animated): prefer animated webp (smaller, high quality), fall back
  // to gif, stepping down sizes so we always render something.
  const display = pickFirst(file, [
    ["md", "webp"],
    ["md", "gif"],
    ["hd", "webp"],
    ["hd", "gif"],
    ["sm", "webp"],
    ["sm", "gif"],
  ]);
  if (!display) return null;

  // Poster (still): the jpg single frame, smallest-first for grids/blur.
  const poster = pickFirst(file, [
    ["sm", "jpg"],
    ["xs", "jpg"],
    ["md", "jpg"],
    ["hd", "jpg"],
  ]);

  // Frame source (animated, small): what the backend decodes into frames.
  // Prefer the small animated webp/gif so the decode fetch stays cheap.
  const frameSource =
    pickFirst(file, [
      ["sm", "webp"],
      ["sm", "gif"],
      ["md", "webp"],
      ["md", "gif"],
    ]) ?? display;

  const blur = asString(raw.blur_preview);

  return {
    id: idStr,
    slug: asString(raw.slug),
    title: asString(raw.title),
    url: display.url,
    width: display.width,
    height: display.height,
    previewUrl: poster?.url ?? display.url,
    frameSourceUrl: frameSource.url,
    blurPreview: blur || null,
  };
}

export type FetchTrendingGifsParams = {
  apiKey: string;
  page: number;
  perPage: number;
  customerId: string;
  locale?: string;
  contentFilter?: ContentFilter;
};

export type SearchGifsParams = FetchTrendingGifsParams & {
  query: string;
};

function toBaseParams(
  params: SearchGifsParams | FetchTrendingGifsParams,
): KlipyRequestParams {
  return {
    apiKey: params.apiKey,
    page: params.page,
    perPage: params.perPage,
    customerId: params.customerId,
    query: "query" in params ? params.query : undefined,
    locale: params.locale,
    contentFilter: params.contentFilter,
    formatFilter: GIF_FORMAT_FILTER,
  };
}

function toResult(list: {
  items: TrendingGif[];
  page: number;
  perPage: number;
  hasNext: boolean;
}): TrendingGifsResult {
  return {
    gifs: list.items,
    page: list.page,
    perPage: list.perPage,
    hasNext: list.hasNext,
  };
}

export async function fetchTrendingGifs(
  params: FetchTrendingGifsParams,
): Promise<TrendingGifsResult> {
  const list = await requestKlipyList(
    "gifs",
    "trending",
    toBaseParams(params),
    (raw) => normalizeGif((raw ?? {}) as KlipyGif),
  );
  return toResult(list);
}

export async function searchGifs(
  params: SearchGifsParams,
): Promise<TrendingGifsResult> {
  const list = await requestKlipyList(
    "gifs",
    "search",
    toBaseParams(params),
    (raw) => normalizeGif((raw ?? {}) as KlipyGif),
  );
  return toResult(list);
}
