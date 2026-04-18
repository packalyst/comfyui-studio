import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config';
import { i18nLogger } from '../../utils/logger';

// Launch option item definition
export type LaunchOptionType = 'flag' | 'string' | 'number' | 'enum';

export interface LaunchOptionItem {
  key: string;
  value?: string | number | boolean | null;
  enabled: boolean;
  type: LaunchOptionType;
  description: string;
  category?: string;
  order?: number;
  /** When true, value cannot be edited by user (e.g. port, front-end-version) */
  readOnly?: boolean;
}

export interface LaunchOptionsConfig {
  mode: 'list' | 'manual';
  items: LaunchOptionItem[];
  manualArgs?: string;
}

export interface LaunchCommandView {
  mode: 'list' | 'manual';
  items: LaunchOptionItem[];
  manualArgs: string;
  baseCommand: string;
  fixedArgs: string[];
  extraArgs: string[];
  fullCommandLine: string;
}

// Keys that are fixed in entrypoint.sh (--listen --port 8188), do not send in CLI_ARGS
const FIXED_IN_ENTRYPOINT = new Set(['--listen', '--port']);

// Fallback default CLI args when process.env.CLI_ARGS is not set
// This should mirror the runtime default you currently use, e.g.:
// --normalvram --disable-xformers --disable-smart-memory --disable-cuda-malloc --front-end-version Comfy-Org/ComfyUI_frontend@v1.42.2
const DEFAULT_CLI_ARGS_FALLBACK =
  '--normalvram --disable-xformers --disable-smart-memory --disable-cuda-malloc --front-end-version Comfy-Org/ComfyUI_frontend@v1.42.2';

// Default front-end version: parse from env CLI_ARGS or use constant
function getDefaultFrontendVersion(): string {
  const cliArgs = process.env.CLI_ARGS || '';
  const m = cliArgs.match(/--front-end-version\s+(\S+)/);
  return m ? m[1] : 'Comfy-Org/ComfyUI_frontend@v1.42.2';
}

