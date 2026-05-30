import {
  asNumber,
  asString,
  type KlipyAsset,
  KlipyError,
  type KlipyRequestParams,
  requestKlipyList,
} from "../klipy/client";
import type {
  ContentFilter,
  TrendingMeme,
  TrendingMemesResult,
} from "./types";

// Re-export so existing importers (getMemeTool, getTrendingMemes) keep working.
export { KlipyError };

// ---- Raw Klipy meme response shapes (only the fields we read) ----

type KlipyFileFormat = {
  png?: KlipyAsset;
  webp?: KlipyAsset;
};

type KlipyFile = {
  hd?: KlipyFileFormat;
  md?: KlipyFileFormat;
  sm?: KlipyFileFormat;
  xs?: KlipyFileFormat;
};

type KlipyMeme = {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  file?: KlipyFile;
  blur_preview?: unknown;
};

export type FetchTrendingMemesParams = {
  apiKey: string;
  page: number;
  perPage: number;
  // A stable per-user identifier. Klipy uses it for personalization/dedupe and
  // expects it to stay consistent for the same user — we pass the Firebase uid.
  customerId: string;
  locale?: string;
  contentFilter?: ContentFilter;
};

// Picks the first present asset url across the candidate formats, preferring
// webp (smaller) then png. Returns the asset (url + dims) or null.
function pickAsset(
  format: KlipyFileFormat | undefined,
): { url: string; width: number; height: number } | null {
  if (!format) return null;
  for (const asset of [format.webp, format.png]) {
    const url = asString(asset?.url);
    if (url) {
      return {
        url,
        width: asNumber(asset?.width),
        height: asNumber(asset?.height),
      };
    }
  }
  return null;
}

// Collapses one Klipy meme into our lean shape. Returns null when the entry is
// unusable (no id, or no displayable asset) so callers can skip it.
export function normalizeMeme(raw: KlipyMeme): TrendingMeme | null {
  const id = raw.id;
  const idStr =
    typeof id === "number" && Number.isFinite(id)
      ? String(id)
      : asString(id);
  if (!idStr) return null;

  const file = raw.file ?? {};
  // Display: prefer md, fall back to hd then sm so we always render something.
  const display =
    pickAsset(file.md) ?? pickAsset(file.hd) ?? pickAsset(file.sm);
  if (!display) return null;

  // Preview (grid thumbnail): prefer sm, fall back to xs, then the display url.
  const preview = pickAsset(file.sm) ?? pickAsset(file.xs);

  const blur = asString(raw.blur_preview);

  return {
    id: idStr,
    slug: asString(raw.slug),
    title: asString(raw.title),
    url: display.url,
    width: display.width,
    height: display.height,
    previewUrl: preview?.url ?? display.url,
    blurPreview: blur || null,
  };
}

export type SearchMemesParams = FetchTrendingMemesParams & {
  // The search keyword. Required for the search endpoint.
  query: string;
};

function toBaseParams(
  params: SearchMemesParams | FetchTrendingMemesParams,
): KlipyRequestParams {
  return {
    apiKey: params.apiKey,
    page: params.page,
    perPage: params.perPage,
    customerId: params.customerId,
    query: "query" in params ? params.query : undefined,
    locale: params.locale,
    contentFilter: params.contentFilter,
  };
}

function toResult(
  list: { items: TrendingMeme[]; page: number; perPage: number; hasNext: boolean },
): TrendingMemesResult {
  return {
    memes: list.items,
    page: list.page,
    perPage: list.perPage,
    hasNext: list.hasNext,
  };
}

// Calls Klipy's static-memes/trending endpoint and returns a normalized,
// client-ready result. Throws KlipyError on transport / non-2xx / malformed
// responses so the callable can map it to a clean HttpsError.
export async function fetchTrendingMemes(
  params: FetchTrendingMemesParams,
): Promise<TrendingMemesResult> {
  const list = await requestKlipyList(
    "static-memes",
    "trending",
    toBaseParams(params),
    (raw) => normalizeMeme((raw ?? {}) as KlipyMeme),
  );
  return toResult(list);
}

// Calls Klipy's static-memes/search endpoint for a keyword query. Same
// normalized shape + error contract as fetchTrendingMemes.
export async function searchMemes(
  params: SearchMemesParams,
): Promise<TrendingMemesResult> {
  const list = await requestKlipyList(
    "static-memes",
    "search",
    toBaseParams(params),
    (raw) => normalizeMeme((raw ?? {}) as KlipyMeme),
  );
  return toResult(list);
}
