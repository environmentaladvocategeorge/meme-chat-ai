// Shared Klipy HTTP core. Klipy's content products (static-memes, gifs, …)
// share the same path shape, query params, and response envelope — only the
// product path segment, an optional `q` (search), an optional `format_filter`,
// and the per-item asset shape differ. This module owns the request +
// envelope handling once; each product module supplies its own item normalizer.

export const KLIPY_BASE_URL = "https://api.klipy.com/api/v1";

export class KlipyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KlipyError";
  }
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Raw Klipy asset (one size × format). Only the fields we read.
export type KlipyAsset = {
  url?: unknown;
  width?: unknown;
  height?: unknown;
};

export type KlipyResponse = {
  result?: unknown;
  data?: {
    data?: unknown;
    current_page?: unknown;
    per_page?: unknown;
    has_next?: unknown;
  };
};

export type KlipyListResult<T> = {
  items: T[];
  page: number;
  perPage: number;
  hasNext: boolean;
};

export type KlipyRequestParams = {
  apiKey: string;
  page: number;
  perPage: number;
  // A stable per-user identifier. Klipy uses it for personalization/dedupe and
  // expects it to stay consistent for the same user — we pass the Firebase uid.
  customerId: string;
  // Search keyword (search endpoint only).
  query?: string;
  locale?: string;
  contentFilter?: string;
  // Comma-separated desired formats (e.g. "gif,webp,jpg"). GIFs use it to keep
  // the payload lean; memes omit it.
  formatFilter?: string;
};

// Performs a Klipy list request for a product (trending or search) and maps the
// raw item array through `normalizeItem`, dropping entries that normalize to
// null. Throws KlipyError on transport / non-2xx / malformed responses.
export async function requestKlipyList<T>(
  product: string,
  endpoint: "trending" | "search",
  params: KlipyRequestParams,
  normalizeItem: (raw: unknown) => T | null,
): Promise<KlipyListResult<T>> {
  const { apiKey, page, perPage, customerId, query, locale, contentFilter, formatFilter } =
    params;

  // app_key is a path param; everything else is a query param.
  const url = new URL(
    `${KLIPY_BASE_URL}/${encodeURIComponent(apiKey)}/${product}/${endpoint}`,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("customer_id", customerId);
  if (endpoint === "search" && query) url.searchParams.set("q", query);
  if (locale) url.searchParams.set("locale", locale);
  if (contentFilter) url.searchParams.set("content_filter", contentFilter);
  if (formatFilter) url.searchParams.set("format_filter", formatFilter);

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

  let body: KlipyResponse;
  try {
    body = (await response.json()) as KlipyResponse;
  } catch {
    throw new KlipyError("klipy returned non-JSON body", response.status);
  }

  if (body.result !== true || !body.data) {
    throw new KlipyError("klipy returned an unsuccessful result", response.status);
  }

  const data = body.data;
  const rawList = Array.isArray(data.data) ? data.data : [];

  const items: T[] = [];
  for (const entry of rawList) {
    const normalized = normalizeItem(entry);
    if (normalized) items.push(normalized);
  }

  return {
    items,
    page: asNumber(data.current_page) || page,
    perPage: asNumber(data.per_page) || perPage,
    hasNext: data.has_next === true,
  };
}
