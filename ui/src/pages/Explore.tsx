import { useMemo, useEffect, useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Layers, WifiOff, Settings, SlidersHorizontal, X, RefreshCw, Upload } from 'lucide-react';
import type { Template, CivitaiModelSummary, StagedImportManifest } from '../types';
import { api } from '../services/comfyui';
import { useApp } from '../context/AppContext';
import { usePersistedState } from '../hooks/usePersistedState';
import { usePaginated } from '../hooks/usePaginated';
import Pagination from '../components/Pagination';
import TemplateCard, { CivitaiTemplateCard } from '../components/TemplateCard';
import PageSubbar from '../components/PageSubbar';
import ImportWorkflowModal from '../components/ImportWorkflowModal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';

type ReadyFilter = 'all' | 'yes' | 'no';
type SourceFilter = 'all' | 'open' | 'api' | 'user' | 'civitai';

interface RefreshBannerState {
  kind: 'success' | 'error';
  message: string;
}

// Shared row type for the server-paginated grid. Keeps one fetcher path and
// lets `TemplateCard` / `CivitaiTemplateCard` render side-by-side without
// breaking pagination alignment.
type ExploreRow =
  | { kind: 'template'; template: Template }
  | { kind: 'civitai'; item: CivitaiModelSummary };

const categories = ['All', 'Use Cases', 'Image', 'Video', 'Audio', '3D Model', 'LLM', 'Utility', 'Getting Started'];

