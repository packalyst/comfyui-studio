import * as path from 'path';

// 环境判断
export const isDev = process.env.NODE_ENV !== 'production';

// 路径配置
export const paths = {
  comfyui: process.env.COMFYUI_PATH || 
    (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI'),
  // ...其他路径配置
};

export const config = {
  port: process.env.PORT || 3000,
  comfyui: {
    execPath: '/runner-scripts/entrypoint.sh',
    modelPath: process.env.MODELS_DIR || './models',
    pluginPath: process.env.PLUGIN_PATH || './custom_nodes',
    startTimeout: 30000, // 启动超时时间（毫秒）
    stopTimeout: 5000,    // 停止超时时间（毫秒）
    port: 8188,
    proxyPort: 8190
  },
  // 下载/安装重试策略
  retry: {
    // 单个资源失败后的重试次数（不含首次尝试）
    maxAttempts: Number(process.env.RP_RETRY_ATTEMPTS || 4),
    // 退避起始毫秒
    baseDelayMs: Number(process.env.RP_RETRY_BASE_DELAY_MS || 1000),
    // 指数退避倍数
    backoffFactor: Number(process.env.RP_RETRY_BACKOFF || 4),
    // 最大退避毫秒
    maxDelayMs: Number(process.env.RP_RETRY_MAX_DELAY_MS || 15000),
  },
  // 模型存储目录
  modelsDir: process.env.MODELS_DIR || path.join(process.cwd(), 'models'),

  /** Shared model hub mount (same as ComfyUI extra_model_paths base_path parent). Used by Launcher to detect external models. */
  sharedModelHubPath: process.env.SHARED_MODEL_HUB_PATH || '/mnt/olares-shared-model',
  
  // 数据目录（用于缓存等）
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  
  // 配置模型获取通道
  modelChannels: {
    default: 'https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/model-list.json',
    // 可以添加其他通道...
  },
  
  // 网络模式: 'public' | 'private' | 'offline'
  networkMode: process.env.NETWORK_MODE || 'public',
};

// Python路径配置
export const pythonPath = process.env.PYTHON_PATH || 'python3'; 

export const cachePath = process.env.CACHE_DIR;