// Full list of ComfyUI CLI args from comfy/cli_args.py (ComfyUI official repo)
function buildDefaultItems(): LaunchOptionItem[] {
  const port = config.comfyui.port;
  const frontendVersion = getDefaultFrontendVersion();
  return [
    // ----- Fixed / read-only -----
    { key: '--port', value: port, enabled: true, type: 'number', description: '服务监听端口（由系统固定，不可修改）', category: 'network', order: 1, readOnly: true },
    { key: '--front-end-version', value: frontendVersion, enabled: true, type: 'string', description: '前端版本（由系统固定，不可修改）', category: 'network', order: 2, readOnly: true },
    // ----- Network / server -----
    { key: '--tls-keyfile', value: null, enabled: false, type: 'string', description: 'TLS(SSL) 密钥文件路径，启用 HTTPS', category: 'network', order: 3 },
    { key: '--tls-certfile', value: null, enabled: false, type: 'string', description: 'TLS(SSL) 证书文件路径，需与 --tls-keyfile 配合', category: 'network', order: 4 },
    { key: '--enable-cors-header', value: null, enabled: false, type: 'string', description: '启用 CORS，可选来源或默认 * 允许全部', category: 'network', order: 5 },
    { key: '--max-upload-size', value: 100, enabled: false, type: 'number', description: '最大上传大小（MB）', category: 'network', order: 6 },
    // ----- Directories -----
    { key: '--base-directory', value: null, enabled: false, type: 'string', description: 'ComfyUI 基础目录（models、custom_nodes 等）', category: 'paths', order: 10 },
    { key: '--extra-model-paths-config', value: null, enabled: false, type: 'string', description: '加载 extra_model_paths.yaml 文件路径（可多个）', category: 'paths', order: 11 },
    { key: '--output-directory', value: null, enabled: false, type: 'string', description: '输出目录，覆盖 --base-directory', category: 'paths', order: 12 },
    { key: '--temp-directory', value: null, enabled: false, type: 'string', description: '临时目录', category: 'paths', order: 13 },
    { key: '--input-directory', value: null, enabled: false, type: 'string', description: '输入目录', category: 'paths', order: 14 },
    { key: '--user-directory', value: null, enabled: false, type: 'string', description: '用户目录（绝对路径）', category: 'paths', order: 15 },
    // ----- Launch / browser -----
    { key: '--auto-launch', enabled: false, type: 'flag', description: '启动时在默认浏览器中自动打开', category: 'startup', order: 20 },
    { key: '--disable-auto-launch', enabled: false, type: 'flag', description: '禁用自动打开浏览器', category: 'startup', order: 21 },
    // ----- Device -----
    { key: '--cuda-device', value: null, enabled: false, type: 'number', description: '指定使用的 CUDA 设备 ID，其它设备不可见', category: 'device', order: 30 },
    { key: '--default-device', value: null, enabled: false, type: 'number', description: '默认设备 ID，其它设备仍可见', category: 'device', order: 31 },
    { key: '--cuda-malloc', enabled: false, type: 'flag', description: '启用 cudaMallocAsync（torch 2.0+ 默认）', category: 'device', order: 32 },
    { key: '--disable-cuda-malloc', enabled: false, type: 'flag', description: '禁用 cudaMallocAsync', category: 'device', order: 33 },
    { key: '--directml', value: null, enabled: false, type: 'number', description: '使用 torch-directml（可选设备）', category: 'device', order: 34 },
    { key: '--oneapi-device-selector', value: null, enabled: false, type: 'string', description: 'oneAPI 设备选择器', category: 'device', order: 35 },
    { key: '--disable-ipex-optimize', enabled: false, type: 'flag', description: '禁用 Intel IPEX 加载模型时的默认优化', category: 'device', order: 36 },
    { key: '--supports-fp8-compute', enabled: false, type: 'flag', description: '假定设备支持 fp8 计算', category: 'device', order: 37 },
    // ----- Precision / FP -----
    { key: '--force-fp32', enabled: false, type: 'flag', description: '强制 FP32', category: 'precision', order: 40 },
    { key: '--force-fp16', enabled: false, type: 'flag', description: '强制 FP16', category: 'precision', order: 41 },
    { key: '--fp32-unet', enabled: false, type: 'flag', description: '扩散模型以 FP32 运行', category: 'precision', order: 42 },
    { key: '--fp64-unet', enabled: false, type: 'flag', description: '扩散模型以 FP64 运行', category: 'precision', order: 43 },
    { key: '--bf16-unet', enabled: false, type: 'flag', description: '扩散模型以 BF16 运行', category: 'precision', order: 44 },
    { key: '--fp16-unet', enabled: false, type: 'flag', description: '扩散模型以 FP16 运行', category: 'precision', order: 45 },
    { key: '--fp8_e4m3fn-unet', enabled: false, type: 'flag', description: 'UNET 权重以 fp8_e4m3fn 存储', category: 'precision', order: 46 },
    { key: '--fp8_e5m2-unet', enabled: false, type: 'flag', description: 'UNET 权重以 fp8_e5m2 存储', category: 'precision', order: 47 },
    { key: '--fp8_e8m0fnu-unet', enabled: false, type: 'flag', description: 'UNET 权重以 fp8_e8m0fnu 存储', category: 'precision', order: 48 },
    { key: '--fp16-vae', enabled: false, type: 'flag', description: 'VAE 以 FP16 运行，可能产生黑图', category: 'precision', order: 49 },
    { key: '--fp32-vae', enabled: false, type: 'flag', description: 'VAE 以 FP32 运行', category: 'precision', order: 50 },
    { key: '--bf16-vae', enabled: false, type: 'flag', description: 'VAE 以 BF16 运行', category: 'precision', order: 51 },
    { key: '--cpu-vae', enabled: false, type: 'flag', description: 'VAE 在 CPU 上运行', category: 'precision', order: 52 },
    { key: '--fp8_e4m3fn-text-enc', enabled: false, type: 'flag', description: '文本编码器权重 fp8 (e4m3fn)', category: 'precision', order: 53 },
    { key: '--fp8_e5m2-text-enc', enabled: false, type: 'flag', description: '文本编码器权重 fp8 (e5m2)', category: 'precision', order: 54 },
    { key: '--fp16-text-enc', enabled: false, type: 'flag', description: '文本编码器权重 FP16', category: 'precision', order: 55 },
    { key: '--fp32-text-enc', enabled: false, type: 'flag', description: '文本编码器权重 FP32', category: 'precision', order: 56 },
    { key: '--bf16-text-enc', enabled: false, type: 'flag', description: '文本编码器权重 BF16', category: 'precision', order: 57 },
    { key: '--force-channels-last', enabled: false, type: 'flag', description: '推理时强制 channels last 格式', category: 'precision', order: 58 },
    // ----- Preview -----
    { key: '--preview-method', value: 'none', enabled: false, type: 'string', description: '采样节点默认预览方式: none, auto, latent2rgb, taesd', category: 'preview', order: 60 },
    { key: '--preview-size', value: 512, enabled: false, type: 'number', description: '采样节点最大预览尺寸', category: 'preview', order: 61 },
    // ----- Cache -----
    { key: '--cache-classic', enabled: false, type: 'flag', description: '使用旧式（激进）缓存', category: 'cache', order: 70 },
    { key: '--cache-lru', value: null, enabled: false, type: 'number', description: 'LRU 缓存，最多缓存 N 个节点结果', category: 'cache', order: 71 },
    { key: '--cache-none', enabled: false, type: 'flag', description: '不缓存，省内存但每次运行都执行所有节点', category: 'cache', order: 72 },
    { key: '--cache-ram', value: null, enabled: false, type: 'number', description: '按 RAM 压力缓存，指定剩余阈值(GB)', category: 'cache', order: 73 },
    // ----- Attention -----
    { key: '--use-split-cross-attention', enabled: false, type: 'flag', description: '使用 split cross attention 优化', category: 'attention', order: 80 },
    { key: '--use-quad-cross-attention', enabled: false, type: 'flag', description: '使用 sub-quadratic cross attention', category: 'attention', order: 81 },
    { key: '--use-pytorch-cross-attention', enabled: false, type: 'flag', description: '使用 PyTorch 2.0 cross attention', category: 'attention', order: 82 },
    { key: '--use-sage-attention', enabled: false, type: 'flag', description: '使用 sage attention', category: 'attention', order: 83 },
    { key: '--use-flash-attention', enabled: false, type: 'flag', description: '使用 FlashAttention', category: 'attention', order: 84 },
    { key: '--disable-xformers', enabled: false, type: 'flag', description: '禁用 xformers', category: 'attention', order: 85 },
    { key: '--force-upcast-attention', enabled: false, type: 'flag', description: '强制启用 attention 上转，可修复黑图', category: 'attention', order: 86 },
    { key: '--dont-upcast-attention', enabled: false, type: 'flag', description: '禁用所有 attention 上转', category: 'attention', order: 87 },
    // ----- Manager -----
    { key: '--enable-manager', enabled: false, type: 'flag', description: '启用 ComfyUI-Manager 功能', category: 'manager', order: 90 },
    { key: '--disable-manager-ui', enabled: false, type: 'flag', description: '仅禁用 Manager UI 和接口，后台任务仍运行', category: 'manager', order: 91 },
    { key: '--enable-manager-legacy-ui', enabled: false, type: 'flag', description: '启用 ComfyUI-Manager 旧版 UI', category: 'manager', order: 92 },
    // ----- VRAM / memory -----
    { key: '--gpu-only', enabled: false, type: 'flag', description: '全部在 GPU 上存储和运行（含 CLIP 等）', category: 'vram', order: 100 },
    { key: '--highvram', enabled: false, type: 'flag', description: '模型用完后保留在 GPU 内存', category: 'vram', order: 101 },
    { key: '--normalvram', enabled: false, type: 'flag', description: '强制正常显存使用（若曾自动启用 lowvram）', category: 'vram', order: 102 },
    { key: '--lowvram', enabled: false, type: 'flag', description: '拆分 UNET 以降低显存占用', category: 'vram', order: 103 },
    { key: '--novram', enabled: false, type: 'flag', description: 'lowvram 仍不足时使用', category: 'vram', order: 104 },
    { key: '--cpu', enabled: false, type: 'flag', description: '全部使用 CPU（较慢）', category: 'vram', order: 105 },
    { key: '--reserve-vram', value: null, enabled: false, type: 'number', description: '预留显存（GB）给系统/其它软件', category: 'vram', order: 106 },
    { key: '--async-offload', value: null, enabled: false, type: 'number', description: '异步权重卸载，可选流数量，默认 2', category: 'vram', order: 107 },
    { key: '--disable-async-offload', enabled: false, type: 'flag', description: '禁用异步权重卸载', category: 'vram', order: 108 },
    { key: '--disable-dynamic-vram', enabled: false, type: 'flag', description: '禁用动态显存，改用估算加载', category: 'vram', order: 109 },
    { key: '--force-non-blocking', enabled: false, type: 'flag', description: '强制使用非阻塞张量操作', category: 'vram', order: 110 },
    { key: '--default-hashing-function', value: 'sha256', enabled: false, type: 'string', description: '重复文件/内容比较的哈希: md5, sha1, sha256, sha512', category: 'vram', order: 111 },
    { key: '--disable-smart-memory', enabled: false, type: 'flag', description: '强制积极卸载到内存而非保留在显存', category: 'vram', order: 112 },
    { key: '--deterministic', enabled: false, type: 'flag', description: 'PyTorch 使用较慢的确定性算法', category: 'vram', order: 113 },
    { key: '--fast', enabled: false, type: 'flag', description: '启用未充分测试的优化（可能影响质量/稳定性）', category: 'perf', order: 114 },
    { key: '--disable-pinned-memory', enabled: false, type: 'flag', description: '禁用 pinned memory', category: 'vram', order: 115 },
    { key: '--mmap-torch-files', enabled: false, type: 'flag', description: '加载 ckpt/pt 时使用 mmap', category: 'vram', order: 116 },
    { key: '--disable-mmap', enabled: false, type: 'flag', description: '加载 safetensors 时不使用 mmap', category: 'vram', order: 117 },
    // ----- Misc / debug -----
    { key: '--dont-print-server', enabled: false, type: 'flag', description: '不打印服务端输出', category: 'debug', order: 120 },
    { key: '--quick-test-for-ci', enabled: false, type: 'flag', description: 'CI 快速测试', category: 'debug', order: 121 },
    { key: '--windows-standalone-build', enabled: false, type: 'flag', description: 'Windows 独立版便捷选项', category: 'debug', order: 122 },
    { key: '--disable-metadata', enabled: false, type: 'flag', description: '不在文件中保存 prompt 元数据', category: 'debug', order: 123 },
    { key: '--disable-all-custom-nodes', enabled: false, type: 'flag', description: '禁用加载所有自定义节点', category: 'debug', order: 124 },
    { key: '--whitelist-custom-nodes', value: null, enabled: false, type: 'string', description: '在禁用全部节点时仍加载的节点目录（空格分隔）', category: 'debug', order: 125 },
    { key: '--disable-api-nodes', enabled: false, type: 'flag', description: '禁用所有 API 节点及前端联网', category: 'debug', order: 126 },
    { key: '--multi-user', enabled: false, type: 'flag', description: '启用每用户独立存储', category: 'debug', order: 127 },
    { key: '--verbose', value: 'INFO', enabled: false, type: 'string', description: '日志级别: DEBUG, INFO, WARNING, ERROR, CRITICAL', category: 'debug', order: 128 },
    { key: '--log-stdout', enabled: false, type: 'flag', description: '正常输出到 stdout 而非 stderr', category: 'debug', order: 129 },
    // ----- Frontend -----
    { key: '--front-end-root', value: null, enabled: false, type: 'string', description: '本地前端目录路径，覆盖 --front-end-version', category: 'frontend', order: 130 },
    { key: '--enable-compress-response-body', enabled: false, type: 'flag', description: '启用响应体压缩', category: 'frontend', order: 131 },
    { key: '--comfy-api-base', value: 'https://api.comfy.org', enabled: false, type: 'string', description: 'ComfyUI API 基础 URL', category: 'frontend', order: 132 },
    { key: '--database-url', value: null, enabled: false, type: 'string', description: '数据库 URL，如 sqlite:///:memory:', category: 'frontend', order: 133 },
    { key: '--enable-assets', enabled: false, type: 'flag', description: '启用资源系统（API、数据库同步、扫描）', category: 'frontend', order: 134 },
  ];
}