export default function Explore() {
  const { templates, connected, refreshTemplates, apiKeyConfigured } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);
  const [activeCategory, setActiveCategory] = usePersistedState('explore.category', 'All');
  const [searchQuery, setSearchQuery] = usePersistedState('explore.search', '');
  // Debounced mirror of searchQuery used for the actual fetch. Without this,
  // every keystroke triggers a civitai round-trip + 24 image swaps → jank.
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery]);
  const [activeTags, setActiveTags] = usePersistedState<string[]>('explore.tags', []);
  const [filtersOpen, setFiltersOpen] = usePersistedState('explore.filtersOpen', false);
  const [sourceFilter, setSourceFilter] = usePersistedState<SourceFilter>('explore.source', 'all');
  const [readyFilter, setReadyFilter] = usePersistedState<ReadyFilter>('explore.ready', 'all');
  const [deleteBanner, setDeleteBanner] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importInitialManifest, setImportInitialManifest] = useState<StagedImportManifest | null>(null);
  const [importBanner, setImportBanner] = useState<string | null>(null);

  // Allow `?source=civitai` deep-links (used by the legacy
  // /plugins/civitai/workflows redirect) to prime the Source filter once.
  const urlSource = searchParams.get('source');
  useEffect(() => {
    if (urlSource === 'civitai' && sourceFilter !== 'civitai') {
      setSourceFilter('civitai');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSource]);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshBanner, setRefreshBanner] = useState<RefreshBannerState | null>(null);

  // Server-paginated fetch. Filters are forwarded so pagination aligns.
  // When Source = CivitAI the fetcher swaps over to civitai's workflow feed
  // (hot sort when there's no query, search otherwise — mirrors the
  // behaviour of the legacy CivitaiWorkflowsView / CivitaiModelsView).
  const fetcher = useCallback(
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      if (sourceFilter === 'civitai') {
        const trimmed = debouncedSearch.trim();
        const res = trimmed
          ? await api.searchCivitaiModels(trimmed, { page, pageSize })
          : await api.getCivitaiHotWorkflows({ page, pageSize });
        return {
          items: res.items.map<ExploreRow>((item) => ({ kind: 'civitai', item })),
          total: res.total,
          hasMore: res.hasMore,
        };
      }
      // Forward the UI source enum straight through — the backend understands
      // `open` / `api` / `user`, and ignores `all`.
      const backendSource =
        sourceFilter === 'all' ? undefined
        : sourceFilter === 'user' ? 'user'
        : sourceFilter;
      const res = await api.getTemplatesPaged(page, pageSize, {
        q: debouncedSearch.trim() || undefined,
        category: activeCategory,
        tags: activeTags.length > 0 ? activeTags : undefined,
        source: backendSource,
        ready: readyFilter,
      });
      return {
        items: res.items.map<ExploreRow>((template) => ({ kind: 'template', template })),
        total: res.total,
        hasMore: res.hasMore,
      };
    },
    [debouncedSearch, activeCategory, activeTags, sourceFilter, readyFilter],
  );
  const paged = usePaginated<ExploreRow>(fetcher, {
    deps: [debouncedSearch, activeCategory, activeTags, sourceFilter, readyFilter],
  });
  const { items: gridRows, refetch } = paged;

  const handleTemplateDeleted = useCallback(
    async (name: string) => {
      setDeleteBanner(`Template "${name}" removed.`);
      await refetch();
      await refreshTemplates();
    },
    [refetch, refreshTemplates],
  );

  const handleImportOpen = useCallback((manifest?: StagedImportManifest | null): void => {
    setImportInitialManifest(manifest ?? null);
    setImportOpen(true);
  }, []);

  const handleImportClose = useCallback((): void => {
    setImportOpen(false);
    setImportInitialManifest(null);
  }, []);

  const handleImported = useCallback(async (imported: string[]): Promise<void> => {
    setImportBanner(
      imported.length === 1
        ? `Imported 1 template.`
        : `Imported ${imported.length} templates.`,
    );
    setImportOpen(false);
    setImportInitialManifest(null);
    // Favour the "user imported" source so the newly added rows are visible.
    setSourceFilter('user');
    await refetch();
    await refreshTemplates();
  }, [refetch, refreshTemplates, setSourceFilter]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshBanner(null);
    try {
      const result = await api.refreshTemplates();
      setRefreshBanner({
        kind: 'success',
        message: `Added ${result.added}, updated ${result.updated}, removed ${result.removed}.`,
      });
      await refetch();
    } catch (err) {
      setRefreshBanner({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Refresh failed',
      });
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, refetch]);

  // Tag options + category counts still derive from the bootstrap templates
  // cached in AppContext (the full list was loaded once for the workflow
  // dropdowns). Keeps the sidebar stable across pages.
  const tagOptions = useMemo(() => {
    const tagCounts = new Map<string, number>();
    templates.forEach(t => {
      t.tags.forEach(tag => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    });
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag]) => tag);
  }, [templates]);

  const toggleTag = (tag: string) => {
    setActiveTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  // Count templates per category
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set('All', templates.length);
    templates.forEach(t => {
      counts.set(t.category, (counts.get(t.category) || 0) + 1);
    });
    return counts;
  }, [templates]);

  const hasActiveFilters =
    activeCategory !== 'All' ||
    !!searchQuery ||
    activeTags.length > 0 ||
    sourceFilter !== 'all' ||
    readyFilter !== 'all';

  return (
    <>
      <PageSubbar
        title="Explore"
        description={`${templates.length} workflows available`}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleImportOpen(null)}
              className="btn-primary"
              aria-label="Import workflow"
              title="Import a workflow from a .json or .zip file"
            >
              <Upload className="w-3.5 h-3.5" />
              Import workflow
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-secondary"
              aria-label="Refresh templates"
              title="Re-pull template catalog from ComfyUI and recompute readiness"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <button
              onClick={() => setFiltersOpen(o => !o)}
              className="btn-secondary lg:hidden"
              aria-label="Toggle filters"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
            </button>
          </div>
        }
      />
      <div className="page-container">
        <div className="panel">
          <div className="flex flex-col lg:flex-row min-h-[calc(100vh-180px)]">
            {/* ===== Left sidebar ===== */}
            <aside className={`${filtersOpen ? 'block' : 'hidden'} lg:block w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 p-4 space-y-5 bg-white`}>
              {/* Search */}
              <div>
                <label className="field-label mb-1.5 block">Search</label>
                <div className="field-wrap">
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    className="field-input"
                    placeholder="Search workflows..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Source — always shown now. User imported + CivitAI don't
                  require an API key; only the `api` option does. */}
              <div>
                <label className="field-label mb-1.5 block">Source</label>
                <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as SourceFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="open">ComfyUI (open source)</SelectItem>
                    {apiKeyConfigured && (
                      <SelectItem value="api">API (external providers)</SelectItem>
                    )}
                    <SelectItem value="user">User imported</SelectItem>
                    <SelectItem value="civitai">CivitAI</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Ready to use — local templates only. Not meaningful for
                  remote civitai workflow listings. */}
              {sourceFilter !== 'civitai' && (
                <div>
                  <label className="field-label mb-1.5 block">Ready to use</label>
                  <Select value={readyFilter} onValueChange={(v) => setReadyFilter(v as ReadyFilter)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="yes">Ready</SelectItem>
                      <SelectItem value="no">Missing deps</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Category — local templates only. CivitAI exposes its own
                  taxonomy we don't map through. */}
              {sourceFilter !== 'civitai' && (
                <div>
                  <label className="field-label mb-1.5 block">Category</label>
                  <Select value={activeCategory} onValueChange={setActiveCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map(cat => {
                        const count = categoryCounts.get(cat) || 0;
                        if (cat !== 'All' && count === 0) return null;
                        return (
                          <SelectItem key={cat} value={cat}>
                            {cat} {count > 0 && <span className="text-slate-400">({count})</span>}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Tags — local templates only. */}
              {sourceFilter !== 'civitai' && tagOptions.length > 0 && (
                <div>
                  <label className="field-label mb-1.5 block">Tags</label>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {tagOptions.map(tag => (
                      <label
                        key={tag}
                        className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none hover:text-slate-900"
                      >
                        <Checkbox
                          checked={activeTags.includes(tag)}
                          onCheckedChange={() => toggleTag(tag)}
                        />
                        {tag}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="pt-4 border-t border-slate-200">
                <label className="field-label mb-3 block">Stats</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="stat-box bg-slate-50 ring-slate-200">
                    <p className="stat-box-label text-slate-500">Total</p>
                    <p className="stat-box-value text-slate-700">{templates.length}</p>
                  </div>
                  <div className="stat-box bg-teal-50 ring-teal-100">
                    <p className="stat-box-label text-teal-700/70">Filtered</p>
                    <p className="stat-box-value text-teal-700">{paged.total}</p>
                  </div>
                </div>
              </div>

              {/* Clear filters */}
              <div className="pt-4 border-t border-slate-200">
                <button
                  onClick={() => { setActiveCategory('All'); setSearchQuery(''); setActiveTags([]); setSourceFilter('all'); setReadyFilter('all'); }}
                  className="btn-secondary w-full justify-center"
                  disabled={!hasActiveFilters}
                >
                  <X className="w-3.5 h-3.5" />
                  Clear Filters
                </button>
              </div>
            </aside>

            {/* ===== Right content ===== */}
            <main className="flex-1 p-4 overflow-y-auto">
              {refreshBanner && (
                <div
                  role="status"
                  className={`mb-3 flex items-start justify-between gap-2 rounded-md px-3 py-2 text-xs ring-1 ring-inset ${
                    refreshBanner.kind === 'success'
                      ? 'badge-emerald'
                      : 'badge-rose'
                  }`}
                >
                  <span className="font-medium">{refreshBanner.message}</span>
                  <button
                    type="button"
                    onClick={() => setRefreshBanner(null)}
                    className="text-current/60 hover:text-current"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {deleteBanner && (
                <div
                  role="status"
                  className="mb-3 flex items-start justify-between gap-2 rounded-md px-3 py-2 text-xs ring-1 ring-inset badge-emerald"
                >
                  <span className="font-medium">{deleteBanner}</span>
                  <button
                    type="button"
                    onClick={() => setDeleteBanner(null)}
                    className="text-current/60 hover:text-current"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {importBanner && (
                <div
                  role="status"
                  className="mb-3 flex items-start justify-between gap-2 rounded-md px-3 py-2 text-xs ring-1 ring-inset badge-emerald"
                >
                  <span className="font-medium">{importBanner}</span>
                  <button
                    type="button"
                    onClick={() => setImportBanner(null)}
                    className="text-current/60 hover:text-current"
                    aria-label="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {sourceFilter !== 'civitai' && templates.length === 0 ? (
                <div className="text-center py-20">
                  {!connected ? (
                    <>
                      <WifiOff className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-500">Connect to ComfyUI to load workflows</p>
                      <p className="text-xs text-slate-400 mt-1 mb-4">Workflows will appear once ComfyUI is running</p>
                      <button
                        onClick={() => navigate('/settings')}
                        className="btn-secondary"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Check Settings
                      </button>
                    </>
                  ) : (
                    <>
                      <Layers className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                      <p className="text-sm font-medium text-slate-500">No workflows available</p>
                      <p className="text-xs text-slate-400 mt-1">Start ComfyUI to load workflow templates</p>
                    </>
                  )}
                </div>
              ) : gridRows.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {gridRows.map((row) =>
                    row.kind === 'template' ? (
                      <TemplateCard
                        key={`t-${row.template.name}`}
                        template={row.template}
                        onDeleted={handleTemplateDeleted}
                      />
                    ) : (
                      <CivitaiTemplateCard
                        key={`c-${row.item.id}`}
                        item={row.item}
                        onStagedImport={(manifest) => handleImportOpen(manifest)}
                      />
                    ),
                  )}
                </div>
              ) : (
                <div className="text-center py-16">
                  <Layers className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">
                    {sourceFilter === 'civitai'
                      ? searchQuery.trim()
                        ? `No CivitAI results for "${searchQuery}"`
                        : 'No CivitAI workflows found.'
                      : 'No workflows match your filters'}
                  </p>
                  {sourceFilter !== 'civitai' && (
                    <button
                      onClick={() => { setActiveCategory('All'); setSearchQuery(''); setActiveTags([]); setSourceFilter('all'); setReadyFilter('all'); }}
                      className="text-xs text-teal-600 hover:text-teal-700 mt-2"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4">
                <Pagination
                  page={paged.page}
                  pageSize={paged.pageSize}
                  total={paged.total}
                  hasMore={paged.hasMore}
                  onPageChange={paged.setPage}
                  onPageSizeChange={paged.setPageSize}
                  className="rounded-lg border border-slate-200 bg-slate-50"
                />
              </div>
            </main>
          </div>
        </div>
      </div>
      <ImportWorkflowModal
        open={importOpen}
        onClose={handleImportClose}
        initialManifest={importInitialManifest}
        onImported={handleImported}
      />
    </>
  );
}

// Re-exported so siblings (e.g. CivitaiTemplateCard) can hand a pre-staged
// manifest to the modal without lifting state up to App.
export type { StagedImportManifest };
