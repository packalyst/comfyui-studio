import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type {
  Template,
  SystemStats,
  QueueStatus,
  GalleryItem,
  AppSettings,
  GenerationJob,
  ProgressUpdate,
  LauncherStatus,
  MonitorStats,
  DownloadState,
} from '../types';
import { api } from '../services/comfyui';

interface AppState {
  templates: Template[];
  systemStats: SystemStats | null;
  monitorStats: MonitorStats | null;
  queueStatus: QueueStatus;
  gallery: GalleryItem[];
  galleryTotal: number;
  recentGallery: GalleryItem[];
  settings: AppSettings;
  currentJob: GenerationJob | null;
  connected: boolean;
  loading: boolean;
  launcherStatus: LauncherStatus | null;
  apiKeyConfigured: boolean;
  hfTokenConfigured: boolean;
  downloads: Record<string, DownloadState>;
}

interface AppContextType extends AppState {
  refreshTemplates: () => Promise<void>;
  refreshSystem: () => Promise<void>;
  refreshQueue: () => Promise<void>;
  refreshGallery: () => Promise<void>;
  refreshApiKeyStatus: () => Promise<void>;
  refreshHfTokenStatus: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => void;
  submitGeneration: (templateName: string, inputs: Record<string, unknown>, advancedSettings?: Record<string, { proxyIndex: number; value: unknown }>) => Promise<void>;
  setCurrentJob: (job: GenerationJob | null) => void;
}

