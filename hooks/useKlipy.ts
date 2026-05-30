import { useCallback } from "react";
import type { ContentFilter, TrendingMeme } from "@/domain/memes";
import {
  getTrendingMemesCallable,
  searchMemesCallable,
} from "@/services/firebase/callables";
import {
  useKlipyContent,
  type KlipyPage,
  type UseKlipyContentResult,
} from "./useKlipyContent";

type UseKlipyOptions = {
  perPage?: number;
  // ISO 3166-1 alpha-2 country code, e.g. "us".
  locale?: string;
  contentFilter?: ContentFilter;
  // Only fetch while enabled. Lets a consumer keep the hook mounted but defer
  // any network call until, say, a meme drawer is actually opened.
  enabled?: boolean;
  // Debounce window for the search box before a query hits the network.
  debounceMs?: number;
};

// `memes` is the meme-named alias of the engine's neutral `items`.
export type UseKlipyResult = Omit<UseKlipyContentResult<TrendingMeme>, "items"> & {
  memes: TrendingMeme[];
};

// Meme binding of the shared Klipy engine (useKlipyContent). The backend
// callables hold the app key and use the signed-in uid as a stable customer_id,
// so callers pass nothing secret.
export function useKlipy(options: UseKlipyOptions = {}): UseKlipyResult {
  const { perPage, locale, contentFilter, enabled = true, debounceMs = 400 } = options;

  const fetchTrending = useCallback(
    async (page: number): Promise<KlipyPage<TrendingMeme>> => {
      const r = await getTrendingMemesCallable({ page, perPage, locale, contentFilter });
      return { items: r.memes, page: r.page, perPage: r.perPage, hasNext: r.hasNext };
    },
    [perPage, locale, contentFilter],
  );

  const fetchSearch = useCallback(
    async (query: string, page: number): Promise<KlipyPage<TrendingMeme>> => {
      const r = await searchMemesCallable({ query, page, perPage, locale, contentFilter });
      return { items: r.memes, page: r.page, perPage: r.perPage, hasNext: r.hasNext };
    },
    [perPage, locale, contentFilter],
  );

  const { items, ...rest } = useKlipyContent<TrendingMeme>({
    fetchTrending,
    fetchSearch,
    enabled,
    debounceMs,
  });

  return { ...rest, memes: items };
}
