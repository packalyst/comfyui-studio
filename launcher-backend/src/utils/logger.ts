import i18n from './i18n';
import fs from 'fs';
import path from 'path';

// Logger interface to match existing functionality
interface LoggerInterface {
  info: (message: string | object, ...meta: any[]) => void;
  warn: (message: string | object, ...meta: any[]) => void;
  error: (message: string | object, ...meta: any[]) => void;
  debug: (message: string | object, ...meta: any[]) => void;
}

// Custom logger implementation without Winston
class CustomLogger {
  private level: string;
  private logDir: string;
  
  constructor() {
    this.level = process.env.LOG_LEVEL || 'info';
    this.logDir = process.env.LOG_DIR || '.';
    
    // Create log directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  private getTimestamp(): string {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substring(0, 19);
  }
  
  private formatLog(level: string, message: string | object, meta: any = {}): string {
    const timestamp = this.getTimestamp();
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return `${timestamp} [${level.toUpperCase()}]: ${typeof message === 'string' ? message : JSON.stringify(message)} ${metaStr}`;
  }
  
  private writeToFile(filename: string, data: string): void {
    const filePath = path.join(this.logDir, filename);
    fs.appendFileSync(filePath, data + '\n');
  }
  
  log(level: string, message: string | object, meta: any = {}): void {
    const logLevels = { error: 0, warn: 1, info: 2, debug: 3 };
    const currentLevelValue = logLevels[this.level as keyof typeof logLevels] || 2;
    const messageLevelValue = logLevels[level as keyof typeof logLevels] || 2;
    
    // Only log if the message level is less than or equal to the current level
    if (messageLevelValue <= currentLevelValue) {
      const formattedLog = this.formatLog(level, message, meta);
      
      // Log to console
      switch (level) {
        case 'error':
          console.error(formattedLog);
          break;
        case 'warn':
          console.warn(formattedLog);
          break;
        case 'debug':
          console.debug(formattedLog);
          break;
        default:
          console.log(formattedLog);
      }
      
      // Log to files
      this.writeToFile('combined.log', formattedLog);
      if (level === 'error') {
        this.writeToFile('error.log', formattedLog);
      }
    }
  }
  
  error(message: string | object, meta: any = {}): void {
    this.log('error', message, meta);
  }
  
  warn(message: string | object, meta: any = {}): void {
    this.log('warn', message, meta);
  }
  
  info(message: string | object, meta: any = {}): void {
    this.log('info', message, meta);
  }
  
  debug(message: string | object, meta: any = {}): void {
    this.log('debug', message, meta);
  }
}

// Create custom logger instance
const customLogger = new CustomLogger();

/**
 * i18n logger wrapper
 * Translates log messages according to the current language
 */
class I18nLogger implements LoggerInterface {
  private locale: string;
  private forceEnglish: boolean;
  
  constructor(locale = 'en') {
    this.locale = locale;
    // Check environment variable to force English logs
    this.forceEnglish = process.env.FORCE_LOG_LANG === 'en' || process.env.FORCE_LOG_LANGUAGE === 'en';
  }

  setLocale(locale: string): I18nLogger {
    // If force English is enabled, ignore locale changes
    if (!this.forceEnglish) {
      this.locale = locale;
    }
    return this;
  }

  getLocale(): string {
    // If force English is enabled, always return 'en'
    if (this.forceEnglish) {
      return 'en';
    }
    return this.locale;
  }

  isInitialized(): boolean {
    return i18n.isInitialized;
  }

  translate(key: string, options: object = {}): string {
    // If force English is enabled, override language in options
    if (this.forceEnglish) {
      const translated = String(i18n.t(key, { lng: 'en', ...(options as any), ns: 'logs' }));
      if (translated === key) {
        // Fallback: include key and serialized options so important values (url/path/status...) are not lost
        const { lng, ns, ...rest } = options as any;
        const details = Object.keys(rest || {}).length ? ` ${JSON.stringify(rest)}` : '';
        return `${key}${details}`;
      }
      return translated;
    }
    // Use locale from options if provided, otherwise use instance locale
    const lang = (options as any)?.lng || this.locale;
    const translated = String(i18n.t(key, { lng: lang, ...(options as any), ns: 'logs' }));
    if (translated === key) {
      // Fallback: include key and serialized options so important values (url/path/status...) are not lost
      const { lng, ns, ...rest } = options as any;
      const details = Object.keys(rest || {}).length ? ` ${JSON.stringify(rest)}` : '';
      return `${key}${details}`;
    }
    return translated;
  }

  // Log methods with translation
  t(key: string, options: object = {}, meta: object = {}): string {
    const message = this.translate(key, options);
    customLogger.info(message, meta);
    return message;
  }

  // Log methods with translation
  error(key: string | object, options: object = {}, meta: object = {}): string {
    // Support legacy usage
    if (typeof key !== 'string') {
      customLogger.error(String(key), options);
      return String(key);
    }
    
    const message = this.translate(key, options);
    customLogger.error(message, meta);
    return message;
  }

  warn(key: string | object, options: object = {}, meta: object = {}): string {
    // Support legacy usage
    if (typeof key !== 'string') {
      customLogger.warn(String(key), options);
      return String(key);
    }
    
    const message = this.translate(key, options);
    customLogger.warn(message, meta);
    return message;
  }

  info(key: string | object, options: object = {}, meta: object = {}): string {
    // Support legacy usage
    if (typeof key !== 'string') {
      customLogger.info(String(key), options);
      return String(key);
    }
    
    const message = this.translate(key, options);
    customLogger.info(message, meta);
    return message;
  }

  debug(key: string | object, options: object = {}, meta: object = {}): string {
    // Support legacy usage
    if (typeof key !== 'string') {
      if (process.env.DEBUG) {
        customLogger.debug(String(key), options);
      }
      return String(key);
    }
    
    const message = this.translate(key, options);
    if (process.env.DEBUG) {
      customLogger.debug(message, meta);
    }
    return message;
  }

  // Direct logging without translation
  log(level: string, message: string, meta: object = {}): string {
    customLogger.log(level, message, meta);
    return message;
  }
}

// Legacy logger API (backward compatible with your existing code)
export const logger = {
  info: (...args: any[]): void => {
    console.log(...args);
  },
  
  warn: (...args: any[]): void => {
    console.warn(...args);
  },
  
  error: (...args: any[]): void => {
    console.error(...args);
  },
  
  debug: (...args: any[]): void => {
    if (process.env.DEBUG) {
      console.debug(...args);
    }
  }
};

// Export i18n logger
export const i18nLogger = new I18nLogger(process.env.DEFAULT_LANGUAGE || 'en');

// Export for usage with .t method
export default i18nLogger; 