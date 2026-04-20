import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ExternalLink, ImageOff, Loader2, Check, FileJson } from 'lucide-react';
import { api } from '../../services/comfyui';
import { formatBytes } from '../../lib/utils';
import type { CivitaiModelSummary } from '../../types';

interface Props {
  item: CivitaiModelSummary;
  /** Label for the primary action. Defaults to "Get download URL". */
  actionLabel?: string;
  /**
   * When true, a secondary "Import as template" button is rendered. Clicking
   * pulls the workflow's JSON, persists it as a user template, and navigates
   * to Studio with `?expose=1` so the expose-widgets modal opens for review.
   */
  showImportWorkflow?: boolean;
}

/** Pick the most usable preview thumbnail for a civitai model card. */
function pickThumbnail(item: CivitaiModelSummary): string | null {
  for (const v of item.modelVersions || []) {
    for (const img of v.images || []) {
      if (img.url && (img.type || 'image') === 'image') return img.url;
    }
  }
  return null;
}

function CivitaiCardInner({ item, actionLabel = 'Get download URL', showImportWorkflow = false }: Props) {
  const navigate = useNavigate();
  const thumb = pickThumbnail(item);
  const primaryVersion = item.modelVersions?.[0];
  const creator = item.creator?.username;
  const downloads = item.stats?.downloadCount;
  const rating = item.stats?.rating;

  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const pageUrl = `https://civitai.com/models/${item.id}`;

  const handleImportWorkflow = async () => {
    if (!primaryVersion?.id) {
      setError('This item has no downloadable version');
      return;
    }
    setError(null);
    setImporting(true);
    try {
      const result = await api.importCivitaiWorkflow(primaryVersion.id);
      navigate(`/studio/${encodeURIComponent(result.name)}?expose=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const CIVITAI_TYPE_TO_DIR: Record<string, string> = {
    Checkpoint: 'checkpoints',
    LORA: 'loras',
    LoCon: 'loras',
    LoRA: 'loras',
    VAE: 'vae',
    Controlnet: 'controlnet',
    ControlNet: 'controlnet',
    Upscaler: 'upscale_models',
    TextualInversion: 'embeddings',
    Hypernetwork: 'hypernetworks',
    MotionModule: 'animatediff_models',
    AestheticGradient: 'embeddings',
  };

  const handleDownload = async () => {
    if (!primaryVersion?.id) {
      setError('This item has no downloadable version');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const info = await api.getCivitaiDownloadInfo(primaryVersion.id);
      const primaryFile = info.files?.find((f) => f.primary) || info.files?.[0];
      const url =
        info.downloadUrl ||
        primaryFile?.downloadUrl ||
        primaryVersion.downloadUrl ||
        primaryVersion.files?.find((f) => f.downloadUrl)?.downloadUrl ||
        null;
      if (!url) {
        setError('No download URL exposed by CivitAI for this version');
        return;
      }
      const filename =
        primaryFile?.name ||
        primaryVersion.files?.[0]?.name ||
        `${item.name}.safetensors`;
      const dir = CIVITAI_TYPE_TO_DIR[item.type] || 'checkpoints';
      // Stripped-tag plaintext description: civitai returns HTML; the catalog
      // consumer renders plain text, so crudely strip tags + collapse ws here.
      const plainDescription = item.description
        ? item.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined
        : undefined;
      const sizeKB = primaryFile?.sizeKB ?? primaryVersion.files?.[0]?.sizeKB;
      await api.downloadCustomModel(url, dir, {
        modelName: item.name,
        filename,
        meta: {
          type: item.type,
          description: plainDescription,
          reference: pageUrl,
          size_bytes: typeof sizeKB === 'number' ? Math.round(sizeKB * 1024) : undefined,
          thumbnail: thumb ?? undefined,
          gated: false,
          source: 'civitai',
        },
      });
      // Download tracked server-side; Models page + DownloadsTab show progress.
      setResolvedUrl(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed to start');
    } finally {
      setBusy(false);
    }
  };

  const handleCopyUrl = async () => {
    if (!primaryVersion?.id) {
      setError('This item has no downloadable version');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const info = await api.getCivitaiDownloadInfo(primaryVersion.id);
      const candidate =
        info.downloadUrl ||
        info.files?.find((f) => f.primary)?.downloadUrl ||
        info.files?.[0]?.downloadUrl ||
        primaryVersion.downloadUrl ||
        primaryVersion.files?.find((f) => f.downloadUrl)?.downloadUrl ||
        null;
      if (!candidate) {
        setError('No download URL exposed by CivitAI for this version');
        return;
      }
      setResolvedUrl(candidate);
      try { await navigator.clipboard.writeText(candidate); } catch { /* fallback: URL shown below */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="panel overflow-hidden flex flex-col">
      <div className="aspect-[4/3] bg-slate-100 relative">
        {thumb ? (
          <img
            src={thumb}
            alt={item.name}
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300">
            <ImageOff className="w-8 h-8" />
          </div>
        )}
        {item.type && (
          <span className="absolute top-2 left-2 badge-pill badge-slate !bg-white/90">
            {item.type}
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3
            className="text-sm font-semibold text-slate-900 line-clamp-2"
            title={item.name}
          >
            {item.name}
          </h3>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
          {creator && <span>by {creator}</span>}
          {typeof downloads === 'number' && (
            <span>{downloads.toLocaleString()} downloads</span>
          )}
          {typeof rating === 'number' && rating > 0 && (
            <span>★ {rating.toFixed(1)}</span>
          )}
          {primaryVersion?.baseModel && (
            <span className="badge-pill badge-slate !text-[10px]">{primaryVersion.baseModel}</span>
          )}
        </div>
        {primaryVersion?.files?.[0]?.sizeKB && (
          <p className="text-[11px] text-slate-500 font-mono">
            {formatBytes(primaryVersion.files[0].sizeKB * 1024)}
          </p>
        )}
        {error && (
          <p className="text-[11px] text-rose-600 rounded-md bg-rose-50 border border-rose-100 px-2 py-1">
            {error}
          </p>
        )}
        {resolvedUrl && (
          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-teal-600 hover:text-teal-700 hover:underline font-mono break-all"
          >
            {resolvedUrl}
          </a>
        )}
        <div className="mt-auto flex flex-col gap-2 pt-1">
          {showImportWorkflow && (
            <button
              onClick={handleImportWorkflow}
              disabled={importing || busy}
              className="btn-primary w-full justify-center"
            >
              {importing
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <FileJson className="w-3.5 h-3.5" />}
              {importing ? 'Importing…' : 'Import as template'}
            </button>
          )}
          <div className="flex items-center gap-2">
            {showImportWorkflow ? (
              <button
                onClick={handleCopyUrl}
                disabled={busy || importing}
                className="btn-secondary flex-1 justify-center"
                title="Copy the raw civitai download URL to clipboard"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {actionLabel}
              </button>
            ) : (
              <button
                onClick={handleDownload}
                disabled={busy || importing}
                className="btn-primary flex-1 justify-center"
                title="Download into ComfyUI models folder"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {copied ? 'Started' : 'Download'}
              </button>
            )}
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
      </div>
    </article>
  );
}

const CivitaiCard = memo(CivitaiCardInner);
export default CivitaiCard;
