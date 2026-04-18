import { Context } from 'koa';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { 
  ComfyUIStatus, 
  ComfyUIStartResponse, 
  ComfyUIStopResponse, 
  ComfyUIResetResponse, 
  ComfyUILogsResponse, 
  ComfyUIResetLogsResponse,
  ResetRequest
} from './types';
import { getClientLocale, getUptime, getGPUMode } from './utils';
import { VersionService } from './version.service';
import { LogService } from './log.service';
import { ProcessService } from './process.service';
import { createComfyUIProxy } from './proxy.service';
import { ComfyUIArgsService } from './launch-options.service';

export class ComfyUIController {
  private versionService: VersionService;
  private logService: LogService;
  private processService: ProcessService;
  private argsService: ComfyUIArgsService;
  
  constructor() {
    // Initialize services
    this.versionService = new VersionService();
    this.logService = new LogService();
    this.argsService = new ComfyUIArgsService();
    this.processService = new ProcessService(this.logService, this.argsService);
    
    // Bind methods to instance
    this.getStatus = this.getStatus.bind(this);
    this.startComfyUI = this.startComfyUI.bind(this);
    this.stopComfyUI = this.stopComfyUI.bind(this);
    this.restartComfyUI = this.restartComfyUI.bind(this);
    this.getLogs = this.getLogs.bind(this);
    this.resetComfyUI = this.resetComfyUI.bind(this);
    this.getResetLogs = this.getResetLogs.bind(this);
    
    // Check if ComfyUI is already running on initialization
    this.processService.checkIfComfyUIRunning();
    
    // Clean up duplicate disabled plugins on initialization
    this.processService.cleanupDisabledPlugins();
  }



  // Get ComfyUI status
  async getStatus(ctx: Context): Promise<void> {
    const lang = getClientLocale(ctx) || i18nLogger.getLocale();
    i18nLogger.info('comfyui.api.status_request', { timestamp: new Date().toISOString(), lng: lang });
    
    // Check if running via network port
    const { isComfyUIRunning } = await import('./utils');
    const running = await isComfyUIRunning();
    const uptime = this.processService.getStartTime() ? getUptime(this.processService.getStartTime()) : null;
    
    i18nLogger.info('comfyui.api.status', { status: running ? 'running' : 'stopped', lng: lang });
    if (running) {
      i18nLogger.info('comfyui.api.uptime', { uptime, lng: lang });
    }
    
    // Get version information
    const versions = await this.versionService.getVersionInfo();
    
    // Get GPU mode
    const gpuMode = getGPUMode();
    
    const status: ComfyUIStatus = {
      running,
      pid: this.processService.getComfyPid(),
      uptime,
      versions: {
        comfyui: versions.comfyui || 'unknown',
        frontend: versions.frontend || 'unknown',
        app: this.versionService.getAppVersion()
      },
      gpuMode
    };
    
    ctx.body = status;
  }



  // Get ComfyUI logs
  async getLogs(ctx: Context): Promise<void> {
    const lang = (ctx.query.lang as string) || getClientLocale(ctx) || 'zh';
    
    i18nLogger.info('comfyui.api.get_logs', { lang, lng: lang });
    
    // Get localized logs from service
    const localizedLogs = this.logService.getLocalizedLogs(lang);
    
    const response: ComfyUILogsResponse = {
      logs: localizedLogs
    };
    
    ctx.body = response;
  }



  // Start ComfyUI
  async startComfyUI(ctx: Context): Promise<void> {
    // Get language from query parameters or request body, fallback to client locale
    const lang = (ctx.query.lang as string) || 
                 (ctx.request.body as any)?.lang || 
                 getClientLocale(ctx) || 
                 'zh';
    
    i18nLogger.info('comfyui.api.start_request', { lng: lang });
    
    const result = await this.processService.startComfyUI(lang);
    
    if (result.success) {
      ctx.body = result;
    } else {
      ctx.status = 500;
      ctx.body = result;
    }
  }

  // Stop ComfyUI
  async stopComfyUI(ctx: Context): Promise<void> {
    // Get language from query parameters or request body, fallback to client locale
    const lang = (ctx.query.lang as string) || 
                 (ctx.request.body as any)?.lang || 
                 getClientLocale(ctx) || 
                 'zh';
    
    i18nLogger.info('comfyui.api.stop_request', { lng: lang });
    
    const result = await this.processService.stopComfyUI(lang);
    
    if (result.success) {
      ctx.body = result;
    } else {
      ctx.status = 500;
      ctx.body = result;
    }
  }
  
  // Restart ComfyUI
  async restartComfyUI(ctx: Context): Promise<void> {
    // Get language from query parameters or request body, fallback to client locale
    const lang = (ctx.query.lang as string) || 
                 (ctx.request.body as any)?.lang || 
                 getClientLocale(ctx) || 
                 'zh';
    
    i18nLogger.info('comfyui.api.restart_request', { lng: lang });
    
    const result = await this.processService.restartComfyUI(lang);
    
    if (result.success) {
      ctx.body = result;
    } else {
      ctx.status = 500;
      ctx.body = result;
    }
  }
  


  // Reset ComfyUI to initial state
  async resetComfyUI(ctx: Context): Promise<void> {
    // Get language parameters from request body
    const requestBody = ctx.request.body as ResetRequest;
    const lang = requestBody?.lang || getClientLocale(ctx) || i18nLogger.getLocale();
    // Get reset mode: normal or hard
    const resetMode = requestBody?.mode === 'hard' ? 'hard' : 'normal';
    
    i18nLogger.info('comfyui.api.reset_request', { lang, mode: resetMode, lng: lang });
    
    const result = await this.processService.resetComfyUI(lang, resetMode);
    
    if (result.success) {
      ctx.body = result;
    } else {
      ctx.status = 500;
      ctx.body = result;
    }
  }
  


  // Get reset logs with i18n support
  async getResetLogs(ctx: Context): Promise<void> {
    // Get language from query parameters
    const clientLang = ctx.query.lang as string || getClientLocale(ctx) || i18nLogger.getLocale();
    // Respect FORCE_LOG_LANGUAGE via i18nLogger; use clientLang only as a display hint
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('comfyui.api.get_reset_logs', { lang: clientLang, lng: logLang });
    
    // Get localized reset logs from service
    const translatedLogs = this.logService.getLocalizedResetLogs(logLang);
    
    // Return localized message
    let message = '';
    if (translatedLogs.length === 0) {
      message = i18nLogger.translate('comfyui.reset.no_logs', { lng: logLang });
      // If still a translation key, use hardcoded message
      if (message === 'comfyui.reset.no_logs') {
        message = logLang === 'zh' ? '未找到重置日志' : 'No reset logs found';
      }
    } else {
      message = i18nLogger.translate('comfyui.reset.logs_retrieved', { count: translatedLogs.length, lng: logLang });
      // If still a translation key, use hardcoded message
      if (message === 'comfyui.reset.logs_retrieved') {
        message = logLang === 'zh' ? `已检索到 ${translatedLogs.length} 条重置日志` : `Retrieved ${translatedLogs.length} reset log entries`;
      }
    }
    
    const response: ComfyUIResetLogsResponse = {
      logs: translatedLogs,
      success: true,
      message: message
    };
    
    ctx.body = response;
  }

}

// Export proxy server creation function
export { createComfyUIProxy }; 