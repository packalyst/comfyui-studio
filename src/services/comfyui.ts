import type {
  Template,
  SystemStats,
  QueueStatus,
  GalleryItem,
  CatalogModel,
  DependencyCheck,
  AdvancedSetting,
  EnumeratedWidget,
  Plugin,
  PluginTaskProgress,
  PluginHistoryEntry,
  PythonPackage,
  PluginDependencyReport,
  CivitaiModelSummary,
  CivitaiDownloadInfo,
} from '../types';

const BASE = '/api';

/** Standard paginated-list response envelope returned by `?page=N` endpoints. */
export interface PageEnvelope<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

function buildPagedQuery(params: { page: number; pageSize: number; extra?: Record<string, string> }): string {
  const qs = new URLSearchParams();
  qs.set('page', String(params.page));
  qs.set('pageSize', String(params.pageSize));
  if (params.extra) {
    for (const [k, v] of Object.entries(params.extra)) qs.set(k, v);
  }
  return qs.toString();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetch a response body as text (used for the pip-source GET which returns a plain string). */
async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Build a civitai pagination query string. CivitAI uses `page=` for plain
 * sort endpoints and `cursor=` when `query=` is active (its search path
 * refuses page-based pagination). Callers thread `cursor` from the previous
 * envelope's `nextCursor` when doing search.
 */
function buildCivitaiPageQuery(opts: {
  page?: number; pageSize?: number; cursor?: string; query?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.pageSize !== undefined) params.set('pageSize', String(opts.pageSize));
  if (opts.cursor !== undefined) params.set('cursor', opts.cursor);
  else if (opts.page !== undefined) params.set('page', String(opts.page));
  if (opts.query !== undefined && opts.query.length > 0) params.set('q', opts.query);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // Status flags (`apiKeyConfigured`, `hfTokenConfigured`) live on `/system`
  // now; there's no separate GET here. Writers return the new flag directly.
  setApiKey: (apiKey: string) =>
    fetchJson<{ configured: boolean }>('/settings/api-key', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),
  clearApiKey: () =>
    fetchJson<{ configured: boolean }>('/settings/api-key', { method: 'DELETE' }),

  setHfToken: (token: string) =>
    fetchJson<{ configured: boolean }>('/settings/hf-token', {
      method: 'PUT',
      body: JSON.stringify({ token }),
    }),
  clearHfToken: () =>
    fetchJson<{ configured: boolean }>('/settings/hf-token', { method: 'DELETE' }),

  setCivitaiToken: (token: string) =>
    fetchJson<{ configured: boolean }>('/settings/civitai-token', {
      method: 'PUT',
      body: JSON.stringify({ token }),
    }),
  clearCivitaiToken: () =>
    fetchJson<{ configured: boolean }>('/settings/civitai-token', { method: 'DELETE' }),

  getSystemStats: () => fetchJson<SystemStats & {
    queue?: QueueStatus | null;
    gallery?: { total: number; recent: GalleryItem[] };
    apiKeyConfigured?: boolean;
    hfTokenConfigured?: boolean;
    civitaiTokenConfigured?: boolean;
  }>('/system'),

  getTemplates: () => fetchJson<Template[]>('/templates'),

  /** GET /templates?page=&pageSize=&category=&tags=&q=&source=&ready= — paginated templates. */
  getTemplatesPaged: (
    page: number,
    pageSize: number,
    opts: {
      q?: string;
      category?: string;
      tags?: string[];
      source?: 'all' | 'open' | 'api';
      ready?: 'all' | 'yes' | 'no';
    } = {},
  ) => {
    const extra: Record<string, string> = {};
    if (opts.q) extra.q = opts.q;
    if (opts.category && opts.category !== 'All') extra.category = opts.category;
    if (opts.tags && opts.tags.length > 0) extra.tags = opts.tags.join(',');
    if (opts.source && opts.source !== 'all') extra.source = opts.source;
    if (opts.ready && opts.ready !== 'all') extra.ready = opts.ready;
    return fetchJson<PageEnvelope<Template>>(`/templates?${buildPagedQuery({ page, pageSize, extra })}`);
  },

  /** POST /templates/refresh — re-pull template catalog + recompute readiness. */
  refreshTemplates: () =>
    fetchJson<{ added: number; updated: number; unchanged: number; removed: number }>(
      '/templates/refresh',
      { method: 'POST' },
    ),

  generate: (templateName: string, inputs: Record<string, unknown>, advancedSettings?: Record<string, { proxyIndex: number; value: unknown }>) =>
    fetchJson<{ prompt_id: string }>('/generate', {
      method: 'POST',
      body: JSON.stringify({ templateName, inputs, advancedSettings }),
    }),

  getWorkflowSettings: (templateName: string) =>
    fetchJson<{ settings: AdvancedSetting[] }>(`/workflow-settings/${encodeURIComponent(templateName)}`),

  getTemplateWidgets: (templateName: string) =>
    fetchJson<{ widgets: EnumeratedWidget[] }>(`/template-widgets/${encodeURIComponent(templateName)}`),

  saveExposedWidgets: (templateName: string, exposed: Array<{ nodeId: string; widgetName: string }>) =>
    fetchJson<{ exposed: Array<{ nodeId: string; widgetName: string }> }>(`/template-widgets/${encodeURIComponent(templateName)}`, {
      method: 'PUT',
      body: JSON.stringify({ exposed }),
    }),

  getGallery: () => fetchJson<GalleryItem[]>('/gallery'),

  /** GET /gallery?page=&pageSize=&mediaType=&sort= — paginated gallery. */
  getGalleryPaged: (
    page: number,
    pageSize: number,
    opts: { mediaType?: string; sort?: 'newest' | 'oldest' } = {},
  ) => {
    const extra: Record<string, string> = {};
    if (opts.mediaType && opts.mediaType !== 'all') extra.mediaType = opts.mediaType;
    if (opts.sort && opts.sort !== 'newest') extra.sort = opts.sort;
    return fetchJson<PageEnvelope<GalleryItem>>(`/gallery?${buildPagedQuery({ page, pageSize, extra })}`);
  },

  uploadImage: async (file: File): Promise<{ name: string; subfolder: string }> => {
    const form = new FormData();
    form.append('image', file);
    const res = await fetch(`${BASE}/upload`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) throw new Error('Upload failed');
    return res.json();
  },

  // ---- Launcher / dependency endpoints ----

  checkDependencies: (templateName: string) =>
    fetchJson<DependencyCheck>('/check-dependencies', {
      method: 'POST',
      body: JSON.stringify({ templateName }),
    }),

  /** New unified catalog merged with disk scan. Prefer this for the Models page. */
  getModelsCatalog: () => fetchJson<CatalogModel[]>('/models/catalog'),

  /** GET /models/catalog?page=&pageSize=&q=&type=&installed= — paginated catalog. */
  getModelsCatalogPaged: (
    page: number,
    pageSize: number,
    opts: { q?: string; types?: string[]; installed?: boolean | null } = {},
  ) => {
    const extra: Record<string, string> = {};
    if (opts.q) extra.q = opts.q;
    if (opts.types && opts.types.length > 0) extra.type = opts.types.join(',');
    if (opts.installed === true) extra.installed = 'true';
    else if (opts.installed === false) extra.installed = 'false';
    return fetchJson<PageEnvelope<CatalogModel>>(`/models/catalog?${buildPagedQuery({ page, pageSize, extra })}`);
  },

  scanModels: () =>
    fetchJson<{ success: boolean; count: number }>('/launcher/models/scan', { method: 'POST' }),

  installModel: (modelName: string) =>
    fetchJson<{ success: boolean; taskId: string; message?: string }>(`/launcher/models/install/${encodeURIComponent(modelName)}`, {
      method: 'POST',
    }),

  cancelDownload: (taskId: string) =>
    fetchJson<void>('/launcher/models/cancel-download', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    }),

  deleteModel: (body: Record<string, unknown>) =>
    fetchJson<void>('/launcher/models/delete', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * Kick off a unified download. `opts.meta` is optional; when supplied it
   * pre-populates the catalog so the Models page shows the row with rich
   * metadata + a "Downloading" badge immediately, instead of waiting for
   * the disk scan to pick up the file on completion.
   */
  downloadCustomModel: (
    hfUrl: string,
    modelDir: string,
    opts?: {
      modelName?: string;
      filename?: string;
      meta?: {
        type?: string;
        description?: string;
        reference?: string;
        size_bytes?: number;
        thumbnail?: string;
        gated?: boolean;
        source?: string;
      };
    },
  ) =>
    fetchJson<{ success: boolean; taskId?: string; alreadyActive?: boolean; message?: string }>('/launcher/models/download-custom', {
      method: 'POST',
      body: JSON.stringify({
        hfUrl,
        modelDir,
        modelName: opts?.modelName,
        filename: opts?.filename,
        meta: opts?.meta,
      }),
    }),

  /** GET /launcher/models/download-history?page=&pageSize= — paginated download history. */
  getDownloadHistoryPaged: (page: number, pageSize: number) =>
    fetchJson<PageEnvelope<Record<string, unknown>> & { success: boolean; count: number }>(
      `/launcher/models/download-history?${buildPagedQuery({ page, pageSize })}`,
    ),

  clearDownloadHistory: () =>
    fetchJson<Record<string, unknown>>('/launcher/models/download-history/clear', {
      method: 'POST',
    }),

  deleteDownloadHistoryEntry: (id: string) =>
    fetchJson<Record<string, unknown>>('/launcher/models/download-history/delete', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  // ---- Launcher process control ----

  startComfyUI: () => fetchJson<{ status: string }>('/launcher/start', { method: 'POST' }),

  stopComfyUI: () => fetchJson<{ status: string }>('/launcher/stop', { method: 'POST' }),

  restartComfyUI: () => fetchJson<{ status: string }>('/launcher/restart', { method: 'POST' }),

  getComfyUILogs: () => fetchJson<{ logs: string }>('/launcher/comfyui/logs'),

  resetComfyUI: (mode: 'normal' | 'hard' = 'normal') =>
    fetchJson<{ success: boolean; message: string; logs?: string[] }>('/launcher/comfyui/reset', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  getResetLogs: () =>
    fetchJson<{ logs: string[]; message?: string }>('/launcher/comfyui/reset-logs'),

  // ---- Settings endpoints ----

  getLaunchOptions: () =>
    fetchJson<Record<string, unknown>>('/launcher/comfyui/launch-options'),

  updateLaunchOptions: (options: Record<string, unknown>) =>
    fetchJson<Record<string, unknown>>('/launcher/comfyui/launch-options', {
      method: 'PUT',
      body: JSON.stringify(options),
    }),

  resetLaunchOptions: () =>
    fetchJson<Record<string, unknown>>('/launcher/comfyui/launch-options/reset', {
      method: 'POST',
    }),

  getNetworkConfig: () =>
    fetchJson<Record<string, unknown>>('/launcher/system/network-config'),

  setHuggingFaceEndpoint: (endpoint: string) =>
    fetchJson<Record<string, unknown>>('/launcher/system/huggingface-endpoint', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),

  setGithubProxy: (proxy: string) =>
    fetchJson<Record<string, unknown>>('/launcher/system/github-proxy', {
      method: 'POST',
      body: JSON.stringify({ proxy }),
    }),

  setPipSource: (source: string) =>
    fetchJson<Record<string, unknown>>('/launcher/system/pip-source', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),

  setPluginTrustedHosts: (hosts: string[]) =>
    fetchJson<Record<string, unknown>>('/launcher/system/plugin-trusted-hosts', {
      method: 'POST',
      body: JSON.stringify({ hosts }),
    }),

  setAllowPrivateIpMirrors: (allow: boolean) =>
    fetchJson<Record<string, unknown>>('/launcher/system/pip-allow-private-ip', {
      method: 'POST',
      body: JSON.stringify({ allow }),
    }),

  // ---- Plugins (custom nodes) ----
  // See server/src/routes/plugins.routes.ts

  /** GET /plugins?page=&pageSize=&q=&filter= — paginated catalog. */
  getPluginsPaged: (
    page: number,
    pageSize: number,
    opts: { forceRefresh?: boolean; q?: string; filter?: 'all' | 'installed' | 'available' } = {},
  ) => {
    const extra: Record<string, string> = {};
    if (opts.forceRefresh) extra.force = 'true';
    if (opts.q) extra.q = opts.q;
    if (opts.filter && opts.filter !== 'all') extra.filter = opts.filter;
    return fetchJson<PageEnvelope<Plugin>>(`/plugins?${buildPagedQuery({ page, pageSize, extra })}`);
  },

  /** POST /plugins/install — install a plugin by its catalog id. */
  installPlugin: (pluginId: string, githubProxy?: string) =>
    fetchJson<{ success: boolean; message: string; taskId: string }>('/plugins/install', {
      method: 'POST',
      body: JSON.stringify({ pluginId, githubProxy }),
    }),

  /** POST /plugins/uninstall — remove a plugin by id. */
  uninstallPlugin: (pluginId: string) =>
    fetchJson<{ success: boolean; message: string; taskId: string }>('/plugins/uninstall', {
      method: 'POST',
      body: JSON.stringify({ pluginId }),
    }),

  /** POST /plugins/install-custom — git-clone an arbitrary whitelisted URL. */
  installPluginCustom: (githubUrl: string, branch?: string) =>
    fetchJson<{ success: boolean; message: string; taskId: string; pluginId: string }>(
      '/plugins/install-custom',
      {
        method: 'POST',
        body: JSON.stringify({ githubUrl, branch }),
      },
    ),

  /** POST /plugins/switch-version — git-checkout a specific version. */
  switchPluginVersion: (
    pluginId: string,
    targetVersion: { id?: string; version?: string },
    githubProxy?: string,
  ) =>
    fetchJson<{ success: boolean; message: string; taskId: string }>('/plugins/switch-version', {
      method: 'POST',
      body: JSON.stringify({ pluginId, targetVersion, githubProxy }),
    }),

  /** POST /plugins/enable. */
  enablePlugin: (pluginId: string) =>
    fetchJson<{ success: boolean; message: string; taskId: string }>('/plugins/enable', {
      method: 'POST',
      body: JSON.stringify({ pluginId }),
    }),

  /** POST /plugins/disable. */
  disablePlugin: (pluginId: string) =>
    fetchJson<{ success: boolean; message: string; taskId: string }>('/plugins/disable', {
      method: 'POST',
      body: JSON.stringify({ pluginId }),
    }),

  /** GET /plugins/refresh — rescan custom_nodes on disk. */
  refreshPlugins: () =>
    fetchJson<{ success: boolean; message: string; plugins: unknown[] }>('/plugins/refresh'),

  /** GET /plugins/progress/:taskId — poll install/uninstall progress. */
  getPluginProgress: (taskId: string) =>
    fetchJson<PluginTaskProgress>(`/plugins/progress/${encodeURIComponent(taskId)}`),

  /** GET /plugins/logs/:taskId — fetch persisted logs for an operation. */
  getPluginLogs: (taskId: string) =>
    fetchJson<{ success: boolean; logs: string[] }>(`/plugins/logs/${encodeURIComponent(taskId)}`),

  /** POST /plugins/update-cache — clear + refill the catalog cache. */
  updatePluginCache: () =>
    fetchJson<{ success: boolean; message: string; nodesCount: number }>('/plugins/update-cache', {
      method: 'POST',
    }),

  /** GET /plugins/history — recent install/uninstall operations. */
  getPluginHistory: (limit = 100) =>
    fetchJson<{ success: boolean; history: PluginHistoryEntry[] }>(
      `/plugins/history?limit=${limit}`,
    ),

  /** GET /plugins/history?page=&pageSize= — paginated plugin history. */
  getPluginHistoryPaged: (page: number, pageSize: number) =>
    fetchJson<PageEnvelope<PluginHistoryEntry> & { success: boolean }>(
      `/plugins/history?${buildPagedQuery({ page, pageSize })}`,
    ),

  /** POST /plugins/history/clear. */
  clearPluginHistory: () =>
    fetchJson<{ success: boolean; message: string }>('/plugins/history/clear', {
      method: 'POST',
    }),

  /** POST /plugins/history/delete — remove one entry by id. */
  deletePluginHistoryEntry: (id: string) =>
    fetchJson<{ success: boolean; message: string }>('/plugins/history/delete', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  // ---- Python / pip ----
  // See server/src/routes/python.routes.ts

  /** GET /python/pip-source — returns the configured pip index-url as plain text. */
  getPipSource: () => fetchText('/python/pip-source'),

  /** GET /python/packages — list installed pip packages. */
  listPythonPackages: () => fetchJson<PythonPackage[]>('/python/packages'),

  /** POST /python/packages/install — install a pip package (spec may include ==version). */
  installPythonPackage: (pkg: string) =>
    fetchJson<{ success: boolean; message: string; output: string }>('/python/packages/install', {
      method: 'POST',
      body: JSON.stringify({ package: pkg }),
    }),

  /** POST /python/packages/uninstall — uninstall a pip package by bare name. */
  uninstallPythonPackage: (pkg: string) =>
    fetchJson<{ success: boolean; message: string; output: string }>('/python/packages/uninstall', {
      method: 'POST',
      body: JSON.stringify({ package: pkg }),
    }),

  /** GET /python/plugins/dependencies — per-plugin dependency report. */
  getPluginPythonDeps: () =>
    fetchJson<PluginDependencyReport[]>('/python/plugins/dependencies'),

  /** POST /python/plugins/fix-dependencies — pip install -r for one plugin. */
  fixPluginPythonDeps: (plugin: string) =>
    fetchJson<{ success: boolean; message: string; output: string }>(
      '/python/plugins/fix-dependencies',
      {
        method: 'POST',
        body: JSON.stringify({ plugin }),
      },
    ),

  // ---- CivitAI ----
  // See server/src/routes/civitai.routes.ts. Every list endpoint now returns
  // `PageEnvelope<CivitaiModelSummary>`. `total` is a lower bound — civitai
  // does not disclose a total result count; use `hasMore` for pagination.

  /** GET /civitai/models/latest — newest models, non-NSFW by default. */
  getCivitaiLatestModels: (opts: { page?: number; pageSize?: number; cursor?: string } = {}) =>
    fetchJson<PageEnvelope<CivitaiModelSummary>>(
      `/civitai/models/latest${buildCivitaiPageQuery(opts)}`,
    ),

  /** GET /civitai/models/hot — most-downloaded-this-month. */
  getCivitaiHotModels: (opts: { page?: number; pageSize?: number; cursor?: string } = {}) =>
    fetchJson<PageEnvelope<CivitaiModelSummary>>(
      `/civitai/models/hot${buildCivitaiPageQuery(opts)}`,
    ),

  /**
   * GET /civitai/models/search — free-text search over civitai models.
   * CivitAI requires cursor-based pagination when `query=` is present, so
   * this method accepts `cursor` from a previous envelope's `nextCursor`.
   */
  searchCivitaiModels: (
    query: string,
    opts: { page?: number; pageSize?: number; cursor?: string } = {},
  ) =>
    fetchJson<PageEnvelope<CivitaiModelSummary>>(
      `/civitai/models/search${buildCivitaiPageQuery({ ...opts, query })}`,
    ),

  /** GET /civitai/models/by-url — proxy a CivitAI search URL. */
  getCivitaiByUrl: (url: string, opts: { page?: number; pageSize?: number } = {}) =>
    fetchJson<PageEnvelope<CivitaiModelSummary>>(
      `/civitai/models/by-url?url=${encodeURIComponent(url)}${
        opts.page !== undefined ? `&page=${opts.page}` : ''
      }${opts.pageSize !== undefined ? `&pageSize=${opts.pageSize}` : ''}`,
    ),

  /** GET /civitai/download/models/:versionId — version metadata incl. downloadUrl. */
  getCivitaiDownloadInfo: (versionId: string | number) =>
    fetchJson<CivitaiDownloadInfo>(
      `/civitai/download/models/${encodeURIComponent(String(versionId))}`,
    ),

  /** GET /civitai/latest-workflows — newest Workflow-type models. */
  getCivitaiLatestWorkflows: (opts: { page?: number; pageSize?: number; cursor?: string } = {}) =>
    fetchJson<PageEnvelope<CivitaiModelSummary>>(
      `/civitai/latest-workflows${buildCivitaiPageQuery(opts)}`,
    ),

  /** GET /civitai/hot-workflows — most-downloaded workflows. */
  getCivitaiHotWorkflows: (opts: { page?: number; pageSize?: number; cursor?: string } = {}) =>
    fetchJson<PageEnvelope<CivitaiModelSummary>>(
      `/civitai/hot-workflows${buildCivitaiPageQuery(opts)}`,
    ),

  /**
   * POST /templates/import-civitai — pull a workflow version's JSON from
   * civitai and persist as a user template.
   */
  importCivitaiWorkflow: (workflowVersionId: string | number) =>
    fetchJson<{ name: string; imported: boolean }>('/templates/import-civitai', {
      method: 'POST',
      body: JSON.stringify({ workflowVersionId }),
    }),
};
