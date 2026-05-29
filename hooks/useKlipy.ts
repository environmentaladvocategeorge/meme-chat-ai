import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentFilter, TrendingMeme, TrendingMemesResult } from "@/domain/memes";
import {
  getTrendingMemesCallable,
  searchMemesCallable,
} from "@/services/firebase/callables";
import { useDebouncedValue } from "./useDebouncedValue";

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

type Mode = { kind: "trending" } | { kind: "search"; query: string };

export type UseKlipyResult = {
  memes: TrendingMeme[];
  // True while a fresh page-1 load is replacing the list.
  loading: boolean;
  // True while appending a subsequent page.
  loadingMore: boolean;
  error: string | null;
  hasNext: boolean;
  page: number;
  // "trending" until a non-empty query is active, then "search".
  mode: "trending" | "search";
  // True from the first keystroke (while debouncing) through the search fetch
  // resolving — drives a "searching…" affordance in the input.
  searching: boolean;
  // Live (un-debounced) search box value + setter.
  query: string;
  setQuery: (q: string) => void;
  clearSearch: () => void;
  // Re-run the current mode (trending or the active query) from page 1.
  retry: () => void;
  // Append the next page of the current mode, if any.
  loadMore: () => Promise<void>;
  // Clear all state back to empty trending.
  reset: () => void;
};

// Modular Klipy hook with a built-in debounced search. Drop it into any screen
// that wants memes: it owns trending + keyword search, pagination, loading /
// error state, and request de-duping. The backend callables hold the app key
// and use the signed-in uid as a stable customer_id, so callers pass nothing
// secret.
export function useKlipy(options: UseKlipyOptions = {}): UseKlipyResult {
  const {
    perPage,
    locale,
    contentFilter,
    enabled = true,
    debounceMs = 400,
  } = options;

  const [memes, setMemes] = useState<TrendingMeme[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<"trending" | "search">("trending");
  const [query, setQuery] = useState("");

  const debouncedQuery = useDebouncedValue(query.trim(), debounceMs);

  const mountedRef = useRef(true);
  // Monotonic id for the latest "fresh" (page-1) load. Any in-flight response
  // whose id is stale (the mode/query moved on) is discarded — this is what
  // keeps a slow search response from clobbering a newer trending load.
  const requestIdRef = useRef(0);
  const modeRef = useRef<Mode>({ kind: "trending" });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const callFor = useCallback(
    (m: Mode, nextPage: number): Promise<TrendingMemesResult> =>
      m.kind === "search"
        ? searchMemesCallable({
            query: m.query,
            page: nextPage,
            perPage,
            locale,
            contentFilter,
          })
        : getTrendingMemesCallable({
            page: nextPage,
            perPage,
            locale,
            contentFilter,
          }),
    [perPage, locale, contentFilter],
  );

  // Fresh page-1 load for a given mode. Supersedes any earlier fresh load.
  const runFresh = useCallback(
    async (m: Mode) => {
      const id = ++requestIdRef.current;
      modeRef.current = m;
      setMode(m.kind);
      setLoading(true);
      setError(null);
      try {
        const result = await callFor(m, 1);
        if (!mountedRef.current || requestIdRef.current !== id) return;
        setMemes(result.memes);
        setHasNext(result.hasNext);
        setPage(result.page);
      } catch (err) {
        if (!mountedRef.current || requestIdRef.current !== id) return;
        setError(err instanceof Error ? err.message : "klipy-failed");
        setMemes([]);
        setHasNext(false);
      } finally {
        if (mountedRef.current && requestIdRef.current === id) {
          setLoading(false);
        }
      }
    },
    [callFor],
  );

  const loadMore = useCallback(async () => {
    if (!hasNext || loading || loadingMore) return;
    const id = requestIdRef.current;
    const m = modeRef.current;
    setLoadingMore(true);
    try {
      const result = await callFor(m, page + 1);
      // Drop the appended page if the mode/query changed mid-flight.
      if (!mountedRef.current || requestIdRef.current !== id) return;
      setMemes((current) => [...current, ...result.memes]);
      setHasNext(result.hasNext);
      setPage(result.page);
    } catch (err) {
      if (!mountedRef.current || requestIdRef.current !== id) return;
      setError(err instanceof Error ? err.message : "klipy-failed");
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [hasNext, loading, loadingMore, page, callFor]);

  // Drive loads off the debounced query. An empty query shows trending; a
  // non-empty one searches. Only runs while enabled, so the first network call
  // is deferred until the consumer flips it on.
  useEffect(() => {
    if (!enabled) return;
    if (debouncedQuery.length > 0) {
      void runFresh({ kind: "search", query: debouncedQuery });
    } else {
      void runFresh({ kind: "trending" });
    }
  }, [enabled, debouncedQuery, runFresh]);

  const retry = useCallback(() => {
    void runFresh(modeRef.current);
  }, [runFresh]);

  const clearSearch = useCallback(() => setQuery(""), []);

  // Pending from the first keystroke (query not yet debounced) through the
  // actual search request resolving.
  const searching =
    query.trim().length > 0 &&
    (query.trim() !== debouncedQuery || (loading && mode === "search"));

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    modeRef.current = { kind: "trending" };
    setMemes([]);
    setError(null);
    setHasNext(false);
    setPage(0);
    setMode("trending");
    setQuery("");
    setLoading(false);
    setLoadingMore(false);
  }, []);

  return {
    memes,
    loading,
    loadingMore,
    error,
    hasNext,
    page,
    mode,
    searching,
    query,
    setQuery,
    clearSearch,
    retry,
    loadMore,
    reset,
  };
}
