import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Image,
  Video,
  Music,
  Layers,
  HardDrive,
  Cpu,
  Cog,
  Loader2,
  WifiOff,
  Settings,
  Square,
  RotateCw,
  ChevronDown,
  FileText,
  Trash2,
  X,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import PageSubbar from '../components/PageSubbar';
import { api } from '../services/comfyui';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '../components/ui/alert-dialog';

type ComfyUIProcessStatus = 'running' | 'stopped' | 'starting' | 'unknown';

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function LogsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getComfyUILogs();
      setLogs(typeof data.logs === 'string' ? data.logs : JSON.stringify(data, null, 2));
    } catch {
      setLogs('Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchLogs();
  }, [open, fetchLogs]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="panel relative w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <h3 className="panel-header-title">ComfyUI Logs</h3>
          <button onClick={onClose} className="btn-icon" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded-lg p-4 min-h-[200px] ring-1 ring-inset ring-slate-200">
            {loading ? 'Loading...' : logs || 'No logs available'}
          </pre>
        </div>
        <div className="panel-footer justify-end">
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="btn-secondary"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

type WipePhase = 'confirm' | 'running' | 'done' | 'error';

function WipeModal({
  phase, mode, logs, errorMsg, onModeChange, onConfirm, onClose,
}: {
  phase: WipePhase;
  mode: 'normal' | 'hard';
  logs: string[];
  errorMsg: string | null;
  onModeChange: (m: 'normal' | 'hard') => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  if (phase === 'confirm') {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Wipe and reinitialize ComfyUI?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops ComfyUI and resets its state. Choose a mode:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 px-1">
            <label className="flex items-start gap-2 cursor-pointer p-2 rounded-md hover:bg-slate-50">
              <input
                type="radio"
                checked={mode === 'normal'}
                onChange={() => onModeChange('normal')}
                className="mt-1"
              />
              <div>
                <p className="text-xs font-medium text-slate-900">Normal</p>
                <p className="text-[11px] text-slate-500">Reset configuration and cache; keeps installed models and plugins.</p>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer p-2 rounded-md hover:bg-slate-50 border border-red-100 bg-red-50/30">
              <input
                type="radio"
                checked={mode === 'hard'}
                onChange={() => onModeChange('hard')}
                className="mt-1"
              />
              <div>
                <p className="text-xs font-medium text-red-700">Hard</p>
                <p className="text-[11px] text-red-600/80">Aggressive wipe: everything goes except essential files. Not reversible.</p>
              </div>
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} className="!bg-red-600 hover:!bg-red-700">
              <Trash2 className="w-3.5 h-3.5" />
              Wipe ({mode})
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={phase !== 'running' ? onClose : undefined} />
      <div className="panel relative w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div className="panel-header flex items-center justify-between">
          <h3 className="panel-header-title flex items-center gap-2">
            {phase === 'running' && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
            {phase === 'done' && <CheckCircle2 className="w-4 h-4 text-teal-600" />}
            {phase === 'error' && <AlertTriangle className="w-4 h-4 text-red-600" />}
            {phase === 'running' ? `Wiping (${mode})…` : phase === 'done' ? 'Wipe complete' : 'Wipe failed'}
          </h3>
          {phase !== 'running' && (
            <button onClick={onClose} className="btn-icon" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs font-mono text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded-lg p-4 min-h-[200px] ring-1 ring-inset ring-slate-200">
            {logs.length === 0 ? 'Starting…' : logs.join('\n')}
            {errorMsg && `\n\nError: ${errorMsg}`}
          </pre>
        </div>
        <div className="panel-footer justify-end">
          <button onClick={onClose} disabled={phase === 'running'} className="btn-secondary">
            {phase === 'running' ? 'Running…' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ControlsProps {
  processStatus: ComfyUIProcessStatus;
  actionLoading: string | null;
  dropdownOpen: boolean;
  setDropdownOpen: (v: boolean) => void;
  onStop: () => void;
  onRestart: () => void;
  onViewLogs: () => void;
  onWipe: () => void;
}

function ComfyUIControls({
  processStatus,
  actionLoading,
  dropdownOpen,
  setDropdownOpen,
  onStop,
  onRestart,
  onViewLogs,
  onWipe,
}: ControlsProps) {
  const editorHref = `${window.location.protocol}//comfyuieditor.${window.location.host.split('.').slice(1).join('.')}`;

  return (
    <div className="flex items-center gap-2">
      {(processStatus === 'running' || processStatus === 'starting') && (
        <div className="btn-group">
          <a
            href={editorHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary !text-blue-600 hover:!bg-blue-50"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Open Editor</span>
          </a>
          <button
            onClick={onStop}
            disabled={actionLoading !== null}
            className="btn-secondary !text-red-600 hover:!bg-red-50"
          >
            {actionLoading === 'stop' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">Stop</span>
          </button>
          <button
            onClick={onRestart}
            disabled={actionLoading !== null || processStatus !== 'running'}
            className="btn-secondary !text-amber-700 hover:!bg-amber-50"
          >
            {actionLoading === 'restart' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCw className="w-3.5 h-3.5" />}
            <span className="hidden md:inline">Restart</span>
          </button>
        </div>
      )}

      {(processStatus === 'running' || processStatus === 'starting') && (
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="btn-icon"
            aria-label="More actions"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
              <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                <button
                  onClick={() => { setDropdownOpen(false); onViewLogs(); }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                  View Logs
                </button>
                <div className="border-t border-slate-100 my-1" />
                <button
                  onClick={() => { setDropdownOpen(false); onWipe(); }}
                  className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  Wipe and Reinitialize
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { systemStats, queueStatus, galleryTotal, recentGallery, connected, loading, launcherStatus } = useApp();
  const navigate = useNavigate();

  const [optimisticStatus, setOptimisticStatus] = useState<ComfyUIProcessStatus | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  const [wipePhase, setWipePhase] = useState<WipePhase | null>(null);
  const [wipeMode, setWipeMode] = useState<'normal' | 'hard'>('normal');
  const [wipeLogs, setWipeLogs] = useState<string[]>([]);
  const [wipeError, setWipeError] = useState<string | null>(null);

  // Poll reset-logs while a wipe is running
  useEffect(() => {
    if (wipePhase !== 'running') return;
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await api.getResetLogs();
        if (!cancelled) setWipeLogs(data.logs || []);
      } catch { /* ignore — the main POST will report errors */ }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [wipePhase]);

  const startWipe = async () => {
    setWipeLogs([]);
    setWipeError(null);
    setWipePhase('running');
    try {
      const result = await api.resetComfyUI(wipeMode);
      if (result.logs) setWipeLogs(result.logs);
      setWipePhase(result.success ? 'done' : 'error');
      if (!result.success) setWipeError(result.message || 'Reset failed');
    } catch (err) {
      setWipeError(String(err));
      setWipePhase('error');
    }
  };

  const closeWipe = () => {
    if (wipePhase === 'running') return;
    setWipePhase(null);
    setWipeLogs([]);
    setWipeError(null);
  };

  const processStatus = useMemo<ComfyUIProcessStatus>(() => {
    if (optimisticStatus) return optimisticStatus;
    if (!launcherStatus) return 'unknown';
    if (launcherStatus.reachable === false) return 'unknown';
    return launcherStatus.running ? 'running' : 'stopped';
  }, [launcherStatus, optimisticStatus]);

  // Clear optimistic status once the real WS-pushed status matches
  useEffect(() => {
    if (!optimisticStatus || !launcherStatus) return;
    const realStatus: ComfyUIProcessStatus = launcherStatus.reachable === false
      ? 'unknown'
      : launcherStatus.running ? 'running' : 'stopped';
    if (realStatus === optimisticStatus) setOptimisticStatus(null);
  }, [launcherStatus, optimisticStatus]);

  const handleStop = async () => {
    setActionLoading('stop');
    try {
      await api.stopComfyUI();
      setOptimisticStatus('stopped');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestart = async () => {
    setActionLoading('restart');
    try {
      await api.restartComfyUI();
      setOptimisticStatus('starting');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  const recentItems = recentGallery;
  const gpu = systemStats && systemStats.devices.length > 0 ? systemStats.devices[0] : null;
  const vramPct = gpu && gpu.vram_total > 0 ? (gpu.vram_used / gpu.vram_total) * 100 : 0;

  const hasInfoStrip = !!(launcherStatus && (
    launcherStatus.versions?.comfyui ||
    launcherStatus.versions?.frontend ||
    launcherStatus.gpuMode ||
    launcherStatus.uptime
  ));

  return (
    <>
      <PageSubbar
        title="Dashboard"
        description="Overview of your ComfyUI instance"
        right={
          <ComfyUIControls
            processStatus={processStatus}
            actionLoading={actionLoading}
            dropdownOpen={dropdownOpen}
            setDropdownOpen={setDropdownOpen}
            onStop={handleStop}
            onRestart={handleRestart}
            onViewLogs={() => setLogsOpen(true)}
            onWipe={() => setWipePhase('confirm')}
          />
        }
      />
      <div className="page-container space-y-4">
        {/* Versions / Uptime strip */}
        {hasInfoStrip && (
          <div className="panel px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-500">
            {launcherStatus?.versions?.comfyui && (
              <span>ComfyUI <strong className="text-slate-700 font-semibold">v{launcherStatus.versions.comfyui}</strong></span>
            )}
            {launcherStatus?.versions?.frontend && (
              <span>Frontend <strong className="text-slate-700 font-semibold">{launcherStatus.versions.frontend}</strong></span>
            )}
            {launcherStatus?.gpuMode && (
              <span>GPU Mode <strong className="text-slate-700 font-semibold">{launcherStatus.gpuMode}</strong></span>
            )}
            {launcherStatus?.uptime && (
              <span>Uptime <strong className="text-slate-700 font-semibold">{launcherStatus.uptime}</strong></span>
            )}
          </div>
        )}

        {/* Not Connected Banner */}
        {!connected && processStatus !== 'stopped' && processStatus !== 'unknown' && (
          <div className="panel px-4 py-3 border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <WifiOff className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-amber-800">Not Connected</h3>
                <p className="text-xs text-amber-700 mt-0.5">ComfyUI is not reachable.</p>
              </div>
              <button
                onClick={() => navigate('/settings')}
                className="btn-secondary !border-amber-200 !text-amber-800 hover:!bg-amber-100"
              >
                <Settings className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Check Settings</span>
              </button>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* GPU */}
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-blue-50">
                <Cpu className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">GPU</h3>
            </div>
            {gpu ? (
              <div>
                <p className="text-sm font-medium text-slate-900 truncate" title={gpu.name}>{gpu.name}</p>
                <div className="mt-2">
                  <div className="flex justify-between text-[11px] text-slate-500 mb-1">
                    <span>VRAM</span>
                    <span>{formatBytes(gpu.vram_used)} / {formatBytes(gpu.vram_total)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        vramPct > 90 ? 'bg-red-500' : vramPct > 70 ? 'bg-amber-500' : 'bg-blue-500'
                      }`}
                      style={{ width: `${vramPct}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <HardDrive className="w-3.5 h-3.5" />
                <span>{connected ? 'No GPU detected' : 'Not connected'}</span>
              </div>
            )}
          </div>

          {/* Queue */}
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-teal-50">
                <Layers className="w-3.5 h-3.5 text-teal-600" />
              </div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Queue</h3>
            </div>
            <div className="flex items-baseline gap-4">
              <div>
                <p className="text-2xl font-bold text-slate-900 leading-none">
                  {connected ? queueStatus.queue_running : '--'}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-1">Running</p>
              </div>
              <div className="h-8 w-px bg-slate-200" />
              <div>
                <p className="text-2xl font-bold text-slate-900 leading-none">
                  {connected ? queueStatus.queue_pending : '--'}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-1">Pending</p>
              </div>
            </div>
          </div>

          {/* Gallery */}
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-purple-50">
                <Image className="w-3.5 h-3.5 text-purple-600" />
              </div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Gallery</h3>
            </div>
            <p className="text-2xl font-bold text-slate-900 leading-none">{galleryTotal}</p>
            <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-2">Total generations</p>
          </div>

          {/* System */}
          <div className="panel p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-md bg-slate-100">
                <Cog className="w-3.5 h-3.5 text-slate-600" />
              </div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">System</h3>
            </div>
            {systemStats ? (
              <div className="space-y-1">
                <div className="flex justify-between items-baseline text-xs">
                  <span className="text-slate-500">PyTorch</span>
                  <span className="font-semibold text-slate-900">{systemStats.system.pytorch_version}</span>
                </div>
                <div className="flex justify-between items-baseline text-xs">
                  <span className="text-slate-500">Python</span>
                  <span className="font-semibold text-slate-900">{systemStats.system.python_version.split(' ')[0]}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Not connected</p>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <label className="field-label mb-2 block">Quick Actions</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={() => navigate('/studio/flux_text_to_image')}
              className="panel p-4 flex items-center gap-3 hover:border-teal-300 transition-colors text-left"
            >
              <div className="p-2 bg-teal-50 rounded-lg">
                <Image className="w-4 h-4 text-teal-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">Generate Image</p>
                <p className="text-xs text-slate-500">Text to image with Flux</p>
              </div>
            </button>
            <button
              onClick={() => navigate('/studio/wan_image_to_video')}
              className="panel p-4 flex items-center gap-3 hover:border-purple-300 transition-colors text-left"
            >
              <div className="p-2 bg-purple-50 rounded-lg">
                <Video className="w-4 h-4 text-purple-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">Generate Video</p>
                <p className="text-xs text-slate-500">Image to video with Wan2.2</p>
              </div>
            </button>
            <button
              onClick={() => navigate('/studio/ace_step_music')}
              className="panel p-4 flex items-center gap-3 hover:border-orange-300 transition-colors text-left"
            >
              <div className="p-2 bg-orange-50 rounded-lg">
                <Music className="w-4 h-4 text-orange-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">Create Music</p>
                <p className="text-xs text-slate-500">Generate with ACE-Step</p>
              </div>
            </button>
          </div>
        </div>

        {/* Recent Generations */}
        {recentItems.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="field-label">Recent Generations</label>
              <button
                onClick={() => navigate('/gallery')}
                className="text-xs text-teal-600 hover:text-teal-700 font-medium"
              >
                View all &rarr;
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {recentItems.map(item => (
                <div key={item.id} className="panel overflow-hidden">
                  <div className="aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">
                    {item.url && item.mediaType === 'image' ? (
                      <img src={item.url} alt={item.filename} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <Image className="w-6 h-6 text-slate-300" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Logs Modal */}
      <LogsModal open={logsOpen} onClose={() => setLogsOpen(false)} />

      {/* Wipe Modal */}
      {wipePhase && (
        <WipeModal
          phase={wipePhase}
          mode={wipeMode}
          logs={wipeLogs}
          errorMsg={wipeError}
          onModeChange={setWipeMode}
          onConfirm={startWipe}
          onClose={closeWipe}
        />
      )}
    </>
  );
}
