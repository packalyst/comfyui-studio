// Detail modal for a single gallery item. Wave F redesign:
// - Visual language matches `ImportWorkflowModal` (panel shell, panel-header
//   row, panel-footer button strip).
// - Shows full metadata (prompt, seed, model, sampler, steps, cfg,
//   dimensions, template) captured from ComfyUI history at execution time.
// - Download + Delete preserved. Regenerate is new and disables with a
//   tooltip when the row has no stored workflow (pre-Wave-F imports).
//
// The modal owns the `regenerating` spinner state and the
// `randomizeSeed` checkbox; every other piece of state (pending delete,
// selection, etc.) stays on the Gallery page.

import { useCallback, useState } from 'react';
import {
  Download, Trash2, X,
  Image as ImageIcon, Music, Sparkles,
  Loader2, AlertCircle,
} from 'lucide-react';
import type { GalleryItem } from '../types';
import { api } from '../services/comfyui';
import { Checkbox } from './ui/checkbox';

interface Props {
  item: GalleryItem;
  onClose: () => void;
  onDelete: () => void;
  /** Fired after a successful regenerate. The promptId is the fresh prompt. */
  onRegenerated?: (newPromptId: string) => void;
}

export default function GalleryDetailModal({
  item, onClose, onDelete, onRegenerated,
}: Props): JSX.Element {
  const [randomizeSeed, setRandomizeSeed] = useState<boolean>(false);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const canRegenerate = Boolean(item.workflowJson);

  const handleRegenerate = useCallback(async () => {
    if (!canRegenerate || regenerating) return;
    setError(null);
    setRegenerating(true);
    try {
      const res = await api.regenerateGalleryItem(item.id, randomizeSeed);
      onRegenerated?.(res.promptId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regenerate failed');
    } finally {
      setRegenerating(false);
    }
  }, [canRegenerate, regenerating, item.id, randomizeSeed, onRegenerated]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (regenerating) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl panel max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="panel-header-row">
          <div className="min-w-0">
            <h2 className="panel-header-title truncate">{item.filename}</h2>
            <p className="panel-header-desc">
              {item.mediaType}
              {item.templateName ? ` · ${item.templateName}` : ''}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="btn-icon"
            onClick={onClose}
            disabled={regenerating}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 flex-1 space-y-4">
          {/* Media viewer */}
          <MediaViewer item={item} />

          {/* Metadata grid */}
          <MetadataSection item={item} />

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-rose-50 border border-rose-100 px-3 py-2 text-xs text-rose-700">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer — Download, Regenerate, Delete. */}
        <div className="panel-footer">
          <label
            className={`flex items-center gap-2 text-[11px] text-slate-600 select-none ${
              canRegenerate ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
            }`}
            title={canRegenerate ? '' : 'Import from ComfyUI to enable'}
          >
            <Checkbox
              checked={randomizeSeed}
              onCheckedChange={(v) => setRandomizeSeed(v === true)}
              disabled={!canRegenerate || regenerating}
            />
            Randomize seed
          </label>
          <div className="flex items-center gap-2">
            <a
              href={item.url || '#'}
              download={item.filename}
              className="btn-secondary"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </a>
            <button
              type="button"
              className="btn-primary"
              onClick={handleRegenerate}
              disabled={!canRegenerate || regenerating}
              title={canRegenerate ? '' : 'Import from ComfyUI to enable'}
            >
              {regenerating
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5" />}
              {regenerating ? 'Queuing…' : 'Regenerate'}
            </button>
            <button
              type="button"
              className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
              onClick={onDelete}
              disabled={regenerating}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media viewer — mirrors the per-mediaType rendering that was inline on the
// old modal. Kept local to this component so the tile grid can keep its
// own thumbnail rendering without sharing state.

function MediaViewer({ item }: { item: GalleryItem }): JSX.Element {
  return (
    <div className="bg-slate-100 rounded-lg flex items-center justify-center overflow-hidden">
      {(() => {
        if (!item.url) return <ImageIcon className="w-16 h-16 text-slate-300" />;
        if (item.mediaType === 'video') {
          return <video src={item.url} controls className="max-h-[60vh] w-full" />;
        }
        if (item.mediaType === 'audio') {
          return (
            <div className="w-full p-8 flex flex-col items-center justify-center gap-4">
              <Music className="w-16 h-16 text-slate-300" />
              <audio src={item.url} controls className="w-full max-w-md" />
            </div>
          );
        }
        return (
          <img
            src={item.url}
            alt={item.filename}
            className="max-h-[60vh] w-full object-contain"
          />
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata panel — two-column key/value list. Hides rows with null/empty
// values; uses mono font for filenames/seeds.

interface MetadataRow {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  multiline?: boolean;
}

function MetadataSection({ item }: { item: GalleryItem }): JSX.Element | null {
  const dimensions = item.width && item.height
    ? `${item.width} × ${item.height}` : null;
  const rows: MetadataRow[] = [
    { label: 'Prompt', value: item.promptText, multiline: true },
    { label: 'Negative prompt', value: item.negativeText || null, multiline: true },
    { label: 'Model', value: item.model, mono: true },
    { label: 'Seed', value: item.seed != null ? String(item.seed) : null, mono: true },
    { label: 'Sampler', value: item.sampler, mono: true },
    { label: 'Steps', value: item.steps != null ? String(item.steps) : null },
    { label: 'CFG', value: item.cfg != null ? String(item.cfg) : null },
    { label: 'Dimensions', value: dimensions },
    { label: 'Template', value: item.templateName },
  ].filter((r) => r.value != null && r.value !== '');

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-[11px] text-slate-500">
        No generation metadata was captured for this item. Regenerate is
        unavailable until you re-import from ComfyUI.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Generation details
      </div>
      <dl className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[140px_1fr] gap-2 px-3 py-2 text-xs">
            <dt className="text-slate-500">{r.label}</dt>
            <dd
              className={
                (r.mono ? 'font-mono ' : '') +
                (r.multiline ? 'whitespace-pre-wrap break-words ' : 'truncate ') +
                'text-slate-800'
              }
              title={r.value ?? ''}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
