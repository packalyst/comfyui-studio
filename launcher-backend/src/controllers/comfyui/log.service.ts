import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { LogParams, Translations, RESET_LOG_PATH, RESET_LOG_FILE, MAX_LOG_ENTRIES } from './types';
import { findLogParams, translateMessage } from './utils';

// Check if force English is enabled via environment variables
const FORCE_ENGLISH_LOGS =
  process.env.FORCE_LOG_LANG === 'en' || process.env.FORCE_LOG_LANGUAGE === 'en';

export class LogService {
  private recentLogs: string[] = [];
  private resetLogs: string[] = [];
  private logParams: LogParams = {};
  
  // Internal translation data
  private translations: Translations = {
    en: {
      'comfyui.logs.request_start': 'Received request to start ComfyUI',
      'comfyui.logs.already_running': 'ComfyUI is already running',
      'comfyui.logs.attempting_start': 'Attempting to start ComfyUI process...',
      'comfyui.logs.launch_cli_args': 'Using CLI args: {args}',
      'comfyui.logs.executing_command': 'Executing command: bash /runner-scripts/entrypoint.sh',
      'comfyui.logs.captured_pid': 'Captured real ComfyUI PID: {pid}',
      'comfyui.logs.process_exited': 'Startup script process exited, exit code: {code}, signal: {signal}',
      'comfyui.logs.process_error': 'Startup script process error: {message}',
      'comfyui.logs.waiting_startup': 'Waiting for ComfyUI to start, attempt {retry}/{maxRetries}'
    },
    zh: {
      'comfyui.logs.request_start': '收到启动ComfyUI请求',
      'comfyui.logs.already_running': 'ComfyUI已经在运行中',
      'comfyui.logs.attempting_start': '尝试启动ComfyUI进程...',
      'comfyui.logs.launch_cli_args': '使用的 CLI 启动参数: {args}',
      'comfyui.logs.executing_command': '执行命令: bash /runner-scripts/entrypoint.sh',
      'comfyui.logs.captured_pid': '捕获到ComfyUI真实PID: {pid}',
      'comfyui.logs.process_exited': '启动脚本进程已退出，退出码: {code}, 信号: {signal}',
      'comfyui.logs.process_error': '启动脚本进程错误: {message}',
      'comfyui.logs.waiting_startup': '等待ComfyUI启动，尝试 {retry}/{maxRetries}'
    }
  };
  
  // Add log entry
  addLog(message: string, isError: boolean = false, translationKey?: string, params?: Record<string, any>): void {
    const timestamp = new Date().toISOString();

    // If translation key and parameters are provided, build a special format for easy parsing later
    let logMessage = message;
    if (translationKey) {
      logMessage = translationKey;
      // If there are parameters, store them in logParams
      if (params && Object.keys(params).length > 0) {
        // Debug: Store parameters for translation
        // Store parameters as internal property
        this.logParams = this.logParams || {};
        this.logParams[translationKey] = params;
      }
    }
    
    const logEntry = `[${timestamp}] ${isError ? 'ERROR: ' : ''}${logMessage}`;

    // Add to log array and maintain size limit
    this.recentLogs.push(logEntry);
    if (this.recentLogs.length > MAX_LOG_ENTRIES) {
      this.recentLogs.shift(); // Remove oldest log
    }
    
    // Also log to system log
    let systemMessage = message;
    // If we have a translation key, prefer translated message for system logs
    if (translationKey) {
      try {
        const lang = FORCE_ENGLISH_LOGS ? 'en' : i18nLogger.getLocale();
        systemMessage = i18nLogger.translate(translationKey, {
          lng: lang,
          ...(params || {})
        });
      } catch {
        // Fallback to original message if translation fails
        systemMessage = message;
      }
    }

    if (isError) {
      logger.error(systemMessage);
    } else {
      logger.info(systemMessage);
    }
  }
  
  // Add reset log entry
  addResetLog(message: string, isError: boolean = false, lang?: string): void {
    const timestamp = new Date().toISOString();
    let logMessage = message;
    
    // If message looks like a translation key (contains dots but no spaces), try to translate it
    if (message.includes('.') && !message.includes(' ')) {
      // Use provided language or default language
      const useLang = lang || i18nLogger.getLocale();
      logMessage = i18nLogger.translate(message, { lng: useLang });
    }
    
    // Create log entry
    const logEntry = `[${timestamp}] ${isError ? 'ERROR: ' : ''}${logMessage}`;
    this.resetLogs.push(logEntry);
    
    // Also log to system log
    if (isError) {
      logger.error(logMessage);
    } else {
      logger.info(logMessage);
    }
    
    // Write log to file
    this.writeResetLogToFile(logEntry);
  }
  
