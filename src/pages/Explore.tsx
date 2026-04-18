import { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Layers, WifiOff, Settings, SlidersHorizontal, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { usePersistedState } from '../hooks/usePersistedState';
import TemplateCard from '../components/TemplateCard';
import PageSubbar from '../components/PageSubbar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';

const categories = ['All', 'Use Cases', 'Image', 'Video', 'Audio', '3D Model', 'LLM', 'Utility', 'Getting Started'];

export default function Explore() {
  const { templates, connected, refreshTemplates, apiKeyConfigured } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);
  const [activeCategory, setActiveCategory] = usePersistedState('explore.category', 'All');
  const [searchQuery, setSearchQuery] = usePersistedState('explore.search', '');
  const [activeTags, setActiveTags] = usePersistedState<string[]>('explore.tags', []);
  const [filtersOpen, setFiltersOpen] = usePersistedState('explore.filtersOpen', false);
  const [sourceFilter, setSourceFilter] = usePersistedState<'all' | 'open' | 'api'>('explore.source', 'all');

  // Extract unique tags from actual templates, sorted by frequency
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

  const filteredTemplates = useMemo(() => {
    let filtered = templates;

    // Backend already hides API-node workflows when no key is configured.
    // The Source select is only shown when a key exists.
    if (sourceFilter === 'open') {
      filtered = filtered.filter(t => t.openSource !== false);
    } else if (sourceFilter === 'api') {
      filtered = filtered.filter(t => t.openSource === false);
    }

    if (activeCategory !== 'All') {
      filtered = filtered.filter(t =>
        t.category === activeCategory
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.category || '').toLowerCase().includes(q) ||
        (t.username || '').toLowerCase().includes(q) ||
        t.models.some(m => m.toLowerCase().includes(q)) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }

    if (activeTags.length > 0) {
      filtered = filtered.filter(t =>
        activeTags.some(tag => t.tags.includes(tag))
      );
    }

    return filtered;
  }, [templates, apiKeyConfigured, sourceFilter, activeCategory, searchQuery, activeTags]);

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

  const hasActiveFilters = activeCategory !== 'All' || !!searchQuery || activeTags.length > 0 || sourceFilter !== 'all';

  return (
    <>
      <PageSubbar
        title="Explore"
        description={`${templates.length} workflows available`}
        right={
          <button
            onClick={() => setFiltersOpen(o => !o)}
            className="btn-secondary lg:hidden"
            aria-label="Toggle filters"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
          </button>
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

              {/* Source (only shown when API key is configured) */}
              {apiKeyConfigured && (
                <div>
                  <label className="field-label mb-1.5 block">Source</label>
                  <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as 'all' | 'open' | 'api')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="open">ComfyUI (open source)</SelectItem>
                      <SelectItem value="api">API (external providers)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Category */}
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

              {/* Tags */}
              {tagOptions.length > 0 && (
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
                  <div className="rounded-md bg-slate-50 ring-1 ring-inset ring-slate-200 px-3 py-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Total</p>
                    <p className="text-lg font-bold text-slate-700 leading-tight mt-0.5">{templates.length}</p>
                  </div>
                  <div className="rounded-md bg-teal-50 ring-1 ring-inset ring-teal-100 px-3 py-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-teal-700/70">Filtered</p>
                    <p className="text-lg font-bold text-teal-700 leading-tight mt-0.5">{filteredTemplates.length}</p>
                  </div>
                </div>
              </div>

              {/* Clear filters */}
              <div className="pt-4 border-t border-slate-200">
                <button
                  onClick={() => { setActiveCategory('All'); setSearchQuery(''); setActiveTags([]); setSourceFilter('all'); }}
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
              {templates.length === 0 ? (
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
              ) : filteredTemplates.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {filteredTemplates.map(template => (
                    <TemplateCard key={template.name} template={template} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <Layers className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No workflows match your filters</p>
                  <button
                    onClick={() => { setActiveCategory('All'); setSearchQuery(''); setActiveTags([]); setSourceFilter('all'); }}
                    className="text-xs text-teal-600 hover:text-teal-700 mt-2"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