const defaultSettings: AppSettings = {
  comfyuiUrl: 'http://localhost:8188',
  gpuUnloadTimeout: 300,
  defaultSteps: 20,
  defaultCfgScale: 7.0,
  defaultWidth: 1024,
  defaultHeight: 1024,
  galleryPath: '/output',
};

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ queue_running: 0, queue_pending: 0 });
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [galleryTotal, setGalleryTotal] = useState<number>(0);
  const [recentGallery, setRecentGallery] = useState<GalleryItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('comfyui-studio-settings');
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
  });
  const [currentJob, setCurrentJob] = useState<GenerationJob | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatus | null>(null);
  const [monitorStats, setMonitorStats] = useState<MonitorStats | null>(null);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [hfTokenConfigured, setHfTokenConfigured] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const systemStatsRef = useRef<SystemStats | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const refreshTemplates = useCallback(async () => {
    try {
      const data = await api.getTemplates();
      setTemplates(data);
    } catch {
      // Keep existing templates if any are cached; don't clear on failure
    }
  }, []);

  const refreshSystem = useCallback(async () => {
    try {
      const data = await api.getSystemStats();
      const { queue, gallery: galleryInfo, ...stats } = data;
      setSystemStats(stats);
      systemStatsRef.current = stats;
      if (queue) setQueueStatus(queue);
      if (galleryInfo) {
        setGalleryTotal(galleryInfo.total);
        setRecentGallery(galleryInfo.recent);
      }
      setConnected(true);
    } catch (err) {
      console.error('Failed to fetch system stats:', err);
    }
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      const data = await api.getQueue();
      setQueueStatus(data);
    } catch {
      // Silently fail — connection status is tracked by refreshSystem
    }
  }, []);

  const refreshGallery = useCallback(async () => {
    try {
      const data = await api.getGallery();
      setGallery(data);
    } catch {
      // Keep existing gallery data on failure
    }
  }, []);

  const refreshApiKeyStatus = useCallback(async () => {
    try {
      const status = await api.getApiKeyStatus();
      setApiKeyConfigured(status.configured);
    } catch {
      setApiKeyConfigured(false);
    }
  }, []);

  const refreshHfTokenStatus = useCallback(async () => {
    try {
      const status = await api.getHfTokenStatus();
      setHfTokenConfigured(status.configured);
    } catch {
      setHfTokenConfigured(false);
    }
  }, []);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial };
      localStorage.setItem('comfyui-studio-settings', JSON.stringify(next));
      return next;
    });
  }, []);

  // Track active prompt ID in a ref so WS callbacks always have the latest value
  const activePromptIdRef = useRef<string | null>(null);
  const outputFetchedRef = useRef(false);
  const outputFetchInFlightRef = useRef(false);

  const fetchOutputFromHistory = useCallback((promptId: string) => {
    // Skip if already resolved or a fetch is already racing for this prompt.
    // (Multiple WS events fire for one completion — without this we'd issue 4+ parallel /api/history calls.)
    if (outputFetchedRef.current || outputFetchInFlightRef.current) return;
    outputFetchInFlightRef.current = true;
    fetch(`/api/history/${promptId}`)
      .then(r => r.json())
      .then(data => {
        if (data.outputs?.length > 0 && !outputFetchedRef.current) {
          outputFetchedRef.current = true;
          const out = data.outputs[0];
          const url = `/api/view?filename=${encodeURIComponent(out.filename)}&subfolder=${encodeURIComponent(out.subfolder || '')}&type=${encodeURIComponent(out.type || 'output')}`;
          setCurrentJob(p => {
            if (!p) return p;
            return { ...p, status: 'completed', progress: 100, outputUrl: url, outputMediaType: out.mediaType, completedAt: new Date().toISOString() };
          });
          // Gallery & queue updates arrive via the backend's WS broadcasts; no REST refresh needed.
        }
      })
      .catch(() => {})
      .finally(() => { outputFetchInFlightRef.current = false; });
  }, []);

  const submitGeneration = useCallback(async (templateName: string, inputs: Record<string, unknown>, advancedSettings?: Record<string, { proxyIndex: number; value: unknown }>) => {
    outputFetchedRef.current = false;
    const job: GenerationJob = {
      id: crypto.randomUUID(),
      templateName,
      status: 'pending',
      progress: 0,
      inputs,
      createdAt: new Date().toISOString(),
    };
    setCurrentJob(job);
    try {
      const result = await api.generate(templateName, inputs, advancedSettings);
      const promptId = result.prompt_id || job.id;
      activePromptIdRef.current = promptId;
      setCurrentJob(prev => prev ? { ...prev, status: 'running', id: promptId } : null);
    } catch (err) {
      setCurrentJob(prev => prev ? { ...prev, status: 'failed' } : null);
      console.error('Generation failed:', err);
    }
  }, []);

  // WebSocket connection for progress
  useEffect(() => {
    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data);
          const promptId = activePromptIdRef.current;

          if (msg.type === 'progress' && msg.data?.value !== undefined && msg.data?.max !== undefined) {
            const progress = (msg.data.value / msg.data.max) * 100;
            setCurrentJob(prev => {
              if (!prev || prev.status === 'completed') return prev;
              return { ...prev, status: 'running', progress };
            });
          } else if (msg.type === 'executing' && msg.data?.node === null) {
            // node=null means execution finished for this prompt
            if (promptId) {
              setTimeout(() => fetchOutputFromHistory(promptId), 500);
            }
          } else if (msg.type === 'executed' && msg.data?.prompt_id === promptId) {
            // Node executed — might have output
            if (promptId) {
              setTimeout(() => fetchOutputFromHistory(promptId), 500);
            }
          } else if (msg.type === 'progress_state') {
            // All nodes report their state — check if all finished
            const nodes = msg.data?.nodes;
            if (nodes && promptId) {
              const allFinished = Object.values(nodes).every((n: unknown) => (n as Record<string, string>).state === 'finished');
              if (allFinished) {
                setTimeout(() => fetchOutputFromHistory(promptId), 500);
              }
            }
          } else if (msg.type === 'execution_complete') {
            if (promptId) {
              setTimeout(() => fetchOutputFromHistory(promptId), 500);
            }
          } else if (msg.type === 'error' || msg.type === 'execution_error' || msg.type === 'execution_interrupted') {
            const errMsg = (msg.data as { exception_message?: string })?.exception_message;
            setCurrentJob(prev => prev ? { ...prev, status: 'failed', error: errMsg } : null);
          } else if (msg.type === 'launcher-status') {
            const status = msg.data as LauncherStatus;
            setLauncherStatus(status);
            setConnected(status.running === true);
            if (status.running && !systemStatsRef.current) {
              refreshSystem();
            }
          } else if (msg.type === 'queue') {
            setQueueStatus(msg.data as QueueStatus);
          } else if (msg.type === 'gallery') {
            const data = msg.data as { total: number; recent: GalleryItem[] };
            setGalleryTotal(data.total);
            setRecentGallery(data.recent);
          } else if (msg.type === 'download') {
            const d = msg.data as DownloadState;
            setDownloads(prev => {
              // Remove from map shortly after terminal state so completed/cancelled items don't linger.
              if (d.completed || d.status === 'completed' || d.status === 'error') {
                // Keep the terminal state visible briefly so the UI can render "done" — purge after 3s.
                setTimeout(() => {
                  setDownloads(p => {
                    const { [d.taskId]: _removed, ...rest } = p;
                    return rest;
                  });
                }, 3000);
              }
              return { ...prev, [d.taskId]: d };
            });
          } else if (msg.type === 'downloads-snapshot') {
            const list = msg.data as DownloadState[];
            setDownloads(Object.fromEntries(list.map(d => [d.taskId, d])));
          } else if (msg.type === 'crystools.monitor') {
            const d = msg.data as {
              cpu_utilization?: number;
              ram_total?: number;
              ram_used?: number;
              ram_used_percent?: number;
              hdd_total?: number;
              hdd_used?: number;
              hdd_used_percent?: number;
              device_type?: string;
              gpus?: Array<{
                gpu_utilization?: number;
                gpu_temperature?: number;
                vram_total?: number;
                vram_used?: number;
              }>;
            };
            setConnected(true);
            setMonitorStats({
              cpu_utilization: d.cpu_utilization,
              ram_total: d.ram_total,
              ram_used: d.ram_used,
              ram_used_percent: d.ram_used_percent,
              hdd_total: d.hdd_total,
              hdd_used: d.hdd_used,
              hdd_used_percent: d.hdd_used_percent,
              device_type: d.device_type,
            });
            setSystemStats(prev => {
              if (!prev) return prev;
              const next = {
                ...prev,
                devices: prev.devices.map((dev, i) => {
                  const g = d.gpus?.[i];
                  if (!g) return dev;
                  return {
                    ...dev,
                    vram_used: g.vram_used ?? dev.vram_used,
                    vram_total: g.vram_total ?? dev.vram_total,
                    temperature: g.gpu_temperature ?? dev.temperature,
                    utilization: g.gpu_utilization ?? dev.utilization,
                  };
                }),
              };
              systemStatsRef.current = next;
              return next;
            });
            if (!systemStatsRef.current) refreshSystem();
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        setTimeout(connectWs, 3000);
      };
    };

    connectWs();
    return () => {
      wsRef.current?.close();
    };
  }, [refreshSystem, fetchOutputFromHistory]);

  // Initial system info fetch (device name, pytorch/python versions).
  // Live updates arrive via WS (crystools.monitor for stats, launcher-status for connectivity).
  useEffect(() => {
    refreshSystem().finally(() => setLoading(false));
    refreshApiKeyStatus();
    refreshHfTokenStatus();
  }, [refreshSystem, refreshApiKeyStatus, refreshHfTokenStatus]);

  return (
    <AppContext.Provider
      value={{
        templates,
        systemStats,
        queueStatus,
        gallery,
        settings,
        currentJob,
        connected,
        loading,
        launcherStatus,
        monitorStats,
        galleryTotal,
        recentGallery,
        apiKeyConfigured,
        hfTokenConfigured,
        downloads,
        refreshApiKeyStatus,
        refreshHfTokenStatus,
        refreshTemplates,
        refreshSystem,
        refreshQueue,
        refreshGallery,
        updateSettings,
        submitGeneration,
        setCurrentJob,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
