import { useCallback } from "react";
import type { TrendingGif } from "@/domain/gifs";
import type { ContentFilter } from "@/domain/memes";
import {
  getTrendingGifsCallable,
  searchGifsCallable,
} from "@/services/firebase/callables";
import {
  useKlipyContent,
  type KlipyPage,
  type UseKlipyContentResult,
} from "./useKlipyContent";

type UseKlipyGifsOptions = {
  perPage?: number;
  locale?: string;
  contentFilter?: ContentFilter;
  enabled?: boolean;
  debounceMs?: number;
};

// `gifs` is the gif-named alias of the engine's neutral `items`.
export type UseKlipyGifsResult = Omit<UseKlipyContentResult<TrendingGif>, "items"> & {
  gifs: TrendingGif[];
};

// GIF binding of the shared Klipy engine (useKlipyContent) — the trending /
// search / pagination logic is identical to memes; only the callables differ.
export function useKlipyGifs(options: UseKlipyGifsOptions = {}): UseKlipyGifsResult {
  const { perPage, locale, contentFilter, enabled = true, debounceMs = 400 } = options;

  const fetchTrending = useCallback(
    async (page: number): Promise<KlipyPage<TrendingGif>> => {
      const r = await getTrendingGifsCallable({ page, perPage, locale, contentFilter });
      return { items: r.gifs, page: r.page, perPage: r.perPage, hasNext: r.hasNext };
    },
    [perPage, locale, contentFilter],
  );

  const fetchSearch = useCallback(
    async (query: string, page: number): Promise<KlipyPage<TrendingGif>> => {
      const r = await searchGifsCallable({ query, page, perPage, locale, contentFilter });
      return { items: r.gifs, page: r.page, perPage: r.perPage, hasNext: r.hasNext };
    },
    [perPage, locale, contentFilter],
  );

  const { items, ...rest } = useKlipyContent<TrendingGif>({
    fetchTrending,
    fetchSearch,
    enabled,
    debounceMs,
  });

  return { ...rest, gifs: items };
}
