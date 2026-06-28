import { useCallback } from "react";
import type { ContentFilter } from "@/domain/memes";
import type { TrendingSticker } from "@/domain/stickers";
import {
  getTrendingStickersCallable,
  searchStickersCallable,
} from "@/services/firebase/callables";
import {
  useKlipyContent,
  type KlipyPage,
  type UseKlipyContentResult,
} from "./useKlipyContent";

type UseKlipyStickersOptions = {
  perPage?: number;
  locale?: string;
  contentFilter?: ContentFilter;
  enabled?: boolean;
  debounceMs?: number;
};

// `stickers` is the sticker-named alias of the engine's neutral `items`.
export type UseKlipyStickersResult = Omit<
  UseKlipyContentResult<TrendingSticker>,
  "items"
> & {
  stickers: TrendingSticker[];
};

// Sticker binding of the shared Klipy engine (useKlipyContent) — the trending /
// search / pagination logic is identical to memes/GIFs; only the callables
// differ.
export function useKlipyStickers(
  options: UseKlipyStickersOptions = {},
): UseKlipyStickersResult {
  const { perPage, locale, contentFilter, enabled = true, debounceMs = 400 } =
    options;

  const fetchTrending = useCallback(
    async (page: number): Promise<KlipyPage<TrendingSticker>> => {
      const r = await getTrendingStickersCallable({
        page,
        perPage,
        locale,
        contentFilter,
      });
      return {
        items: r.stickers,
        page: r.page,
        perPage: r.perPage,
        hasNext: r.hasNext,
      };
    },
    [perPage, locale, contentFilter],
  );

  const fetchSearch = useCallback(
    async (query: string, page: number): Promise<KlipyPage<TrendingSticker>> => {
      const r = await searchStickersCallable({
        query,
        page,
        perPage,
        locale,
        contentFilter,
      });
      return {
        items: r.stickers,
        page: r.page,
        perPage: r.perPage,
        hasNext: r.hasNext,
      };
    },
    [perPage, locale, contentFilter],
  );

  const { items, ...rest } = useKlipyContent<TrendingSticker>({
    fetchTrending,
    fetchSearch,
    enabled,
    debounceMs,
  });

  return { ...rest, stickers: items };
}
