import { memo, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Image, Video, Music, Box, HardDrive, Cpu, BarChart3,
  MoreHorizontal, Trash2, Loader2, ExternalLink, FileJson, Check, ImageOff,
  Puzzle,
} from 'lucide-react';
import type { Template, CivitaiModelSummary, StagedImportManifest } from '../types';
import { formatBytes } from '../lib/utils';
import { api } from '../services/comfyui';
import ModelBadge from './ModelBadge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './ui/alert-dialog';

interface Props {
  template: Template;
  /** Called after a successful delete so parent can refresh + show a toast. */
  onDeleted?: (name: string) => void;
}

const mediaIcons: Record<string, React.ElementType> = {
  image: Image,
  video: Video,
  audio: Music,
  '3d': Box,
};

const gradientMap: Record<string, string> = {
  image: 'from-blue-400 to-blue-600',
  video: 'from-purple-400 to-purple-600',
  audio: 'from-orange-400 to-orange-600',
  '3d': 'from-green-400 to-green-600',
};

function formatUsage(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M uses`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k uses`;
  return `${count} uses`;
}

function TemplateCardInner({ template, onDeleted }: Props) {
  const navigate = useNavigate();
  const Icon = mediaIcons[template.mediaType] || Image;
  const gradient = gradientMap[template.mediaType] || 'from-gray-400 to-gray-600';
  // User-imported workflows use this category marker — see
  // server/src/services/templates/userTemplates.ts::saveUserWorkflow.
  const isUser = template.category === 'User Workflows';

  const uniqueModels = useMemo(
    () => Array.from(new Set(template.models)).slice(0, 3),
    [template.models],
  );
  const uniqueTags = useMemo(
    () => Array.from(new Set(template.tags)).slice(0, 3),
    [template.tags],
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [installingPlugins, setInstallingPlugins] = useState(false);
  const [pluginStatus, setPluginStatus] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Plugin chip surfaces only when the template declares any plugins AND at
  // least one is not installed. The `installed` flag is filled in by the
  // template list endpoint once Phase 2 backend plumbing is wired; for
  // now we treat "no installed flag set" as missing so the chip surfaces
  // on fresh imports.
  const missingPlugins = useMemo(() => {
    const list = template.plugins ?? [];
    return list.filter((p) => p.installed !== true);
  }, [template.plugins]);

  const handleInstallMissing = useCallback(async () => {
    setInstallingPlugins(true);
    setPluginStatus(null);
    try {
      const result = await api.installMissingPlugins(template.name);
      const queued = result.queued.length;
      const skipped = result.alreadyInstalled.length;
      const unknown = result.unknown.length;
      setPluginStatus(
        `Queued ${queued}, already installed ${skipped}${unknown > 0 ? `, unknown ${unknown}` : ''}`,
      );
    } catch (err) {
      setPluginStatus(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setInstallingPlugins(false);
    }
  }, [template.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const handleCardClick = (): void => {
    const cat = template.studioCategory || template.mediaType || 'image';
    navigate(`/studio/${encodeURIComponent(template.name)}?category=${cat}`);
  };

  const handleConfirmDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await api.deleteTemplate(template.name);
      setConfirmOpen(false);
      onDeleted?.(template.name);
    } catch (err) {
      console.error('Delete template failed:', err);
    } finally {
      setDeleting(false);
    }
  }, [template.name, onDeleted]);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleCardClick();
          }
        }}
        className="card text-left group cursor-pointer overflow-hidden flex flex-col h-full relative"
      >
        <div className="aspect-video shrink-0 relative flex items-center justify-center overflow-hidden">
          {template.name ? (
            <img
              src={`/api/template-asset/${template.name}-1.webp`}
              alt={template.title}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={(e) => {
                // Fall back to gradient on load error
                const target = e.currentTarget;
                target.style.display = 'none';
                target.parentElement?.classList.add('bg-gradient-to-br', ...gradient.split(' '));
              }}
            />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
              <Icon className="w-10 h-10 text-white/60 group-hover:text-white/80 transition-colors" />
            </div>
          )}
          <div className="absolute top-2 right-2 flex items-center gap-1.5">
            {template.ready === true && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/90 text-white">
                Ready
              </span>
            )}
            {isUser && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-500/90 text-white">
                User
              </span>
            )}
            {template.openSource !== undefined && (
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                template.openSource
                  ? 'bg-green-500/90 text-white'
                  : 'bg-gray-500/80 text-white'
              }`}>
                {template.openSource ? 'Open Source' : 'API'}
              </span>
            )}
            <span className={`badge ${
              template.mediaType === 'image' ? 'badge-blue' :
              template.mediaType === 'video' ? 'badge-purple' :
              template.mediaType === 'audio' ? 'badge-orange' :
              'badge-gray'
            }`}>
              {template.mediaType}
            </span>
            {missingPlugins.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPluginsOpen((v) => !v);
                }}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/90 text-white inline-flex items-center gap-1 hover:bg-amber-600"
                title={`${missingPlugins.length} custom-node plugin${missingPlugins.length === 1 ? '' : 's'} missing`}
              >
                <Puzzle className="w-3 h-3" />
                {missingPlugins.length} plugin{missingPlugins.length === 1 ? '' : 's'} missing
              </button>
            )}
          </div>
          {/* Overflow menu — user-imported workflows only. Absolutely positioned
              on top of the thumbnail; clicking never propagates to the card. */}
          {isUser && (
            <div
              ref={menuRef}
              className="absolute top-2 left-2"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Template actions"
                className="btn-icon !bg-white/90 hover:!bg-white ring-1 ring-slate-200"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute top-9 left-0 z-10 min-w-[10rem] rounded-md border border-slate-200 bg-white shadow-lg p-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      setConfirmOpen(true);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete template
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="p-4 flex flex-col flex-1">
          <h3 className="font-semibold text-sm text-gray-900 mb-1 group-hover:text-teal-600 transition-colors line-clamp-1">
            {template.title}
          </h3>
          <div className="relative mb-3 h-[100px]">
            <p className="text-xs text-gray-500 overflow-y-auto h-full pr-1">
              {template.description}
            </p>
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent" />
          </div>
          <div className="mt-auto">
            {/* Stats row */}
            <div className="flex items-center gap-3 mb-3 text-[11px] text-gray-400">
              {template.size !== undefined && (
                <span className="flex items-center gap-1">
                  <HardDrive className="w-3 h-3" />
                  {template.size === 0 ? 'Cloud API' : formatBytes(template.size)}
                </span>
              )}
              {template.vram !== undefined && template.vram > 0 && (
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  {formatBytes(template.vram)}
                </span>
              )}
              {template.usage !== undefined && template.usage > 0 && (
                <span className="flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  {formatUsage(template.usage)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {uniqueModels.map(model => (
                <ModelBadge key={model} name={model} />
              ))}
            </div>
            {uniqueTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {uniqueTags.map(tag => (
                  <span key={tag} className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {pluginsOpen && missingPlugins.length > 0 && (
              <div
                className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-[11px] font-medium text-amber-900 mb-1 inline-flex items-center gap-1">
                  <Puzzle className="w-3 h-3" />
                  Missing plugins
                </div>
                <ul className="space-y-0.5 mb-2">
                  {missingPlugins.map((p) => (
                    <li
                      key={p.repo}
                      className="text-[11px] text-slate-700 font-mono truncate"
                      title={p.repo}
                    >
                      {p.title || p.repo}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleInstallMissing(); }}
                  disabled={installingPlugins}
                  className="btn-primary !text-[11px] !py-1 !px-2"
                >
                  {installingPlugins ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Puzzle className="w-3 h-3" />
                  )}
                  {installingPlugins ? 'Queuing...' : `Install ${missingPlugins.length}`}
                </button>
                {pluginStatus && (
                  <p className="mt-1 text-[10px] text-slate-600">{pluginStatus}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the user-imported workflow{' '}
              <span className="font-mono text-slate-700">{template.title}</span>{' '}
              from your library. The underlying models on disk are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="!bg-red-600 hover:!bg-red-700"
            >
              {deleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const TemplateCard = memo(TemplateCardInner);
export default TemplateCard;

// --- CivitAI workflow card (Explore Source=CivitAI) ----------------------

/** Pick the most usable preview thumbnail for a civitai card. */
/**
 * Rewrite a civitai CDN URL to request a smaller preview size. Civitai
 * serves variants via the `/width=NUMBER/` segment (e.g. `.../width=450/...`).
 * Swap to 320 for grid thumbnails so a 24-card Explore page doesn't pull
 * 24 × several MB of full-res images.
 */
function downsizeCivitaiImageUrl(url: string, width: number): string {
  if (!url) return url;
  if (/\/width=\d+\//.test(url)) return url.replace(/\/width=\d+\//, `/width=${width}/`);
  return url;
}

function pickThumbnail(item: CivitaiModelSummary): string | null {
  for (const v of item.modelVersions || []) {
    for (const img of v.images || []) {
      if (img.url && (img.type || 'image') === 'image') {
        return downsizeCivitaiImageUrl(img.url, 320);
      }
    }
  }
  return null;
}

/**
 * A CivitAI workflow rendered as a TemplateCard-shaped tile. Reuses the same
 * outer `card` class + thumbnail layout so the Explore grid looks uniform
 * whether the current source is local or remote.
 *
 * Primary action = "Import as template" (pipes the workflow JSON through
 * the existing /templates/import-civitai endpoint). Secondary action opens
 * the item on civitai.com.
 */
interface CivitaiTemplateCardProps {
  item: CivitaiModelSummary;
  /**
   * Called when a civitai zip contains multiple workflows. Receives the
   * staged manifest so the parent can pop the import-review modal with the
   * workflows preselected.
   */
  onStagedImport?: (manifest: StagedImportManifest) => void;
}

function CivitaiTemplateCardInner({ item, onStagedImport }: CivitaiTemplateCardProps) {
  const navigate = useNavigate();
  const thumb = pickThumbnail(item);
  const primaryVersion = item.modelVersions?.[0];
  const creator = item.creator?.username;
  const downloads = item.stats?.downloadCount;
  const pageUrl = `https://civitai.com/models/${item.id}`;

  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async (): Promise<void> => {
    if (!primaryVersion?.id) {
      setError('This item has no downloadable version');
      return;
    }
    setError(null);
    setImporting(true);
    try {
      const result = await api.importCivitaiWorkflow(primaryVersion.id);
      if ('staged' in result) {
        // Multi-workflow zip — hand off to the review modal.
        if (onStagedImport) {
          onStagedImport(result.manifest);
        } else {
          setError('Zip contains multiple workflows. Import via Explore to choose.');
        }
        return;
      }
      setImported(true);
      // Send the user straight into the Studio with the expose widgets
      // modal open — matches the legacy CivitaiCard flow.
      navigate(`/studio/${encodeURIComponent(result.name)}?expose=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <article className="card overflow-hidden flex flex-col h-full">
      <div className="aspect-video shrink-0 relative flex items-center justify-center overflow-hidden bg-slate-100">
        {thumb ? (
          <img
            src={thumb}
            alt={item.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300">
            <ImageOff className="w-10 h-10" />
          </div>
        )}
        <div className="absolute top-2 right-2 flex items-center gap-1.5">
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-500/90 text-white">
            CivitAI
          </span>
          {item.type && (
            <span className="badge badge-gray !bg-white/90 !text-slate-700">
              {item.type}
            </span>
          )}
        </div>
      </div>
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-sm text-gray-900 mb-1 line-clamp-1" title={item.name}>
          {item.name}
        </h3>
        <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-2 flex-wrap">
          {creator && <span>by {creator}</span>}
          {typeof downloads === 'number' && <span>{downloads.toLocaleString()} dl</span>}
          {primaryVersion?.baseModel && (
            <span className="badge-pill badge-slate !text-[10px]">{primaryVersion.baseModel}</span>
          )}
        </p>
        {error && (
          <p className="text-[11px] text-rose-600 rounded-md bg-rose-50 border border-rose-100 px-2 py-1 mb-2">
            {error}
          </p>
        )}
        <div className="mt-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="btn-primary flex-1 justify-center"
          >
            {importing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : imported ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <FileJson className="w-3.5 h-3.5" />
            )}
            {importing ? 'Importing…' : imported ? 'Imported' : 'Import as template'}
          </button>
          <a
            href={pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            aria-label="Open on CivitAI"
            title="Open on civitai.com"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

export const CivitaiTemplateCard = memo(CivitaiTemplateCardInner);