  // Write reset log to file
  private writeResetLogToFile(logEntry: string): void {
    try {
      // Ensure log directory exists
      if (!fs.existsSync(RESET_LOG_PATH)) {
        fs.mkdirSync(RESET_LOG_PATH, { recursive: true });
      }
      
      // Append write log
      fs.appendFileSync(path.join(process.cwd(), RESET_LOG_PATH, RESET_LOG_FILE), logEntry + '\n');
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('comfyui.logs.write_reset_log_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }
  
  // Get localized logs
  getLocalizedLogs(lang: string): string[] {
    // If FORCE_ENGLISH_LOGS is enabled, always use English regardless of requested lang
    const simpleLang = FORCE_ENGLISH_LOGS ? 'en' : lang.split('-')[0]; // Handle formats like 'en-US', convert to 'en'
    
    // Localize log entries
    const localizedLogs = this.recentLogs.map(logEntry => {
      // Handle log entries with standard prefixes
      const matches = logEntry.match(/^\[(.*?)\]\s*(ERROR:\s*)?(.*)$/);
      if (matches) {
        const timestamp = matches[1];
        const isError = !!matches[2];
        let message = matches[3];
        
        // Debug: Localizing log message
        // Check if message is a translation key
        if (message.match(/^comfyui\.logs\.[a-z_]+$/)) {
          const key = message; // Save original key name
          
          // Find stored parameters
          const params = this.logParams[key];
          
          if (params) {
            message = translateMessage(key, simpleLang, this.translations, params);
          } else {
            // Try direct translation, if there are unreplaced placeholders, try to extract parameters
            message = translateMessage(key, simpleLang, this.translations, undefined);
            
            // If there are still unreplaced placeholders after translation, try to extract parameters from original log entry
            if (message.match(/\{(\w+)\}/)) {
              // Debug: Try to extract parameters from log entry
              const extractedParams = findLogParams(logEntry);
              if (extractedParams) {
                message = translateMessage(key, simpleLang, this.translations, extractedParams);
              }
              // If extraction fails, keep placeholders as is
            }
          }
        }
        
        // Rebuild log entry
        return `[${timestamp}] ${isError ? 'ERROR: ' : ''}${message}`;
      }
      return logEntry;
    });
    
    return localizedLogs;
  }
  
  // Get localized reset logs
  getLocalizedResetLogs(lang: string): string[] {
    // If no logs in memory, try to read from file
    if (this.resetLogs.length === 0) {
      try {
        const logFilePath = path.join(process.cwd(), RESET_LOG_PATH, RESET_LOG_FILE);
        if (fs.existsSync(logFilePath)) {
          const fileContent = fs.readFileSync(logFilePath, 'utf8');
          if (fileContent.trim()) {
            this.resetLogs = fileContent.split('\n').filter(line => line.trim());
          }
        }
      } catch (error) {
        logger.error(`Failed to read reset log file: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    // Translate log content
    const translatedLogs = this.resetLogs.map(log => {
      try {
        // Try to extract timestamp and message parts
        const matches = log.match(/^\[(.*?)\]\s*(ERROR:\s*)?(.*)$/);
        if (matches) {
          const timestamp = matches[1];
          const isError = !!matches[2];
          let message = matches[3];
          
          // Check if message is a translation key (usually contains dot separators)
          if (message.includes('.') && !message.includes(' ')) {
            // Use i18nLogger.translate directly for translation
            const translatedMessage = i18nLogger.translate(message, { lng: lang });
            
            // If translation result is the same as original key (possibly no translation found), use basic translation table
            if (translatedMessage === message) {
              // Provide basic translations for various languages
              const basicTranslations: { [key: string]: { [key: string]: string } } = {
                'en': {
                  'comfyui.reset.started': 'ComfyUI reset process started',
                  'comfyui.reset.stopping': 'Stopping running ComfyUI process',
                  'comfyui.reset.completed': 'ComfyUI has been reset successfully',
                  'comfyui.reset.stop_failed': 'Failed to stop ComfyUI process',
                  'comfyui.reset.cleaning_cache': 'Cleaning cache directory',
                  'comfyui.reset.cache_not_exist': 'Cache directory does not exist',
                  'comfyui.reset.cleaning_path': 'Cleaning ComfyUI directory',
                  'comfyui.reset.keeping_dir': 'Keeping directory',
                  'comfyui.reset.deleting_dir': 'Deleting directory',
                  'comfyui.reset.deleting_file': 'Deleting file',
                  'comfyui.reset.path_not_exist': 'ComfyUI path does not exist',
                  'comfyui.reset.recovery_started': 'Starting recovery process',
                  'comfyui.reset.recovery_completed': 'Recovery process completed successfully',
                  'comfyui.reset.recovery_failed': 'Recovery process failed',
                  'comfyui.reset.reset_completed': 'ComfyUI reset completed successfully',
                  'comfyui.reset.failed': 'Failed to reset ComfyUI',
                  'comfyui.reset.no_logs': 'No reset logs found',
                  'comfyui.reset.logs_retrieved': 'Retrieved reset log entries',
                  'comfyui.reset.mode_normal': 'Using normal reset mode: preserving user, models, and custom_nodes directories',
                  'comfyui.reset.mode_hard': 'Using hard reset mode: preserving only models directory',
                  'comfyui.reset.preserving_normal_dirs': 'Normal mode: preserving user, models, and custom_nodes directories',
                  'comfyui.reset.preserving_hard_dirs': 'Hard mode: preserving only models directory'
                },
                'zh': {
                  'comfyui.reset.started': 'ComfyUI重置过程已启动',
                  'comfyui.reset.stopping': '正在停止运行中的ComfyUI进程',
                  'comfyui.reset.completed': 'ComfyUI已成功重置',
                  'comfyui.reset.stop_failed': '无法停止ComfyUI进程',
                  'comfyui.reset.cleaning_cache': '正在清理缓存目录',
                  'comfyui.reset.cache_not_exist': '缓存目录不存在',
                  'comfyui.reset.cleaning_path': '正在清理ComfyUI目录',
                  'comfyui.reset.keeping_dir': '保留目录',
                  'comfyui.reset.deleting_dir': '删除目录',
                  'comfyui.reset.deleting_file': '删除文件',
                  'comfyui.reset.path_not_exist': 'ComfyUI路径不存在',
                  'comfyui.reset.recovery_started': '开始恢复进程',
                  'comfyui.reset.recovery_completed': '恢复进程成功完成',
                  'comfyui.reset.recovery_failed': '恢复进程失败',
                  'comfyui.reset.reset_completed': 'ComfyUI重置成功完成',
                  'comfyui.reset.failed': '重置ComfyUI失败',
                  'comfyui.reset.no_logs': '未找到重置日志',
                  'comfyui.reset.logs_retrieved': '已检索重置日志条目',
                  'comfyui.reset.mode_normal': '使用普通重置模式：保留user、models和custom_nodes目录',
                  'comfyui.reset.mode_hard': '使用强力重置模式：仅保留models目录',
                  'comfyui.reset.preserving_normal_dirs': '普通模式：保留user、models和custom_nodes目录',
                  'comfyui.reset.preserving_hard_dirs': '强力模式：仅保留models目录'
                }
              };
              
              // Get translation for current language, if not exists use English
              const langTranslations = basicTranslations[lang] || basicTranslations['en'];
              message = langTranslations[message] || message;
            } else {
              message = translatedMessage;
            }
          }
          
          // Rebuild complete log entry
          return `[${timestamp}] ${isError ? 'ERROR: ' : ''}${message}`;
        }
        // If doesn't match format, keep as is
        return log;
      } catch (e) {
        // If any error occurs during processing, return original log
        return log;
      }
    });
    
    return translatedLogs;
  }
  
  // Clear logs
  clearLogs(): void {
    this.recentLogs = [];
  }
  
  // Clear reset logs
  clearResetLogs(): void {
    this.resetLogs = [];
    this.logParams = {};
  }
  
  // Get recent logs
  getRecentLogs(): string[] {
    return this.recentLogs;
  }
  
  // Get reset logs
  getResetLogs(): string[] {
    return this.resetLogs;
  }
}
