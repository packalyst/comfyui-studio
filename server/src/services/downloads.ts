import { getHfToken } from './settings.js';

const LAUNCHER_URL = process.env.LAUNCHER_URL || 'http://localhost:3000';

export interface DownloadState {
  taskId: string;
  modelName?: string;
  filename?: string;
  progress: number;
  currentModelProgress: number;
  totalBytes: number;
  downloadedBytes: number;
  speed: number;
  status: string;
  completed: boolean;
  error: string | null;
}

export interface DownloadIdentity {
  modelName?: string;
  filename?: string;
}

interface Entry {
  state: DownloadState;
  timer: NodeJS.Timeout;
}

const active = new Map<string, Entry>();
let broadcaster: ((message: object) => void) | null = null;

// Concurrency cap for simultaneous downloads. Configurable via env; defaults to 2.
const MAX_CONCURRENT = (() => {
  const n = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '2', 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
})();

interface QueuedRequest {
  synthId: string;
  hfUrl: string;
  modelDir: string;
  modelName?: string;
  filename?: string;
}
const queue: QueuedRequest[] = [];

export function setDownloadBroadcaster(fn: (message: object) => void) {
  broadcaster = fn;
}

function emit(message: object) {
  if (broadcaster) broadcaster(message);
}

export function getAllDownloads(): DownloadState[] {
  return Array.from(active.values()).map(e => e.state);
}

// Launcher returns progress as 0-1 fraction; normalize to 0-100 percentage for the UI.
function toPercent(v: number | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  return v <= 1 ? v * 100 : v;
}

async function pollOnce(taskId: string): Promise<void> {
  const entry = active.get(taskId);
  if (!entry) return;
  try {
    const res = await fetch(`${LAUNCHER_URL}/api/models/progress/${encodeURIComponent(taskId)}`);
    if (!res.ok) return;
    const data = await res.json() as Partial<DownloadState> & { overallProgress?: number };
    const next: DownloadState = {
      ...entry.state,
      progress: toPercent(data.overallProgress ?? data.progress) ?? entry.state.progress,
      currentModelProgress: toPercent(data.currentModelProgress) ?? entry.state.currentModelProgress,
      totalBytes: data.totalBytes ?? entry.state.totalBytes,
      downloadedBytes: data.downloadedBytes ?? entry.state.downloadedBytes,
      speed: data.speed ?? entry.state.speed,
      status: data.status ?? entry.state.status,
      completed: !!data.completed || data.status === 'completed',
      error: data.error ?? entry.state.error,
    };
    entry.state = next;
    emit({ type: 'download', data: next });

    if (next.completed || next.status === 'completed' || next.status === 'error' || next.status === 'unknown') {
      stopTracking(taskId);
    }
  } catch {
    // transient; keep polling
  }
}

export function findByIdentity(id: DownloadIdentity): DownloadState | undefined {
  for (const entry of active.values()) {
    const s = entry.state;
    if (id.filename && (s.filename === id.filename || s.modelName === id.filename)) return s;
    if (id.modelName && (s.modelName === id.modelName || s.filename === id.modelName)) return s;
  }
  return undefined;
}

export function trackDownload(taskId: string, id: DownloadIdentity = {}): void {
  if (active.has(taskId)) return;
  const state: DownloadState = {
    taskId,
    modelName: id.modelName,
    filename: id.filename,
    progress: 0,
    currentModelProgress: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    speed: 0,
    status: 'downloading',
    completed: false,
    error: null,
  };
  const timer = setInterval(() => { void pollOnce(taskId); }, 1500);
  active.set(taskId, { state, timer });
  emit({ type: 'download', data: state });
  // Kick an immediate poll so the first progress arrives fast.
  void pollOnce(taskId);
}

export function stopTracking(taskId: string): void {
  const entry = active.get(taskId);
  if (!entry) return;
  clearInterval(entry.timer);
  active.delete(taskId);
  emit({ type: 'download', data: { ...entry.state, completed: true } });
  void tryDequeue();
}

export function isAtCapacity(): boolean {
  return active.size >= MAX_CONCURRENT;
}

export function findQueuedByIdentity(id: DownloadIdentity): QueuedRequest | undefined {
  for (const q of queue) {
    if (id.filename && (q.filename === id.filename || q.modelName === id.filename)) return q;
    if (id.modelName && (q.modelName === id.modelName || q.filename === id.modelName)) return q;
  }
  return undefined;
}

/** Enqueue a download request; returns the synthetic task id the UI will see. */
export function enqueueDownload(req: Omit<QueuedRequest, 'synthId'>): string {
  const synthId = 'queued_' + Math.random().toString(36).slice(2, 10);
  queue.push({ synthId, ...req });
  const state: DownloadState = {
    taskId: synthId,
    modelName: req.modelName,
    filename: req.filename,
    progress: 0,
    currentModelProgress: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    speed: 0,
    status: 'queued',
    completed: false,
    error: null,
  };
  emit({ type: 'download', data: state });
  return synthId;
}

/** Try to pull the next queued request and kick it off at the launcher. */
async function tryDequeue(): Promise<void> {
  if (active.size >= MAX_CONCURRENT) return;
  const next = queue.shift();
  if (!next) return;
  try {
    // Include HF token for gated repos (launcher forwards it as Authorization: Bearer).
    const hfToken = getHfToken();
    const bodyPayload: Record<string, unknown> = {
      hfUrl: next.hfUrl, modelDir: next.modelDir, modelName: next.modelName, filename: next.filename,
    };
    if (hfToken && /huggingface\.co/.test(next.hfUrl)) bodyPayload.hfToken = hfToken;
    const res = await fetch(`${LAUNCHER_URL}/api/models/download-custom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });
    if (!res.ok) throw new Error(`launcher returned ${res.status}`);
    const data = await res.json() as { taskId?: string };
    // Retire the synthetic placeholder; the real taskId's broadcasts take over from here.
    emit({
      type: 'download',
      data: {
        taskId: next.synthId, modelName: next.modelName, filename: next.filename,
        progress: 0, currentModelProgress: 0, totalBytes: 0, downloadedBytes: 0, speed: 0,
        status: 'completed', completed: true, error: null,
      },
    });
    if (data.taskId) {
      trackDownload(data.taskId, { modelName: next.modelName, filename: next.filename });
    }
  } catch (err) {
    emit({
      type: 'download',
      data: {
        taskId: next.synthId, modelName: next.modelName, filename: next.filename,
        progress: 0, currentModelProgress: 0, totalBytes: 0, downloadedBytes: 0, speed: 0,
        status: 'error', completed: true, error: String(err),
      },
    });
    // If kick-off fails, try the next one so we don't get stuck.
    void tryDequeue();
  }
}
