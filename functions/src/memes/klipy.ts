import type {
  ContentFilter,
  TrendingMeme,
  TrendingMemesResult,
} from "./types";

const KLIPY_BASE_URL = "https://api.klipy.com/api/v1";

// ---- Raw Klipy response shapes (only the fields we read) ----

type KlipyAsset = {
  url?: unknown;
  width?: unknown;
  height?: unknown;
};

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

type KlipyTrendingResponse = {
  result?: unknown;
  data?: {
    data?: unknown;
    current_page?: unknown;
    per_page?: unknown;
    has_next?: unknown;
  };
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

export class KlipyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KlipyError";
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

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

function normalizeResponse(
  body: KlipyTrendingResponse,
  fallbackPage: number,
  fallbackPerPage: number,
): TrendingMemesResult {
  const data = body.data ?? {};
  const rawList = Array.isArray(data.data) ? (data.data as KlipyMeme[]) : [];

  const memes: TrendingMeme[] = [];
  for (const entry of rawList) {
    const normalized = normalizeMeme(entry ?? {});
    if (normalized) memes.push(normalized);
  }

  const page = asNumber(data.current_page) || fallbackPage;
  const perPage = asNumber(data.per_page) || fallbackPerPage;

  return {
    memes,
    page,
    perPage,
    hasNext: data.has_next === true,
  };
}

export type SearchMemesParams = FetchTrendingMemesParams & {
  // The search keyword. Required for the search endpoint.
  query: string;
};

// Klipy's two static-meme list endpoints share the same path shape, query
// params, and response envelope — only the trailing segment and the extra
// `q` differ. This core does the request + normalization for both.
async function requestMemes(
  endpoint: "trending" | "search",
  params: SearchMemesParams | FetchTrendingMemesParams,
): Promise<TrendingMemesResult> {
  const { apiKey, page, perPage, customerId, locale, contentFilter } = params;
  const query = "query" in params ? params.query : undefined;

  // app_key is a path param; everything else is a query param.
  const url = new URL(
    `${KLIPY_BASE_URL}/${encodeURIComponent(apiKey)}/static-memes/${endpoint}`,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("customer_id", customerId);
  if (endpoint === "search" && query) url.searchParams.set("q", query);
  if (locale) url.searchParams.set("locale", locale);
  if (contentFilter) url.searchParams.set("content_filter", contentFilter);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    throw new KlipyError(
      `klipy request failed: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }

  if (!response.ok) {
    throw new KlipyError(`klipy responded ${response.status}`, response.status);
  }

  let body: KlipyTrendingResponse;
  try {
    body = (await response.json()) as KlipyTrendingResponse;
  } catch {
    throw new KlipyError("klipy returned non-JSON body", response.status);
  }

  if (body.result !== true || !body.data) {
    throw new KlipyError("klipy returned an unsuccessful result", response.status);
  }

  return normalizeResponse(body, page, perPage);
}

// Calls Klipy's static-memes/trending endpoint and returns a normalized,
// client-ready result. Throws KlipyError on transport / non-2xx / malformed
// responses so the callable can map it to a clean HttpsError.
export async function fetchTrendingMemes(
  params: FetchTrendingMemesParams,
): Promise<TrendingMemesResult> {
  return requestMemes("trending", params);
}

// Calls Klipy's static-memes/search endpoint for a keyword query. Same
// normalized shape + error contract as fetchTrendingMemes.
export async function searchMemes(
  params: SearchMemesParams,
): Promise<TrendingMemesResult> {
  return requestMemes("search", params);
}
