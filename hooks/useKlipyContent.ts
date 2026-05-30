import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";

// A normalized page of Klipy content, neutral over the item type. Both the meme
// and GIF callables return this shape (with `items` mapped from memes/gifs).
export type KlipyPage<T> = {
  items: T[];
  page: number;
  perPage: number;
  hasNext: boolean;
};

type Mode = { kind: "trending" } | { kind: "search"; query: string };

export type UseKlipyContentOptions<T> = {
  // Fetch trending / search a page. Injected so the same engine powers memes,
  // GIFs, or any future Klipy product.
  fetchTrending: (page: number) => Promise<KlipyPage<T>>;
  fetchSearch: (query: string, page: number) => Promise<KlipyPage<T>>;
  enabled?: boolean;
  debounceMs?: number;
};

export type UseKlipyContentResult<T> = {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasNext: boolean;
  page: number;
  mode: "trending" | "search";
  searching: boolean;
  query: string;
  setQuery: (q: string) => void;
  clearSearch: () => void;
  retry: () => void;
  loadMore: () => Promise<void>;
  reset: () => void;
};

// The shared Klipy browsing engine: trending + debounced keyword search,
// pagination, loading / error state, and request de-duping. Item-type and
// transport agnostic — callers inject the fetchers. (See useKlipy / useKlipyGifs
// for the meme and GIF bindings.)
export function useKlipyContent<T>(
  options: UseKlipyContentOptions<T>,
): UseKlipyContentResult<T> {
  const { fetchTrending, fetchSearch, enabled = true, debounceMs = 400 } = options;

  const [items, setItems] = useState<T[]>([]);
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
  // whose id is stale (the mode/query moved on) is discarded.
  const requestIdRef = useRef(0);
  const modeRef = useRef<Mode>({ kind: "trending" });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const callFor = useCallback(
    (m: Mode, nextPage: number): Promise<KlipyPage<T>> =>
      m.kind === "search"
        ? fetchSearch(m.query, nextPage)
        : fetchTrending(nextPage),
    [fetchSearch, fetchTrending],
  );

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
        setItems(result.items);
        setHasNext(result.hasNext);
        setPage(result.page);
      } catch (err) {
        if (!mountedRef.current || requestIdRef.current !== id) return;
        setError(err instanceof Error ? err.message : "klipy-failed");
        setItems([]);
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
      if (!mountedRef.current || requestIdRef.current !== id) return;
      setItems((current) => [...current, ...result.items]);
      setHasNext(result.hasNext);
      setPage(result.page);
    } catch (err) {
      if (!mountedRef.current || requestIdRef.current !== id) return;
      setError(err instanceof Error ? err.message : "klipy-failed");
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [hasNext, loading, loadingMore, page, callFor]);

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

  const searching =
    query.trim().length > 0 &&
    (query.trim() !== debouncedQuery || (loading && mode === "search"));

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    modeRef.current = { kind: "trending" };
    setItems([]);
    setError(null);
    setHasNext(false);
    setPage(0);
    setMode("trending");
    setQuery("");
    setLoading(false);
    setLoadingMore(false);
  }, []);

  return {
    items,
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