// Apply a CLI args string (e.g. \"--lowvram --disable-xformers --output-directory /foo\") onto a base items list
function applyCliArgsToItems(cliArgs: string, baseItems: LaunchOptionItem[]): LaunchOptionItem[] {
  const tokens = cliArgs.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return baseItems;

  const byKey = new Map(baseItems.map((i) => [i.key, { ...i }]));

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.startsWith('-')) {
      i++;
      continue;
    }

    const key = token;
    let value: string | null = null;
    const next = tokens[i + 1];
    if (next && !next.startsWith('-')) {
      value = next;
      i += 2;
    } else {
      i += 1;
    }

    const item = byKey.get(key);
    if (item) {
      // Respect readOnly flag but still allow seeding value from CLI_ARGS
      item.enabled = true;
      if (item.type !== 'flag' && value !== null) {
        item.value = value;
      }
    } else {
      // Unknown arg: add a generic entry so it still appears in the UI
      byKey.set(key, {
        key,
        value,
        enabled: true,
        type: value === null ? 'flag' : 'string',
        description: '',
        category: 'other',
        order: 9999,
      });
    }
  }

  return Array.from(byKey.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function getDefaultConfig(): LaunchOptionsConfig {
  const envCliArgs = (process.env.CLI_ARGS || DEFAULT_CLI_ARGS_FALLBACK).trim();
  const baseItems = buildDefaultItems();
  const seededItems = envCliArgs ? applyCliArgsToItems(envCliArgs, baseItems) : baseItems;
  return {
    mode: envCliArgs ? 'manual' : 'list',
    items: seededItems,
    manualArgs: envCliArgs
  };
}

export class ComfyUIArgsService {
  private configPath: string;

  constructor() {
    this.configPath = path.join(config.dataDir, 'comfyui-launch-options.json');
    this.ensureConfigFile();
  }

  // Ensure config file exists on disk; seed from process.env.CLI_ARGS when creating
  private ensureConfigFile(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(this.configPath)) {
        const initial = getDefaultConfig();
        fs.writeFileSync(this.configPath, JSON.stringify(initial, null, 2), 'utf-8');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      i18nLogger.error('comfyui.launch_options.init_failed', { message: msg, lng: i18nLogger.getLocale() });
    }
  }

  // Read and normalize config from disk
  private readConfig(): LaunchOptionsConfig {
    try {
      this.ensureConfigFile();
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const raw = JSON.parse(content) as Partial<LaunchOptionsConfig>;
      const defaultConfig = getDefaultConfig();

      const mode = raw.mode === 'manual' ? 'manual' : 'list';
      const rawItems = Array.isArray(raw.items) ? raw.items : defaultConfig.items;
      const manualArgs = typeof raw.manualArgs === 'string' ? raw.manualArgs : defaultConfig.manualArgs || '';

      const defaultByKey = new Map(defaultConfig.items.map((i) => [i.key, i]));
      const rawKeys = new Set(rawItems.map((i) => i.key));
      const mergedItems: LaunchOptionItem[] = rawItems
        .map((item, index) => {
          const def = defaultByKey.get(item.key);
          const readOnly = def?.readOnly ?? item.readOnly ?? false;
          let value = item.value ?? def?.value ?? null;
          if (readOnly && item.key === '--port') value = config.comfyui.port;
          if (readOnly && item.key === '--front-end-version') value = getDefaultFrontendVersion();
          return {
            key: item.key,
            value,
            enabled: typeof item.enabled === 'boolean' ? item.enabled : (def?.enabled ?? false),
            type: (item.type || def?.type || 'string') as LaunchOptionItem['type'],
            description: item.description || def?.description || '',
            category: item.category ?? def?.category,
            order: typeof item.order === 'number' ? item.order : index * 10,
            readOnly
          };
        })
        .filter((item) => !!item.key);
      // Add any default items missing from saved config (e.g. after adding new options)
      for (const def of defaultConfig.items) {
        if (rawKeys.has(def.key)) continue;
        let value = def.value ?? null;
        if (def.readOnly && def.key === '--port') value = config.comfyui.port;
        if (def.readOnly && def.key === '--front-end-version') value = getDefaultFrontendVersion();
        mergedItems.push({
          key: def.key,
          value,
          enabled: def.enabled,
          type: def.type,
          description: def.description || '',
          category: def.category,
          order: def.order ?? 999,
          readOnly: def.readOnly
        });
      }
      const normalizedItems = mergedItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      return {
        mode,
        items: normalizedItems,
        manualArgs
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      i18nLogger.error('comfyui.launch_options.read_failed', { message: msg, lng: i18nLogger.getLocale() });
      return getDefaultConfig();
    }
  }

  // Persist config to disk
  private writeConfig(configValue: LaunchOptionsConfig): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(configValue, null, 2), 'utf-8');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      i18nLogger.error('comfyui.launch_options.write_failed', { message: msg, lng: i18nLogger.getLocale() });
    }
  }

  public getLaunchOptions(): LaunchOptionsConfig {
    return this.readConfig();
  }

  /** Reset config to default (seed manualArgs from process.env.CLI_ARGS when present) */
  public resetToDefault(): LaunchOptionsConfig {
    const defaultConfig = getDefaultConfig();
    this.writeConfig(defaultConfig);
    return this.readConfig();
  }

  public updateLaunchOptions(payload: Partial<LaunchOptionsConfig>): LaunchOptionsConfig {
    const current = this.readConfig();
    const mode = payload.mode === 'manual' ? 'manual' : 'list';
    const defaultByKey = new Map(getDefaultConfig().items.map((i) => [i.key, i]));

    const items = Array.isArray(payload.items)
      ? payload.items.map((item, index) => {
          const def = defaultByKey.get(item.key);
          const readOnly = def?.readOnly ?? item.readOnly ?? false;
          let value = item.value ?? def?.value ?? null;
          if (readOnly && item.key === '--port') value = config.comfyui.port;
          if (readOnly && item.key === '--front-end-version') value = getDefaultFrontendVersion();
          return {
            key: item.key,
            value,
            enabled: typeof item.enabled === 'boolean' ? item.enabled : false,
            type: (item.type || 'string') as LaunchOptionItem['type'],
            description: item.description || '',
            category: item.category,
            order: typeof item.order === 'number' ? item.order : index * 10,
            readOnly
          };
        }).filter((item) => !!item.key)
      : current.items;

    const manualArgs = typeof payload.manualArgs === 'string' ? payload.manualArgs : (current.manualArgs || '');
    const merged: LaunchOptionsConfig = { mode, items, manualArgs };
    this.writeConfig(merged);
    return merged;
  }

  // Strip --port and --front-end-version from manual args (system-fixed, not user-editable)
  private filterReadonlyFromManual(tokens: string[]): string[] {
    const strip = new Set(['--port', '--front-end-version']);
    const out: string[] = [];
    let i = 0;
    while (i < tokens.length) {
      if (strip.has(tokens[i])) {
        i++;
        if (i < tokens.length && !tokens[i].startsWith('-')) i++;
        continue;
      }
      out.push(tokens[i]);
      i++;
    }
    return out;
  }

  // Build CLI args array: only what we pass as CLI_ARGS (entrypoint already has --listen --port 8188)
  private buildExtraArgsArray(configValue: LaunchOptionsConfig): string[] {
    if (configValue.mode === 'manual') {
      const manual = (configValue.manualArgs || '').trim();
      if (!manual) return [];
      const tokens = manual.split(/\s+/).filter(Boolean);
      return this.filterReadonlyFromManual(tokens);
    }

    const args: string[] = [];
    for (const item of configValue.items) {
      if (!item.enabled || !item.key) continue;
      if (FIXED_IN_ENTRYPOINT.has(item.key)) continue; // --listen, --port are in entrypoint
      if (!/^[-a-zA-Z0-9_]+$/.test(item.key)) continue;

      if (item.type === 'flag') {
        args.push(item.key);
        continue;
      }
      const value = item.value === undefined || item.value === null || item.value === '' ? null : String(item.value);
      if (item.key === '--front-end-version') {
        args.push(item.key, value || getDefaultFrontendVersion());
        continue;
      }
      if (value !== null) {
        args.push(item.key, value);
      }
    }
    return args;
  }

  public buildCliArgsString(): string {
    const cfg = this.readConfig();
    const args = this.buildExtraArgsArray(cfg);
    return args.join(' ');
  }

  public getLaunchCommandView(): LaunchCommandView {
    const cfg = this.readConfig();
    const extraArgs = this.buildExtraArgsArray(cfg);

    const baseCommand = 'python3 ./ComfyUI/main.py';
    const fixedArgs = ['--listen', '--port', String(config.comfyui.port)];
    const fullParts = [baseCommand, ...fixedArgs, ...extraArgs].filter(Boolean);
    const fullCommandLine = fullParts.join(' ').trim();

    return {
      mode: cfg.mode,
      items: cfg.items,
      manualArgs: cfg.manualArgs || '',
      baseCommand,
      fixedArgs,
      extraArgs,
      fullCommandLine
    };
  }
}
