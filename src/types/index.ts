export interface GpuInfo {
  name: string;
  vram_total: number;
  vram_free: number;
  vram_used: number;
  temperature?: number;
  utilization?: number;
}

export interface MonitorStats {
  cpu_utilization?: number;
  ram_total?: number;
  ram_used?: number;
  ram_used_percent?: number;
  hdd_total?: number;
  hdd_used?: number;
  hdd_used_percent?: number;
  device_type?: string;
}

export interface SystemStats {
  system: {
    os: string;
    python_version: string;
    pytorch_version: string;
    comfyui_version?: string;
  };
  devices: GpuInfo[];
}

export interface TemplateInput {
  nodeId: number;
  nodeType: string;
  file?: string;
  mediaType: string;
  fieldName?: string;
  label?: string;
  default?: string | number;
  min?: number;
  max?: number;
}

export interface TemplateOutput {
  nodeId: number;
  nodeType: string;
  file: string;
  mediaType: string;
}

export interface FormInput {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'image' | 'audio' | 'video' | 'number' | 'slider' | 'select' | 'toggle';
  required: boolean;
  description?: string;
  placeholder?: string;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  nodeId?: number;
  nodeType?: string;
  mediaType?: string;
}

export type StudioCategory = 'image' | 'video' | 'audio' | '3d' | 'tools';

export interface Template {
  name: string;
  title: string;
  description: string;
  mediaType: string;
  tags: string[];
  models: string[];
  category: string;
  studioCategory?: StudioCategory;
  io: {
    inputs: TemplateInput[];
    outputs: TemplateOutput[];
  };
  formInputs?: FormInput[];
  thumbnail: string[];
  thumbnailVariant?: string;
  workflow?: Record<string, unknown>;
  size?: number;
  vram?: number;
  usage?: number;
  openSource?: boolean;
  username?: string;
  date?: string;
  logos?: string[];
  /**
   * True when every required model + plugin is installed on disk. Emitted by
   * the backend from the `templates.installed` column; `false` when unknown.
   */
  ready?: boolean;
}

export interface QueueStatus {
  queue_running: number;
  queue_pending: number;
}

export interface GenerationJob {
  id: string;
  templateName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  inputs: Record<string, unknown>;
  outputs?: GenerationOutput[];
  outputUrl?: string;
  outputMediaType?: string;
  createdAt: string;
  completedAt?: string;
  seed?: number;
  timeTaken?: number;
  error?: string;
}

export interface GenerationOutput {
  filename: string;
  subfolder: string;
  type: string;
  mediaType: string;
}

export interface GalleryItem {
  id: string;
  filename: string;
  subfolder: string;
  type?: string;
  mediaType: string;
  url?: string;
  promptId?: string;
  templateName?: string;
  prompt?: string;
  seed?: number;
  createdAt?: string;
  favorite?: boolean;
}

export interface AppSettings {
  comfyuiUrl: string;
  gpuUnloadTimeout: number;
  defaultSteps: number;
  defaultCfgScale: number;
  defaultWidth: number;
  defaultHeight: number;
  galleryPath: string;
}

export interface LauncherStatus {
  running: boolean;
  uptime?: string;
  versions?: { comfyui?: string; frontend?: string; app?: string };
  gpuMode?: string;
  reachable?: boolean;
}

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

/** Find a live download that matches a model by filename, modelName, or either-as-the-other. */
export function findDownloadForModel(
  downloads: Record<string, DownloadState>,
  model: { name?: string; filename?: string },
): DownloadState | undefined {
  const candidates = [model.filename, model.name].filter(Boolean) as string[];
  if (candidates.length === 0) return undefined;
  for (const dl of Object.values(downloads)) {
    if (
      (dl.filename && candidates.includes(dl.filename)) ||
      (dl.modelName && candidates.includes(dl.modelName))
    ) return dl;
  }
  return undefined;
}

/** Catalog entry merged with on-disk scan state — the thing the Models page renders. */
export interface CatalogModel {
  filename: string;
  name: string;
  type: string;
  base?: string;
  save_path: string;
  description?: string;
  reference?: string;
  url: string;
  size_pretty: string;
  size_bytes: number;
  size_fetched_at: string | null;
  gated?: boolean;
  gated_message?: string;
  source: string;
  installed: boolean;
  fileSize?: number;
  fileStatus?: 'complete' | 'incomplete' | 'corrupt' | null;
  /** Preview image URL, populated at download start from card metadata. */
  thumbnail?: string;
  /** In-flight download marker — set true from download start to completion. */
  downloading?: boolean;
  /** Last download failure message (cleared when a new download starts). */
  error?: string;
}

export interface RequiredModel {
  name: string;
  directory: string;
  url: string;
  size?: number;
  size_pretty?: string;
  installed: boolean;
  gated?: boolean;
  gated_message?: string;
}

export interface DependencyCheck {
  ready: boolean;
  required: RequiredModel[];
  missing: RequiredModel[];
}

