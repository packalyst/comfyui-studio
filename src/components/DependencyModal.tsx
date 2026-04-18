import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, AlertTriangle, Download, Loader2, Check, XCircle, Lock } from 'lucide-react';
import type { RequiredModel } from '../types';
import { findDownloadForModel } from '../types';
import { api } from '../services/comfyui';
import { useApp } from '../context/AppContext';

interface Props {
  missing: RequiredModel[];
  onClose: () => void;
  onDownloadComplete: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

interface ViewState {
  status: 'pending' | 'downloading' | 'completed' | 'error';
  taskId?: string;
  progress: number;
  speed?: number;
  error?: string;
}

export default function DependencyModal({ missing, onClose, onDownloadComplete }: Props) {
  const navigate = useNavigate();
  const { downloads, hfTokenConfigured } = useApp();
  // Per-model pending/error state that isn't captured by the global downloads map
  // (e.g. "starting" before the backend has assigned a taskId, or no-URL errors).
  const [localState, setLocalState] = useState<Map<string, ViewState>>(new Map());
  const [starting, setStarting] = useState(false);
  const completedFiredRef = useRef(false);

  const totalSize = missing.reduce((sum, m) => sum + (m.size || 0), 0);

  // Merge local placeholders + live WS downloads (matched by name/filename) into one view.
  const view: Map<string, ViewState> = useMemo(() => {
    const m = new Map<string, ViewState>();
    for (const model of missing) {
      const live = findDownloadForModel(downloads, { name: model.name });
      const local = localState.get(model.name);
      if (live) {
        if (live.completed || live.status === 'completed') {
          m.set(model.name, { status: 'completed', taskId: live.taskId, progress: 100, speed: 0 });
        } else if (live.status === 'error') {
          m.set(model.name, { status: 'error', taskId: live.taskId, progress: live.progress, error: live.error || 'Download failed' });
        } else {
          m.set(model.name, { status: 'downloading', taskId: live.taskId, progress: live.progress, speed: live.speed });
        }
      } else if (local) {
        m.set(model.name, local);
      }
    }
    return m;
  }, [missing, localState, downloads]);

  useEffect(() => {
    if (completedFiredRef.current) return;
    if (view.size !== missing.length) return;
    const allDone = Array.from(view.values()).every(v => v.status === 'completed');
    if (allDone) {
      completedFiredRef.current = true;
      setTimeout(onDownloadComplete, 500);
    }
  }, [view, missing.length, onDownloadComplete]);

  const handleDownloadAll = useCallback(async () => {
    setStarting(true);
    completedFiredRef.current = false;

    for (const model of missing) {
      // Skip if a download for this model is already running.
      if (findDownloadForModel(downloads, { name: model.name })) continue;
      if (!model.url) {
        setLocalState(prev => new Map(prev).set(model.name, { status: 'error', progress: 0, error: 'No download URL available' }));
        continue;
      }
      // Gated models without an HF token configured would 401 at the launcher — skip
      // and leave the gated badge visible so the user can add a token and retry.
      if (model.gated && !hfTokenConfigured) continue;
      setLocalState(prev => new Map(prev).set(model.name, { status: 'downloading', progress: 0 }));
      try {
        await api.downloadCustomModel(model.url, model.directory || 'checkpoints', {
          modelName: model.name,
          filename: model.name,
        });
        // Keep the local 'downloading' placeholder; it's overridden by the live WS state
        // inside `view` once the first progress message arrives.
      } catch (err) {
        setLocalState(prev => new Map(prev).set(model.name, { status: 'error', progress: 0, error: String(err) }));
      }
    }
    setStarting(false);
  }, [missing, downloads]);

  const isAnyActive = Array.from(view.values()).some(d => d.status === 'downloading');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-gray-900">Missing Dependencies</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isAnyActive}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 max-h-80 overflow-y-auto">
          <p className="text-sm text-gray-500 mb-4">
            {isAnyActive
              ? 'Downloading required models...'
              : 'The following models are required but not installed:'}
          </p>
          {missing.some(m => m.gated) && !hfTokenConfigured && (
            <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-800">
                Some models are gated and require a HuggingFace token.
                <button onClick={() => { onClose(); navigate('/settings'); }} className="underline ml-1">
                  Add token in Settings
                </button>
                — gated models will be skipped until configured.
              </div>
            </div>
          )}
          <div className="space-y-3">
            {missing.map((model) => {
              const dl = view.get(model.name);
              return (
                <div
                  key={model.name}
                  className="p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{model.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {model.directory || 'unknown type'}
                        {(model.size_pretty || model.size) ? ` — ${model.size_pretty || formatBytes(model.size!)}` : ''}
                      </p>
                      {model.gated && (
                        <p
                          className="text-[11px] text-amber-700 mt-1 flex items-start gap-1"
                          title={model.gated_message || ''}
                        >
                          <Lock className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span className="truncate">{model.gated_message || 'Requires HuggingFace token (Settings)'}</span>
                        </p>
                      )}
                    </div>
                    <div className="ml-3 flex-shrink-0">
                      {dl?.status === 'completed' ? (
                        <Check className="w-4 h-4 text-teal-500" />
                      ) : dl?.status === 'error' ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : dl?.status === 'downloading' ? (
                        <Loader2 className="w-4 h-4 text-teal-500 animate-spin" />
                      ) : model.size ? (
                        <span className="text-xs text-gray-500">{formatBytes(model.size)}</span>
                      ) : null}
                    </div>
                  </div>
                  {/* Progress bar */}
                  {dl && (dl.status === 'downloading' || dl.status === 'completed') && (
                    <div className="mt-2">
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            dl.status === 'completed' ? 'bg-teal-500' : 'bg-teal-400'
                          }`}
                          style={{ width: `${Math.min(100, dl.progress)}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-gray-400">
                          {dl.status === 'completed' ? 'Complete' : `${Math.round(dl.progress)}%`}
                        </span>
                        {dl.speed && dl.speed > 0 && (
                          <span className="text-[10px] text-gray-400">
                            {formatBytes(dl.speed)}/s
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {dl?.status === 'error' && (
                    <p className="text-[10px] text-red-500 mt-1 truncate">{dl.error}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          {totalSize > 0 && !isAnyActive && view.size === 0 && (
            <p className="text-xs text-gray-500 mb-3">
              Total download size: <span className="font-semibold">{formatBytes(totalSize)}</span>
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={isAnyActive}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Close
            </button>
            <button
              onClick={() => { onClose(); navigate('/models'); }}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Go to Models
            </button>
            {(view.size === 0 || (!isAnyActive && Array.from(view.values()).some(d => d.status === 'error'))) && (
              <button
                onClick={handleDownloadAll}
                disabled={starting || isAnyActive}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {starting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    {view.size > 0 ? 'Retry Download' : 'Download All'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
