import { Context } from 'koa';
import * as net from 'net';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';

// Check if ComfyUI is running
export const isComfyUIRunning = (): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 1000;
    
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    
    socket.connect(config.comfyui.port, 'localhost');
  });
};

// Get client locale from request
export const getClientLocale = (ctx: Context): string | undefined => {
  // Get from query parameters
  if (ctx.query.lang && typeof ctx.query.lang === 'string') {
    return ctx.query.lang;
  }
  
  // Get from Accept-Language header
  const acceptLanguage = ctx.get('Accept-Language');
  if (acceptLanguage) {
    const lang = acceptLanguage.split(',')[0].split(';')[0].split('-')[0];
    return lang;
  }
  
  return undefined;
};

// Get uptime string
export const getUptime = (startTime: Date | null): string => {
  if (!startTime) return '0秒';
  
  const now = new Date();
  const diffMs = now.getTime() - startTime.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  
  if (diffSecs < 60) {
    return `${diffSecs}秒`;
  } else if (diffSecs < 3600) {
    const mins = Math.floor(diffSecs / 60);
    const secs = diffSecs % 60;
    return `${mins}分${secs}秒`;
  } else {
    const hours = Math.floor(diffSecs / 3600);
    const mins = Math.floor((diffSecs % 3600) / 60);
    return `${hours}小时${mins}分钟`;
  }
};

// Get GPU mode
export const getGPUMode = (): string => {
  // Prefer CUDA device GPU mode (0/1/2) if provided.
  // 2: time slicing, 1: VRAM slicing, 0: exclusive.
  const cudaGpuMode0 = process.env.CUDA_DEVICE_GPU_MODE_0;
  if (cudaGpuMode0 === '0') return 'exclusive';
  if (cudaGpuMode0 === '1') return 'memorySlice';
  if (cudaGpuMode0 === '2') return 'timeSlice';

  // Backward-compatible fallback to legacy NVShare env var.
  const nvshareMode = process.env.NVSHARE_MANAGED_MEMORY;
  if (nvshareMode === '0') return 'independent';
  if (nvshareMode === '1') return 'shared';

  // Default when nothing is specified.
  return 'exclusive';
};

// Find log parameters from log entry
export const findLogParams = (logEntry: string): Record<string, any> | null => {
  // Debug: Extract parameters from log entry
  // First extract actual message part (remove timestamp and error markers)
  const messageMatch = logEntry.match(/^\[(.*?)\]\s*(ERROR:\s*)?(.*)$/);
  const actualMessage = messageMatch ? messageMatch[3] : logEntry;
  
  // Then use the same logic as before to extract parameters
  // process_exited - match both Chinese and English formats
  const exitMatchZh = actualMessage.match(/退出码:\s*(\S+),\s*信号:\s*(\S+)/);
  const exitMatchEn = actualMessage.match(/exit code:\s*(\S+),\s*signal:\s*(\S+)/i);
  if (exitMatchZh || exitMatchEn) {
    const match = exitMatchZh || exitMatchEn;
    return { 
      code: match![1], 
      signal: match![2] 
    };
  }
  
  // waiting_startup - match both Chinese and English formats
  const waitingMatchZh = actualMessage.match(/尝试\s+(\d+)\/(\d+)/);
  const waitingMatchEn = actualMessage.match(/attempt\s+(\d+)\/(\d+)/i);
  if (waitingMatchZh || waitingMatchEn) {
    const match = waitingMatchZh || waitingMatchEn;
    return { 
      retry: match![1], 
      maxRetries: match![2] 
    };
  }
  
  // captured_pid - match both Chinese and English formats
  const pidMatchZh = actualMessage.match(/PID:\s*(\d+)/i);
  const pidMatchEn = actualMessage.match(/PID:\s*(\d+)/i); // Same format
  if (pidMatchZh || pidMatchEn) {
    const match = pidMatchZh || pidMatchEn;
    return { pid: match![1] };
  }
  
  // process_error - match both Chinese and English formats
  const errorMatchZh = actualMessage.match(/进程错误:\s*(.*?)$/);
  const errorMatchEn = actualMessage.match(/process error:\s*(.*?)$/i);
  if (errorMatchZh || errorMatchEn) {
    const match = errorMatchZh || errorMatchEn;
    return { message: match![1] };
  }
  
  // Debug: Unable to extract parameters from log entry
  return null;
};

// Translate message with parameters
export const translateMessage = (
  key: string, 
  lang: string, 
  translations: Record<string, Record<string, string>>,
  params?: Record<string, any> | null
): string => {
  // Get translation text
  const langData = translations[lang] || translations.en; // Default fallback to English
  let text = langData[key] || key; // Return original key if translation not found
  
  // Debug: Translating message with parameters
  // If there are parameters, replace them
  if (params && Object.keys(params).length > 0) {
    // Convert all parameters to strings first
    const stringParams = Object.entries(params).reduce((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {} as Record<string, string>);
    
    // Replace {param} format placeholders
    text = text.replace(/\{(\w+)\}/g, (match, paramKey) => {
      // Debug: Replace placeholder with parameter value
      return stringParams[paramKey] !== undefined ? stringParams[paramKey] : match;
    });
  }
  
  return text;
};
