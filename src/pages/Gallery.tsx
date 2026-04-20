import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download, Trash2, Star, StarOff, Check, X,
  Image as ImageIcon, Video, Music, ArrowRight, SlidersHorizontal,
  LayoutGrid, CheckSquare,
} from 'lucide-react';
import type { GalleryItem } from '../types';
import { api } from '../services/comfyui';
import { usePersistedState } from '../hooks/usePersistedState';
import { usePaginated } from '../hooks/usePaginated';
import Pagination from '../components/Pagination';
import PageSubbar from '../components/PageSubbar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';

type FilterType = 'all' | 'image' | 'video' | 'audio';
type SortBy = 'newest' | 'oldest';

export default function Gallery() {
  const navigate = useNavigate();

  const [filter, setFilter] = usePersistedState<FilterType>('gallery.filter', 'all');
  const [sortBy, setSortBy] = usePersistedState<SortBy>('gallery.sortBy', 'newest');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewItem, setViewItem] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = usePersistedState('gallery.filtersOpen', false);
  const [onlyFavorites, setOnlyFavorites] = usePersistedState('gallery.onlyFavorites', false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('comfyui-studio-favorites');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Server-paginated: media-type + sort apply globally; favorites stay
  // client-side (localStorage) so they filter the current page only.
  const fetcher = useCallback(
    async ({ page, pageSize }: { page: number; pageSize: number }) => {
      const res = await api.getGalleryPaged(page, pageSize, {
        mediaType: filter !== 'all' ? filter : undefined,
        sort: sortBy,
      });
      return { items: res.items, total: res.total, hasMore: res.hasMore };
    },
    [filter, sortBy],
  );
  const paged = usePaginated<GalleryItem>(fetcher, { deps: [filter, sortBy] });
  const { items: pageItems } = paged;

  const filteredGallery = useMemo(() => {
    if (!onlyFavorites) return pageItems;
    return pageItems.filter((item) => favorites.has(item.id));
  }, [pageItems, onlyFavorites, favorites]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFavorite = (id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('comfyui-studio-favorites', JSON.stringify([...next]));
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredGallery.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredGallery.map(i => i.id)));
    }
  };

  const bulkSelecting = selectedIds.size > 0;

  return (
    <>
      <PageSubbar
        title="Gallery"
        description={`${paged.total} generations`}
        right={
          bulkSelecting ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{selectedIds.size} selected</span>
              <button className="btn-secondary">
                <Download className="w-3.5 h-3.5" />
                Download
              </button>
              <button className="btn-secondary text-red-600 border-red-200 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="btn-icon"
                aria-label="Clear selection"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setFiltersOpen(o => !o)}
              className="btn-secondary lg:hidden"
              aria-label="Toggle filters"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
            </button>
          )
        }
      />
      <div className="page-container">
        <div className="panel">
          <div className="flex flex-col lg:flex-row min-h-[calc(100vh-180px)]">
            {/* ===== Left sidebar ===== */}
            <aside className={`${filtersOpen ? 'block' : 'hidden'} lg:block w-full lg:w-72 shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 p-4 space-y-5 bg-white`}>
              {/* Media Type filter */}
              <div>
                <label className="field-label mb-1.5 block">Media Type</label>
                <div className="btn-group w-full">
                  {([
                    { key: 'all', label: 'All', icon: LayoutGrid },
                    { key: 'image', label: 'Image', icon: ImageIcon },
                    { key: 'video', label: 'Video', icon: Video },
                    { key: 'audio', label: 'Audio', icon: Music },
                  ] as { key: FilterType; label: string; icon: React.ComponentType<{ className?: string }> }[]).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      className={`flex-1 justify-center ${filter === key ? 'btn-primary' : 'btn-secondary'}`}
                      title={label}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Sort order */}
              <div>
                <label className="field-label mb-1.5 block">Sort by</label>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Favorites toggle */}
              <div>
                <label className="field-label mb-1.5 block">Show</label>
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <Checkbox checked={onlyFavorites} onCheckedChange={(v) => setOnlyFavorites(v === true)} />
                  Favorites only
                </label>
              </div>

              {/* Selection actions */}
              <div className="pt-4 border-t border-slate-200">
                <label className="field-label mb-1.5 block">Selection</label>
                <button onClick={selectAll} className="btn-secondary w-full justify-center">
                  {selectedIds.size === filteredGallery.length && filteredGallery.length > 0 ? (
                    <><X className="w-3.5 h-3.5" />Deselect All</>
                  ) : (
                    <><CheckSquare className="w-3.5 h-3.5" />Select All</>
                  )}
                </button>
              </div>

              {/* Stats */}
              <div className="pt-4 border-t border-slate-200">
                <label className="field-label mb-3 block">Stats</label>
                <div className="grid grid-cols-2 gap-2">
                  <div className="stat-box bg-slate-50 ring-slate-200">
                    <p className="stat-box-label text-slate-500">Total</p>
                    <p className="stat-box-value text-slate-700">{paged.total}</p>
                  </div>
                  <div className="stat-box bg-amber-50 ring-amber-100">
                    <p className="stat-box-label text-amber-700/70">Favorites</p>
                    <p className="stat-box-value text-amber-700">{favorites.size}</p>
                  </div>
                </div>
              </div>
            </aside>

            {/* ===== Right content ===== */}
            <main className="flex-1 p-4 overflow-y-auto">
              {filteredGallery.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {filteredGallery.map(item => {
                    const isSelected = selectedIds.has(item.id);
                    const isFav = favorites.has(item.id);
                    const MediaIcon = item.mediaType === 'video' ? Video : item.mediaType === 'audio' ? Music : ImageIcon;

                    return (
                      <div
                        key={item.id}
                        className={`card overflow-hidden group relative ${isSelected ? 'ring-2 ring-teal-500' : ''}`}
                      >
                        <button
                          onClick={() => setViewItem(item.id)}
                          className="w-full aspect-square bg-slate-100 flex items-center justify-center overflow-hidden"
                        >
                          {item.url && item.mediaType === 'image' ? (
                            <img src={item.url} alt={item.filename} className="w-full h-full object-cover" loading="lazy" />
                          ) : item.url && item.mediaType === 'video' ? (
                            <video src={item.url} className="w-full h-full object-cover" muted />
                          ) : (
                            <MediaIcon className="w-10 h-10 text-slate-300" />
                          )}
                        </button>
                        {/* Overlay controls */}
                        <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); }}
                            className={`p-1 rounded border transition-colors ${
                              isSelected
                                ? 'bg-teal-500 border-teal-500 text-white'
                                : 'bg-white/80 border-slate-300 text-slate-500 hover:bg-white'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
                            className="p-1 bg-white/80 rounded border border-slate-300 text-slate-500 hover:text-yellow-500 transition-colors"
                          >
                            {isFav ? <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" /> : <StarOff className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="p-2">
                          <p className="text-xs text-slate-500 truncate">{item.filename}</p>
                          {item.createdAt && <p className="text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleDateString()}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-20">
                  <ImageIcon className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <p className="text-sm font-medium text-slate-500">
                    {onlyFavorites ? 'No favorites yet' : 'No generations yet'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1 mb-4">
                    {onlyFavorites
                      ? 'Mark items as favorite to see them here'
                      : 'Your generated images, videos, and audio will appear here'}
                  </p>
                  {!onlyFavorites && (
                    <button
                      onClick={() => navigate('/studio')}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
                    >
                      Start Creating
                      <ArrowRight className="w-4 h-4" />
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

      {/* Full-size viewer modal */}
      {viewItem && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-8"
          onClick={() => setViewItem(null)}
        >
          <div className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">
                {filteredGallery.find(i => i.id === viewItem)?.filename}
              </h3>
              <button onClick={() => setViewItem(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden">
              {(() => {
                const item = filteredGallery.find(i => i.id === viewItem);
                if (!item?.url) return <ImageIcon className="w-16 h-16 text-slate-300" />;
                if (item.mediaType === 'video') return <video src={item.url} controls className="max-h-[60vh] w-full" />;
                if (item.mediaType === 'audio') return (
                  <div className="w-full p-8 flex flex-col items-center justify-center gap-4">
                    <Music className="w-16 h-16 text-slate-300" />
                    <audio src={item.url} controls className="w-full max-w-md" />
                  </div>
                );
                return <img src={item.url} alt={item.filename} className="max-h-[60vh] w-full object-contain" />;
              })()}
            </div>
            <div className="flex gap-2 mt-4">
              <a
                href={filteredGallery.find(i => i.id === viewItem)?.url || '#'}
                download={filteredGallery.find(i => i.id === viewItem)?.filename}
                className="btn-primary inline-flex items-center"
              >
                <Download className="w-4 h-4" />
                Download
              </a>
              <button className="btn-secondary text-red-600 border-red-200 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
