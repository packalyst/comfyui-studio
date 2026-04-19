// ComfyUI Controller Types
import packageJson from '../../../package.json';
export interface ComfyUIStatus {
  running: boolean;
  pid: number | null;
  uptime: string | null;
  versions: {
    comfyui: string;
    frontend: string;
    app: string;
  };
  gpuMode: string;
}

export interface ComfyUIStartResponse {
  success: boolean;
  message: string;
  pid?: number | null;
  logs?: string[];
}

export interface ComfyUIStopResponse {
  success: boolean;
  message: string;
  error?: string;
}

export interface ComfyUIResetResponse {
  success: boolean;
  message: string;
  logs?: string[];
}

export interface ComfyUILogsResponse {
  logs: string[];
  success?: boolean;
  message?: string;
}

export interface ComfyUIResetLogsResponse {
  logs: string[];
  success: boolean;
  message: string;
}

export interface VersionInfo {
  comfyui?: string;
  frontend?: string;
  timestamp?: number;
}

export interface LogParams {
  [key: string]: Record<string, any>;
}

export interface Translations {
  [key: string]: { [key: string]: string };
}

export interface ResetRequest {
  lang?: string;
  mode?: 'normal' | 'hard';
}

export interface ComfyUIProcessInfo {
  process: any | null;
  startTime: Date | null;
  pid: number | null;
  recentLogs: string[];
  resetLogs: string[];
  versionCache: VersionInfo;
  logParams: LogParams;
}

// Constants
export const APP_VERSION = packageJson.version;
export const MAX_LOG_ENTRIES = 10000;
export const VERSION_CACHE_TIMEOUT = 600000; // 10 minutes
export const RESET_LOG_PATH = 'logs';
export const RESET_LOG_FILE = 'comfyui-reset.log';
