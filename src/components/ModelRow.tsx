import { memo } from 'react';
import {
  Trash2, Loader2, Download, X, Lock, AlertTriangle,
} from 'lucide-react';
import type { CatalogModel, DownloadState } from '../types';
import { formatBytes } from '../lib/utils';

export interface ModelRowDownload {
  modelName: string;
  downloadId: string;
  progress: number;
  status: DownloadState['status'];
}

interface Props {
  model: CatalogModel;
  download?: ModelRowDownload;
  isRequired: boolean;
  selectedWorkflow: string;
  hfTokenConfigured: boolean;
  showTypeBadge?: boolean;
  onInstall: (model: CatalogModel) => void;
  onDelete: (model: CatalogModel) => void;
  onCancelDownload: (modelName: string, downloadId: string) => void;
  onNavigateSettings: () => void;
}

function ModelRow({
  model,
  download,
  isRequired,
  selectedWorkflow,
  hfTokenConfigured,
  showTypeBadge,
  onInstall,
  onDelete,
  onCancelDownload,
  onNavigateSettings,
}: Props) {
  // Show the in-flight state when either a live WS download arrived OR the
  // catalog row carries `downloading: true` (pre-populated at download-start).
  const isDownloading = !!download || !!model.downloading;

  return (
    <div className="flex items-center gap-3 py-2.5 px-4 hover:bg-slate-50">
      {/* Optional preview thumbnail on the left. Falls back to nothing so the
          row layout stays identical for rows without one. */}
      {model.thumbnail ? (
        <img
          src={model.thumbnail}
          alt=""
          loading="lazy"
          className="w-8 h-8 rounded object-cover ring-1 ring-slate-200 bg-slate-100 shrink-0"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : null}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">
          {model.filename || model.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {showTypeBadge && model.type && (
            <span className="badge-pill badge-slate">{model.type}</span>
          )}
          {model.fileSize ? (
            <span className="text-[11px] text-slate-500">{formatBytes(model.fileSize)}</span>
          ) : model.size_bytes ? (
            <span className="text-[11px] text-slate-500">{model.size_pretty || formatBytes(model.size_bytes)}</span>
          ) : null}
          {isDownloading ? (
            <span className="badge-pill badge-teal">
              <Loader2 className="w-3 h-3 animate-spin" /> Downloading
            </span>
          ) : model.installed && model.fileStatus !== 'corrupt' && model.fileStatus !== 'incomplete' ? (
            <span className="badge-pill badge-emerald">Installed</span>
          ) : model.fileStatus === 'corrupt' ? (
            <span
              className="badge-pill bg-red-50 text-red-700 ring-red-200 inline-flex items-center gap-1"
              title={`On disk: ${formatBytes(model.fileSize || 0)} — expected ${model.size_pretty || formatBytes(model.size_bytes)}`}
            >
              <AlertTriangle className="w-3 h-3" /> Corrupt
            </span>
          ) : model.fileStatus === 'incomplete' ? (
            <span
              className="badge-pill badge-amber"
              title={`On disk: ${formatBytes(model.fileSize || 0)} — expected ${model.size_pretty || formatBytes(model.size_bytes)}`}
            >
              <AlertTriangle className="w-3 h-3" /> Incomplete
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">Not installed</span>
          )}
          {model.gated && (
            <span
              className="badge-pill bg-slate-100 text-slate-700 ring-slate-300 inline-flex items-center gap-1"
              title={model.gated_message || 'Requires HuggingFace token'}
            >
              <Lock className="w-3 h-3" /> Gated
            </span>
          )}
          {isRequired && selectedWorkflow && (
            <span className="badge-pill badge-amber">Required</span>
          )}
        </div>
        {model.error && !isDownloading && !model.installed && (
          <p className="text-[11px] text-rose-600 mt-1" title={model.error}>
            Download failed: <span className="font-mono">{model.error}</span>
          </p>
        )}
      </div>
      <div className="shrink-0">
        {download && download.status === 'queued' ? (
          <span className="badge-pill bg-slate-100 text-slate-600 ring-slate-200 inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Queued
          </span>
        ) : download ? (
          <div className="flex items-center gap-2">
            <div className="w-24">
              <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                <span>{Math.round(download.progress)}%</span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${download.progress}%` }}
                />
              </div>
            </div>
            <button
              onClick={() => onCancelDownload(model.name, download.downloadId)}
              className="btn-icon"
              title="Cancel download"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : model.installed ? (
          <button
            onClick={() => onDelete(model)}
            className="btn-icon hover:!text-red-500"
            title="Delete model"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        ) : model.gated && !hfTokenConfigured ? (
          <button
            onClick={onNavigateSettings}
            className="btn-secondary"
            title={model.gated_message || 'Requires HuggingFace token — click to configure'}
          >
            <Lock className="w-3.5 h-3.5" />
            HF token
          </button>
        ) : (
          <button
            onClick={() => onInstall(model)}
            className="btn-primary"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>
        )}
      </div>
    </div>
  );
}

export default memo(ModelRow);
