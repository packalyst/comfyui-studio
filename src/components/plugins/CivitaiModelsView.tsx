import { useCallback, useMemo, useState } from 'react';
import {
  Loader2, Search, AlertTriangle, Flame, Sparkles, ChevronDown, ChevronRight,
} from 'lucide-react';
import { api } from '../../services/comfyui';
import type { CivitaiModelSummary } from '../../types';
import { usePaginated } from '../../hooks/usePaginated';
import Pagination from '../Pagination';
import CivitaiCard from './CivitaiCard';

type Sort = 'hot' | 'latest';

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function Grid({
  items, actionLabel, loading, error, empty,
}: {
  items: CivitaiModelSummary[];
  actionLabel: string;
  loading: boolean;
  error: string | null;
  empty: string;
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 flex items-center gap-2 text-xs text-rose-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        {error}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="panel overflow-hidden">
            <div className="aspect-[4/3] bg-slate-100 animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-3 bg-slate-100 rounded animate-pulse w-3/4" />
              <div className="h-2 bg-slate-100 rounded animate-pulse w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return <div className="empty-box">{empty}</div>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {items.map((item) => (
        <CivitaiCard key={item.id} item={item} actionLabel={actionLabel} />
      ))}
    </div>
  );
}

/**
 * CivitAI models browser. Free-text search (cursor-based on the upstream)
 * plus hot/latest sort tabs. The "paste-a-URL" power-user control is tucked
 * into an "Advanced" disclosure below the search bar.
 */
export default function CivitaiModelsView() {
  const [sort, setSort] = useState<Sort>('hot');
  const [queryInput, setQueryInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');

  // URL-paste override — when non-null, the view renders the by-url envelope
  // and ignores the sort/query pagination hook. Cleared by any sort/query
  // change.
  const [urlOverride, setUrlOverride] = useState<{
    items: CivitaiModelSummary[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
    error: string | null;
    loading: boolean;
  } | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [urlOpen, setUrlOpen] = useState(false);

  const fetcher = useCallback(
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      if (activeQuery) {
        // Search path: civitai requires cursor pagination, so page-2+ from
        // the hook is best-effort — we only honour page 1 here and signal
        // no-more. Users who want deeper search drill-down can refine the
        // query or use Advanced → paste URL.
        const data = await api.searchCivitaiModels(activeQuery, { page: 1, pageSize });
        return { items: data.items, total: data.total, hasMore: false };
      }
      const data = sort === 'hot'
        ? await api.getCivitaiHotModels({ page, pageSize })
        : await api.getCivitaiLatestModels({ page, pageSize });
      return { items: data.items, total: data.total, hasMore: data.hasMore };
    },
    [sort, activeQuery],
  );

  const pagState = usePaginated<CivitaiModelSummary>(fetcher, {
    initialPage: 1,
    initialPageSize: 24,
    deps: [sort, activeQuery],
  });

  const submitSearch = useCallback(() => {
    setUrlOverride(null);
    setActiveQuery(queryInput.trim());
  }, [queryInput]);

  const submitUrl = useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!isHttpUrl(trimmed)) {
      setUrlOverride({
        items: [], page: 1, pageSize: 24, total: 0, hasMore: false,
        error: 'URL must start with http:// or https://', loading: false,
      });
      return;
    }
    setUrlOverride({ items: [], page: 1, pageSize: 24, total: 0, hasMore: false, error: null, loading: true });
    try {
      const data = await api.getCivitaiByUrl(trimmed);
      setUrlOverride({
        items: data.items,
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        hasMore: data.hasMore,
        error: null,
        loading: false,
      });
    } catch (err) {
      setUrlOverride({
        items: [], page: 1, pageSize: 24, total: 0, hasMore: false,
        error: err instanceof Error ? err.message : 'Failed to load URL',
        loading: false,
      });
    }
  }, [urlInput]);

  const renderView = useMemo(() => {
    if (urlOverride) {
      return {
        items: urlOverride.items,
        page: urlOverride.page,
        pageSize: urlOverride.pageSize,
        total: urlOverride.total,
        hasMore: urlOverride.hasMore,
        loading: urlOverride.loading,
        error: urlOverride.error,
      };
    }
    return {
      items: pagState.items,
      page: pagState.page,
      pageSize: pagState.pageSize,
      total: pagState.total,
      hasMore: pagState.hasMore,
      loading: pagState.loading,
      error: pagState.error,
    };
  }, [urlOverride, pagState]);

  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="flex flex-col md:flex-row md:items-center gap-2 p-3">
          <div
            role="tablist"
            aria-label="Models sort"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1"
          >
            <button
              role="tab"
              aria-selected={sort === 'hot'}
              onClick={() => { setSort('hot'); setUrlOverride(null); }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                sort === 'hot' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              Hot
            </button>
            <button
              role="tab"
              aria-selected={sort === 'latest'}
              onClick={() => { setSort('latest'); setUrlOverride(null); }}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                sort === 'latest' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Latest
            </button>
          </div>
          <div className="flex-1 field-wrap">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="search"
              className="field-input"
              placeholder="Search civitai models…"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
            />
          </div>
          <button
            type="button"
            onClick={submitSearch}
            className="btn-primary"
          >
            Search
          </button>
        </div>

        {/* Advanced: paste-a-URL filter. Collapsed by default. */}
        <div className="border-t border-slate-100">
          <button
            type="button"
            onClick={() => setUrlOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 hover:bg-slate-50"
          >
            {urlOpen
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />}
            Advanced — paste a civitai.com URL
          </button>
          {urlOpen && (
            <div className="flex items-center gap-2 px-3 pb-3">
              <div className="flex-1 field-wrap">
                <input
                  type="url"
                  className="field-input font-mono"
                  placeholder="https://civitai.com/models?tag=anime&..."
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitUrl(); }}
                  disabled={urlOverride?.loading}
                />
              </div>
              <button
                onClick={submitUrl}
                disabled={urlOverride?.loading || !urlInput.trim()}
                className="btn-secondary"
              >
                {urlOverride?.loading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Search className="w-3.5 h-3.5" />}
                Fetch
              </button>
              {urlOverride && (
                <button onClick={() => setUrlOverride(null)} className="btn-secondary">
                  Reset
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <Grid
        items={renderView.items}
        actionLabel="Get download URL"
        loading={renderView.loading}
        error={renderView.error}
        empty={activeQuery ? `No results for "${activeQuery}"` : 'No models found.'}
      />

      {!urlOverride && (
        <Pagination
          page={renderView.page}
          pageSize={renderView.pageSize}
          total={renderView.total}
          hasMore={renderView.hasMore}
          onPageChange={pagState.setPage}
          onPageSizeChange={pagState.setPageSize}
          className="rounded-lg border border-slate-200 bg-white"
          hideWhenEmpty
        />
      )}
    </div>
  );
}
