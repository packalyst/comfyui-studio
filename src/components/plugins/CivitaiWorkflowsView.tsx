import { useCallback, useState } from 'react';
import { AlertTriangle, Flame, Sparkles, FileJson } from 'lucide-react';
import { api } from '../../services/comfyui';
import type { CivitaiModelSummary } from '../../types';
import { usePaginated } from '../../hooks/usePaginated';
import Pagination from '../Pagination';
import CivitaiCard from './CivitaiCard';

type Sort = 'hot' | 'latest';

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
        <CivitaiCard
          key={item.id}
          item={item}
          actionLabel={actionLabel}
          showImportWorkflow
        />
      ))}
    </div>
  );
}

/**
 * CivitAI workflows browser: hot/latest sort + pagination. Each card exposes
 * the normal "Get download URL" action plus a one-click "Import as template"
 * button that pipes the workflow JSON into the local user-template store.
 */
export default function CivitaiWorkflowsView() {
  const [sort, setSort] = useState<Sort>('hot');

  const fetcher = useCallback(
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      const data = sort === 'hot'
        ? await api.getCivitaiHotWorkflows({ page, pageSize })
        : await api.getCivitaiLatestWorkflows({ page, pageSize });
      return { items: data.items, total: data.total, hasMore: data.hasMore };
    },
    [sort],
  );

  const pag = usePaginated<CivitaiModelSummary>(fetcher, {
    initialPage: 1,
    initialPageSize: 24,
    deps: [sort],
  });

  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="flex flex-col md:flex-row md:items-center gap-2 p-3">
          <div
            role="tablist"
            aria-label="Workflows sort"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1"
          >
            <button
              role="tab"
              aria-selected={sort === 'hot'}
              onClick={() => setSort('hot')}
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
              onClick={() => setSort('latest')}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                sort === 'latest' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Latest
            </button>
          </div>
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-1">
            <FileJson className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            Workflows from civitai.com. Use "Import as template" to add a JSON
            workflow to your Studio templates.
          </p>
        </div>
      </div>

      <Grid
        items={pag.items}
        actionLabel="Get download URL"
        loading={pag.loading}
        error={pag.error}
        empty="No workflows found."
      />

      <Pagination
        page={pag.page}
        pageSize={pag.pageSize}
        total={pag.total}
        hasMore={pag.hasMore}
        onPageChange={pag.setPage}
        onPageSizeChange={pag.setPageSize}
        className="rounded-lg border border-slate-200 bg-white"
      />
    </div>
  );
}
