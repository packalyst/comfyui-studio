// Reusable hook for server-paginated lists. The fetcher takes
// `{ page, pageSize }` and returns `{ items, total, hasMore }`.
//
// Features:
// - `deps` array: changes to these reset page→1 and refetch (use for filter/search state)
// - URL sync: page/pageSize round-trip through query params so refresh preserves state
// - Stale-response guard: rapid page changes drop older responses via a request counter

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface PageResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export type PageFetcher<T> = (params: { page: number; pageSize: number }) => Promise<PageResult<T>>;

export interface UsePaginatedOptions {
  initialPage?: number;
  initialPageSize?: number;
  /** Changes to these reset page→1 and trigger refetch. Use for filter/search state. */
  deps?: unknown[];
  /** Sync `page` / `pageSize` to URL query params. Default true. */
  urlSync?: boolean;
}

export interface UsePaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  setPage: (p: number) => void;
  setPageSize: (n: number) => void;
  refetch: () => Promise<void>;
}

function readUrlInt(params: URLSearchParams, key: string, fallback: number): number {
  const raw = params.get(key);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function usePaginated<T>(
  fetcher: PageFetcher<T>,
  options: UsePaginatedOptions = {},
): UsePaginatedResult<T> {
  const { initialPage = 1, initialPageSize = 25, deps = [], urlSync = true } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  const bootPage = urlSync ? readUrlInt(searchParams, 'page', initialPage) : initialPage;
  const bootSize = urlSync ? readUrlInt(searchParams, 'pageSize', initialPageSize) : initialPageSize;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [page, setPageState] = useState<number>(bootPage);
  const [pageSize, setPageSizeState] = useState<number>(bootSize);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const firstRenderRef = useRef(true);

  const load = useCallback(async (p: number, ps: number) => {
    const id = ++reqIdRef.current;
    setLoading(true);
    try {
      const res = await fetcherRef.current({ page: p, pageSize: ps });
      if (id !== reqIdRef.current) return;
      setItems(res.items);
      setTotal(res.total);
      setHasMore(res.hasMore);
      setError(null);
    } catch (err) {
      if (id !== reqIdRef.current) return;
      console.error('Paginated fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Fetch failed');
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, []);

  // Reset to page 1 when external deps change (filter/search/sort).
  // Skip the reset on first mount so URL-provided page is honored.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    setPageState(1);
  }, deps);

  // Refetch on page/pageSize/deps change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load(page, pageSize);
  }, [load, page, pageSize, ...deps]);

  // Sync page/pageSize to URL.
  useEffect(() => {
    if (!urlSync) return;
    const next = new URLSearchParams(searchParams);
    if (page === initialPage) next.delete('page'); else next.set('page', String(page));
    if (pageSize === initialPageSize) next.delete('pageSize'); else next.set('pageSize', String(pageSize));
    // Only replace when values actually differ to avoid history spam.
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [page, pageSize, urlSync, initialPage, initialPageSize, searchParams, setSearchParams]);

  const setPage = useCallback((p: number) => {
    setPageState(Math.max(1, Math.floor(p)));
  }, []);

  const setPageSize = useCallback((n: number) => {
    const safe = Math.max(1, Math.floor(n));
    setPageSizeState(safe);
    setPageState(1);
  }, []);

  const refetch = useCallback(async () => {
    await load(page, pageSize);
  }, [load, page, pageSize]);

  return {
    items, total, page, pageSize, hasMore, loading, error,
    setPage, setPageSize, refetch,
  };
}
