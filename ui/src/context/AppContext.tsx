import React, { createContext, useContext, useEffect, useCallback, useMemo } from 'react';
import type {
  Template,
  SystemStats,
  QueueStatus,
  GalleryItem,
  AppSettings,
  GenerationJob,
  LauncherStatus,
  MonitorStats,
  DownloadState,
} from '../types';
import { api } from '../services/comfyui';
import { SystemProvider, useSystem } from './SystemContext';
import { CatalogProvider, useCatalog } from './CatalogContext';
import { JobsProvider, useJobs } from './JobsContext';
import { SettingsProvider, useSettings } from './SettingsContext';

export { useSystem } from './SystemContext';
export { useCatalog } from './CatalogContext';
export { useJobs } from './JobsContext';
export { useSettings } from './SettingsContext';

interface AppContextType {
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
  civitaiTokenConfigured: boolean;
  downloads: Record<string, DownloadState>;
  refreshTemplates: () => Promise<void>;
  refreshSystem: () => Promise<void>;
  refreshGallery: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => void;
  submitGeneration: (
    templateName: string,
    inputs: Record<string, unknown>,
    advancedSettings?: Record<string, { proxyIndex: number; value: unknown }>,
  ) => Promise<void>;
  setCurrentJob: React.Dispatch<React.SetStateAction<GenerationJob | null>>;
}

const AppContext = createContext<AppContextType | null>(null);

/**
 * WsAndFacadeProvider — mounted inside all four slice providers.
 *
 * Owns:
 *  - the single WebSocket connection
 *  - the unified `refreshSystem` (which hits /api/system and fans the payload
 *    out across System + Catalog + Jobs slices)
 *  - the façade value returned by `useApp()`
 */