export interface AdvancedSetting {
  id: string;
  label: string;
  type: 'number' | 'slider' | 'seed' | 'select' | 'toggle' | 'text' | 'textarea';
  value: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  // `proxyIndex >= 0` = wrapper-node proxy widget (legacy path).
  // `proxyIndex === -1` = user-exposed raw-node widget, keyed by `id` of the form "node:<nodeId>:<widgetName>".
  proxyIndex: number;
}

export interface EnumeratedWidget {
  nodeId: string;
  nodeType: string;
  nodeTitle?: string;
  widgetName: string;
  label: string;
  value: unknown;
  type: 'number' | 'slider' | 'seed' | 'select' | 'toggle' | 'text' | 'textarea';
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
  exposed: boolean;
  /** True when the widget is driven by the main form (Prompt / upload field). Modal hides these. */
  formClaimed?: boolean;
}

/* =================================================================
 * Plugin / Python / CivitAI types
 *
 * These shapes mirror the backend service types verified against
 * server/src/services/plugins/*.ts, server/src/services/python/*.ts,
 * and server/src/services/civitai/*.ts. The CivitAI shapes are
 * intentionally partial because the backend is a thin proxy to the
 * upstream CivitAI REST API; only the fields rendered by the UI are
 * typed strictly.
 * ================================================================= */

// Mirrors server's CatalogPlugin (cache.service.ts:16-48) overlayed with
// the installed-state fields from info.types.ts.
export interface Plugin {
  id: string;
  name: string;
  description: string;
  author: string;
  repository: string;
  version: string;
  latest_version?: {
    id?: string;
    version?: string;
    changelog?: string;
    deprecated?: boolean;
    status?: string;
  } | null;
  versions?: Array<{
    id?: string;
    version?: string;
    changelog?: string;
    createdAt?: string;
    deprecated?: boolean;
    status?: string;
  }>;
  status: string;
  status_detail?: string;
  rating: number;
  downloads: number;
  github_stars: number;
  icon?: string;
  banner_url?: string;
  category?: string;
  license?: string;
  tags?: string[];
  dependencies?: string[];
  installed: boolean;
  installedOn?: string;
  disabled: boolean;
  install_type?: string;
  stars?: number;
  github?: string;
}

// Mirrors server's PluginTaskProgress (progress.service.ts:7-15).
export interface PluginTaskProgress {
  progress: number;
  completed: boolean;
  pluginId: string;
  type: 'install' | 'uninstall' | 'disable' | 'enable' | 'switch-version';
  message?: string;
  githubProxy?: string;
  logs?: string[];
}

// Mirrors server's PluginOperationHistory (history.service.ts:14-27).
export interface PluginHistoryEntry {
  id: string;
  pluginId: string;
  pluginName?: string;
  type: 'install' | 'uninstall' | 'disable' | 'enable' | 'switch-version';
  typeText?: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'success' | 'failed';
  statusText?: string;
  logs: string[];
  result?: string;
  githubProxy?: string;
}

// Mirrors server's InstalledPackage (packages.service.ts:10-13).
export interface PythonPackage {
  name: string;
  version: string;
}

// Mirrors server's DependencyItem (dependencies.service.ts:14-19).
export interface PythonDependencyItem {
  name: string;
  version: string;
  missing?: boolean;
  versionMismatch?: boolean;
}

// Mirrors server's PluginDependencyReport (dependencies.service.ts:21-25).
export interface PluginDependencyReport {
  plugin: string;
  dependencies: PythonDependencyItem[];
  missingDeps: string[];
}

// Partial of CivitAI's public Model object. Only the fields we render
// are declared strictly; the rest is dropped/ignored at runtime.
export interface CivitaiModelSummary {
  id: number;
  name: string;
  description?: string | null;
  type?: string;
  nsfw?: boolean;
  creator?: {
    username?: string;
    image?: string | null;
  };
  stats?: {
    downloadCount?: number;
    favoriteCount?: number;
    thumbsUpCount?: number;
    rating?: number;
  };
  modelVersions?: Array<{
    id: number;
    name?: string;
    baseModel?: string;
    images?: Array<{
      url?: string;
      width?: number;
      height?: number;
      type?: string;
      nsfwLevel?: number;
    }>;
    files?: Array<{
      id?: number;
      name?: string;
      sizeKB?: number;
      downloadUrl?: string;
    }>;
    downloadUrl?: string;
  }>;
  tags?: string[];
}

// Response from GET /civitai/download/models/:versionId — CivitAI's version
// detail endpoint. Only the url/filename fields we care about.
export interface CivitaiDownloadInfo {
  id?: number;
  modelId?: number;
  name?: string;
  baseModel?: string;
  files?: Array<{
    id?: number;
    name?: string;
    sizeKB?: number;
    downloadUrl?: string;
    primary?: boolean;
    type?: string;
  }>;
  downloadUrl?: string;
  model?: { name?: string; type?: string };
}