function WsAndFacadeProvider({ children }: { children: React.ReactNode }) {
  const system = useSystem();
  const catalog = useCatalog();
  const jobs = useJobs();
  const settings = useSettings();

  const {
    _setConnected,
    _setMonitorStats,
    _setSystemStats,
    _setLauncherStatus,
    _setApiKeyConfigured,
    _setHfTokenConfigured,
    _setCivitaiTokenConfigured,
    _systemStatsRef,
  } = system;
  const { _setGalleryTotal, _setRecentGallery } = catalog;
  const {
    _setQueueStatus,
    _setDownloads,
    _activePromptIdRef,
    _fetchOutputFromHistory,
    setCurrentJob,
  } = jobs;

  // Unified system refresh — populates System, Catalog (gallery), and Jobs (queue) slices.
  const refreshSystem = useCallback(async () => {
    try {
      const data = await api.getSystemStats();
      const {
        queue, gallery: galleryInfo,
        apiKeyConfigured, hfTokenConfigured, civitaiTokenConfigured,
        ...stats
      } = data;
      _setSystemStats(stats);
      _systemStatsRef.current = stats;
      if (queue) _setQueueStatus(queue);
      if (galleryInfo) {
        _setGalleryTotal(galleryInfo.total);
        _setRecentGallery(galleryInfo.recent);
      }
      if (typeof apiKeyConfigured === 'boolean') _setApiKeyConfigured(apiKeyConfigured);
      if (typeof hfTokenConfigured === 'boolean') _setHfTokenConfigured(hfTokenConfigured);
      if (typeof civitaiTokenConfigured === 'boolean') _setCivitaiTokenConfigured(civitaiTokenConfigured);
      _setConnected(true);
    } catch (err) {
      console.error('Failed to fetch system stats:', err);
    }
  }, [
    _setSystemStats,
    _systemStatsRef,
    _setQueueStatus,
    _setGalleryTotal,
    _setRecentGallery,
    _setApiKeyConfigured,
    _setHfTokenConfigured,
    _setCivitaiTokenConfigured,
    _setConnected,
  ]);

  // Kick off the initial system fetch; individual slice providers already handle
  // their own token-status fetches.
  useEffect(() => {
    refreshSystem().finally(() => system._setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // WebSocket — owns routing of every WS message to the correct slice setter.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;

    const connectWs = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data);
          const promptId = _activePromptIdRef.current;

          if (msg.type === 'progress' && msg.data?.value !== undefined && msg.data?.max !== undefined) {
            const progress = (msg.data.value / msg.data.max) * 100;
            setCurrentJob(prev => {
              if (!prev || prev.status === 'completed') return prev;
              return { ...prev, status: 'running', progress };
            });
          } else if (msg.type === 'executing' && msg.data?.node === null) {
            if (promptId) {
              setTimeout(() => _fetchOutputFromHistory(promptId), 500);
            }
          } else if (msg.type === 'executed' && msg.data?.prompt_id === promptId) {
            if (promptId) {
              setTimeout(() => _fetchOutputFromHistory(promptId), 500);
            }
          } else if (msg.type === 'progress_state') {
            const nodes = msg.data?.nodes;
            if (nodes && promptId) {
              const allFinished = Object.values(nodes).every((n: unknown) => (n as Record<string, string>).state === 'finished');
              if (allFinished) {
                setTimeout(() => _fetchOutputFromHistory(promptId), 500);
              }
            }
          } else if (msg.type === 'execution_complete') {
            if (promptId) {
              setTimeout(() => _fetchOutputFromHistory(promptId), 500);
            }
          } else if (msg.type === 'error' || msg.type === 'execution_error' || msg.type === 'execution_interrupted') {
            const errMsg = (msg.data as { exception_message?: string })?.exception_message;
            setCurrentJob(prev => prev ? { ...prev, status: 'failed', error: errMsg } : null);
          } else if (msg.type === 'launcher-status') {
            const status = msg.data as LauncherStatus;
            _setLauncherStatus(status);
            _setConnected(status.running === true);
            if (status.running && !_systemStatsRef.current) {
              refreshSystem();
            }
          } else if (msg.type === 'queue') {
            _setQueueStatus(msg.data as QueueStatus);
          } else if (msg.type === 'gallery') {
            const data = msg.data as { total: number; recent: GalleryItem[] };
            _setGalleryTotal(data.total);
            _setRecentGallery(data.recent);
          } else if (msg.type === 'download') {
            const d = msg.data as DownloadState;
            _setDownloads(prev => {
              // Remove from map shortly after terminal state so completed/cancelled items don't linger.
              if (d.completed || d.status === 'completed' || d.status === 'error') {
                // Keep the terminal state visible briefly so the UI can render "done" — purge after 3s.
                setTimeout(() => {
                  _setDownloads(p => {
                    const { [d.taskId]: _removed, ...rest } = p;
                    return rest;
                  });
                }, 3000);
              }
              return { ...prev, [d.taskId]: d };
            });
          } else if (msg.type === 'downloads-snapshot') {
            const list = msg.data as DownloadState[];
            _setDownloads(Object.fromEntries(list.map(d => [d.taskId, d])));
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
            _setConnected(true);
            _setMonitorStats({
              cpu_utilization: d.cpu_utilization,
              ram_total: d.ram_total,
              ram_used: d.ram_used,
              ram_used_percent: d.ram_used_percent,
              hdd_total: d.hdd_total,
              hdd_used: d.hdd_used,
              hdd_used_percent: d.hdd_used_percent,
              device_type: d.device_type,
            });
            _setSystemStats(prev => {
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
              _systemStatsRef.current = next;
              return next;
            });
            if (!_systemStatsRef.current) refreshSystem();
          }
        } catch {
          // ignore non-JSON messages
        }
      };

      ws.onclose = () => {
        if (closed) return;
        setTimeout(connectWs, 3000);
      };
    };

    connectWs();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [
    refreshSystem,
    _fetchOutputFromHistory,
    setCurrentJob,
    _setLauncherStatus,
    _setConnected,
    _setQueueStatus,
    _setGalleryTotal,
    _setRecentGallery,
    _setDownloads,
    _setMonitorStats,
    _setSystemStats,
    _systemStatsRef,
    _activePromptIdRef,
  ]);

  const value = useMemo<AppContextType>(
    () => ({
      templates: catalog.templates,
      systemStats: system.systemStats,
      monitorStats: system.monitorStats,
      queueStatus: jobs.queueStatus,
      gallery: catalog.gallery,
      galleryTotal: catalog.galleryTotal,
      recentGallery: catalog.recentGallery,
      settings: settings.settings,
      currentJob: jobs.currentJob,
      connected: system.connected,
      loading: system.loading,
      launcherStatus: system.launcherStatus,
      apiKeyConfigured: system.apiKeyConfigured,
      hfTokenConfigured: system.hfTokenConfigured,
      civitaiTokenConfigured: system.civitaiTokenConfigured,
      downloads: jobs.downloads,
      refreshTemplates: catalog.refreshTemplates,
      refreshSystem,
      refreshGallery: catalog.refreshGallery,
      updateSettings: settings.updateSettings,
      submitGeneration: jobs.submitGeneration,
      setCurrentJob: jobs.setCurrentJob,
    }),
    [
      catalog.templates,
      catalog.gallery,
      catalog.galleryTotal,
      catalog.recentGallery,
      catalog.refreshTemplates,
      catalog.refreshGallery,
      system.systemStats,
      system.monitorStats,
      system.connected,
      system.loading,
      system.launcherStatus,
      system.apiKeyConfigured,
      system.hfTokenConfigured,
      system.civitaiTokenConfigured,
      jobs.queueStatus,
      jobs.currentJob,
      jobs.downloads,
      jobs.submitGeneration,
      jobs.setCurrentJob,
      settings.settings,
      settings.updateSettings,
      refreshSystem,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <SystemProvider>
        <CatalogProvider>
          <JobsProvider>
            <WsAndFacadeProvider>{children}</WsAndFacadeProvider>
          </JobsProvider>
        </CatalogProvider>
      </SystemProvider>
    </SettingsProvider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
