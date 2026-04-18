import superagent from 'superagent';
import { config } from '../../config';
import { i18nLogger } from '../../utils/logger';

// 单个服务检查结果
export interface ServiceCheckInfo {
  accessible: boolean;
  name: string;
  lastCheckTime: number;
  url?: string;
}

// 网络检查结果缓存接口
export interface NetworkCheckCache {
  github: ServiceCheckInfo;
  pip: ServiceCheckInfo;
  huggingface: ServiceCheckInfo;
}

// 添加网络检查日志接口
export interface NetworkCheckLog {
  id: string;
  status: 'in_progress' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  logs: Array<{
    time: number;
    service?: string;
    message: string;
    type: 'info' | 'error' | 'success';
    lang?: string;
  }>;
  result?: any;
}

// 添加简单的多语言支持模块
interface I18nMessages {
  [key: string]: {
    [key: string]: string
  }
}

// Check if force English is enabled via environment variables
const FORCE_ENGLISH_LOGS =
  process.env.FORCE_LOG_LANG === 'en' || process.env.FORCE_LOG_LANGUAGE === 'en';

// 简单的日志消息翻译
const logMessages: I18nMessages = {
  'network.check.started': {
    'en': 'Network check started',
    'zh': '网络检查已启动'
  },
  'network.check.started.force': {
    'en': 'Network check started (force mode, cache will be ignored)',
    'zh': '开始执行网络检查（强制模式，将忽略缓存）'
  },
  'network.check.background': {
    'en': 'Network check started, running in background',
    'zh': '网络检查已启动，正在后台执行'
  },
  'network.check.background.force': {
    'en': 'Network check started (force mode), running in background',
    'zh': '网络检查已启动（强制模式），正在后台执行'
  },
  'network.proxy.detected': {
    'en': 'Detected GitHub proxy link: {0}',
    'zh': '检测到 GitHub 代理链接: {0}'
  },
  'network.proxy.check.part': {
    'en': 'Will only check proxy server part: {0}',
    'zh': '将只检查代理服务器部分: {0}'
  },
  'network.cache.used': {
    'en': 'Using cached check result, time since last check: {0}s',
    'zh': '使用缓存的检查结果，距上次检查：{0}秒'
  },
  'network.force.recheck': {
    'en': 'Force recheck',
    'zh': '强制重新检查'
  },
  'network.cache.expired': {
    'en': 'Cache expired',
    'zh': '缓存已过期'
  },
  'network.need.recheck': {
    'en': '{0}, need to check again',
    'zh': '{0}，需要重新检查'
  },
  'network.check.services': {
    'en': 'Starting to check {0} services',
    'zh': '开始检查 {0} 个服务'
  },
  'network.check.url': {
    'en': 'Starting to check {0}',
    'zh': '开始检查 {0}'
  },
  'network.accessibility.check': {
    'en': 'Accessibility check: {0}, status code: {1}',
    'zh': '可访问性检查: {0}, 状态码: {1}'
  },
  'network.check.failed': {
    'en': 'Check failed: {0}',
    'zh': '检查失败: {0}'
  },
  'network.all.checked': {
    'en': 'All services checked',
    'zh': '所有服务检查完成'
  },
  'network.all.cached': {
    'en': 'All services use cached results, no need to recheck',
    'zh': '所有服务使用缓存结果，无需重新检查'
  },
  'network.check.completed': {
    'en': 'Network check completed',
    'zh': '网络检查已完成'
  }
};

// 多语言字符串格式化辅助函数
function formatMessage(key: string, lang: string, ...args: any[]): string {
  // 默认为英文
  const defaultLang = 'en';
  
  // 处理带有区域代码的语言标识，例如将 'zh-CN' 转换为 'zh'
  // 如果开启了强制英文日志，则忽略传入的语言参数
  let targetLang = FORCE_ENGLISH_LOGS ? 'en' : (lang || defaultLang);
  if (targetLang.startsWith('zh')) {
    targetLang = 'zh';
  }
  
  // 如果找不到对应语言，回退到默认语言
  const message = logMessages[key]?.[targetLang] || logMessages[key]?.[defaultLang] || key;
  
  // 替换占位符 {0}, {1}, ...
  return message.replace(/{(\d+)}/g, (match, index) => {
    return typeof args[index] !== 'undefined' ? args[index] : match;
  });
}

export class NetworkChecker {
  private readonly CACHE_VALIDITY_PERIOD = 10 * 60 * 1000; // 10分钟的缓存有效期（毫秒）
  
  // 网络检查缓存，每项单独记录检查时间
  private networkCheckCache: NetworkCheckCache = {
    github: {
      accessible: false,
      name: 'GitHub',
      lastCheckTime: 0
    },
    pip: {
      accessible: false,
      name: 'PIP源',
      lastCheckTime: 0
    },
    huggingface: {
      accessible: false,
      name: 'Hugging Face',
      lastCheckTime: 0
    }
  };
  
  // 检查日志存储，键为检查ID
  private networkCheckLogs: Map<string, NetworkCheckLog> = new Map();
  // 保留最近10次检查的日志
  private readonly MAX_LOG_ENTRIES = 10;

  constructor() {}

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return Date.now().toString() + Math.random().toString(36).substring(2, 10);
  }
  
  /**
   * 添加检查日志
   */
  private addNetworkCheckLog(log: NetworkCheckLog): void {
    this.networkCheckLogs.set(log.id, log);
    
    // 如果日志条目超过最大限制，删除最旧的
    if (this.networkCheckLogs.size > this.MAX_LOG_ENTRIES) {
      const oldestKey = Array.from(this.networkCheckLogs.keys())[0];
      this.networkCheckLogs.delete(oldestKey);
    }
  }
  
  /**
   * 添加日志条目，支持多语言
   */
  private logNetworkCheck(
    id: string, 
    message: string, 
    type: 'info' | 'error' | 'success' = 'info', 
    service?: string,
    lang?: string
  ): void {
    const log = this.networkCheckLogs.get(id);
    if (log) {
      // 存储原始消息，不做语言处理，前端将根据当前语言显示
      log.logs.push({
        time: Date.now(),
        message,
        type,
        service,
        lang // 可选记录当前语言
      });
      console.log(`[Network Check ${id}] ${service ? `[${service}] ` : ''}${message}`);
    }
  }

  /**
   * 使指定服务的网络检查缓存失效
   * @param service 服务名称，不传则使所有缓存失效
   */
  public invalidateNetworkCheckCache(service?: 'github' | 'pip' | 'huggingface'): void {
    const now = 0; // 将时间戳重置为0表示缓存失效
    
    const logLang = i18nLogger.getLocale();
    if (service) {
      // 使指定服务的缓存失效
      this.networkCheckCache[service].lastCheckTime = now;
      i18nLogger.info('system.network.cache_invalidated', { service: this.networkCheckCache[service].name, lng: logLang });
    } else {
      // 使所有服务的缓存失效
      Object.keys(this.networkCheckCache).forEach(key => {
        const svcKey = key as keyof NetworkCheckCache;
        this.networkCheckCache[svcKey].lastCheckTime = now;
      });
      i18nLogger.info('system.network.all_cache_invalidated', { lng: logLang });
    }
  }

  /**
   * 开始网络检查，返回检查ID
   * @param forceCheck 是否强制检查
   * @param lang 语言
   * @param envConfig 环境变量配置
   * @returns 检查ID和状态信息
   */
  public startNetworkCheck(forceCheck: boolean, lang: string, envConfig: any): { checkId: string; status: string; forceCheck: boolean } {
    const checkId = this.generateId();
    
    // 创建新的检查日志
    const checkLog: NetworkCheckLog = {
      id: checkId,
      status: 'in_progress',
      startTime: Date.now(),
      logs: []
    };
    this.addNetworkCheckLog(checkLog);
    
    // 使用多语言支持记录日志
    this.logNetworkCheck(
      checkId, 
      formatMessage(
        forceCheck ? 'network.check.background.force' : 'network.check.background', 
        lang
      ),
      'info',
      undefined,
      lang
    );
    
    // 异步执行网络检查，不等待它完成
    this.performNetworkCheck(checkId, forceCheck, lang, envConfig).catch(error => {
      i18nLogger.error('system.network.check_error', { message: error instanceof Error ? error.message : String(error), lng: lang });
      const log = this.networkCheckLogs.get(checkId);
      if (log) {
        log.status = 'failed';
        log.endTime = Date.now();
        this.logNetworkCheck(
          checkId, 
          `${formatMessage('network.check.failed', lang)}: ${error.message}`, 
          'error',
          undefined,
          lang
        );
      }
    });

    return {
      checkId,
      status: 'in_progress',
      forceCheck
    };
  }
  
  /**
   * 执行网络检查（内部方法），支持多语言
   * @param checkId 检查ID
   * @param forceCheck 是否强制检查（忽略缓存）
   * @param lang 语言
   * @param envConfig 环境变量配置
   */
  private async performNetworkCheck(
    checkId: string, 
    forceCheck: boolean = false,
    lang: string = 'en',
    envConfig: any = {}
  ): Promise<void> {
    const now = Date.now();
    
    this.logNetworkCheck(
      checkId, 
      formatMessage(
        forceCheck ? 'network.check.started.force' : 'network.check.started', 
        lang
      ),
      'info',
      undefined,
      lang
    );
    
    // 定义需要检查的网站，优先使用环境变量中配置的代理地址
    const sitesToCheck = [
      { 
        name: 'github' as const, 
        url: envConfig.GITHUB_PROXY || 'https://github.com/', 
        type: 'GitHub'
      },
      { 
        name: 'pip' as const, 
        url: envConfig.PIP_INDEX_URL || 'https://pypi.org/simple/', 
        type: 'PIP源'
      },
      { 
        name: 'huggingface' as const, 
        url: envConfig.HF_ENDPOINT || 'https://huggingface.co/', 
        type: 'Hugging Face'
      }
    ];
    
    // 处理 GitHub 代理的特殊情况
    if (sitesToCheck[0].url && sitesToCheck[0].url.includes('gh-proxy.com')) {
      const proxyUrlMatch = sitesToCheck[0].url.match(/(https?:\/\/gh-proxy\.com)/);
      if (proxyUrlMatch && proxyUrlMatch[1]) {
        this.logNetworkCheck(
          checkId, 
          formatMessage('network.proxy.detected', lang, sitesToCheck[0].url), 
          'info', 
          'github',
          lang
        );
        this.logNetworkCheck(
          checkId, 
          formatMessage('network.proxy.check.part', lang, proxyUrlMatch[1]), 
          'info', 
          'github',
          lang
        );
        sitesToCheck[0].url = proxyUrlMatch[1];
      }
    }
    
    // 筛选出缓存过期的网站进行检查
    const sitesNeedCheck = sitesToCheck.filter(site => {
      const cached = this.networkCheckCache[site.name];
      const isCacheValid = !forceCheck && (now - cached.lastCheckTime < this.CACHE_VALIDITY_PERIOD);
      
      if (isCacheValid) {
        this.logNetworkCheck(
          checkId, 
          formatMessage('network.cache.used', lang, (now - cached.lastCheckTime) / 1000), 
          'info', 
          site.name,
          lang
        );
        // 更新URL（可能配置已变更）
        cached.url = site.url;
      } else {
        const reason = forceCheck ? formatMessage('network.force.recheck', lang) : formatMessage('network.cache.expired', lang);
        this.logNetworkCheck(
          checkId, 
          formatMessage('network.need.recheck', lang, site.name, reason), 
          'info', 
          site.name,
          lang
        );
      }
      
      return !isCacheValid;
    });
    
    // 如果有网站需要检查，则进行检查
    if (sitesNeedCheck.length > 0) {
      this.logNetworkCheck(
        checkId, 
        formatMessage('network.check.services', lang, sitesNeedCheck.length), 
        'info', 
        undefined,
        lang
      );
      
      // 并行检查所有需要检查的网站
      await Promise.all(sitesNeedCheck.map(async (site) => {
        try {
          this.logNetworkCheck(
            checkId, 
            formatMessage('network.check.url', lang, site.url), 
            'info', 
            site.name,
            lang
          );
          
          // For pip repository, use HEAD request to avoid timeout due to large content
          // For other services, use GET request
          const request = site.name === 'pip' 
            ? superagent.head(site.url)
            : superagent.get(site.url);
          
          const response = await request
            .timeout({
              response: 5000,  // 等待响应最多5秒
              deadline: 10000  // 总请求时间最多10秒
            });
          
          // 更新检查结果
          this.networkCheckCache[site.name].accessible = response.status >= 200 && response.status < 300;
          this.networkCheckCache[site.name].lastCheckTime = now;
          this.networkCheckCache[site.name].url = site.url;
          
          const resultMessage = formatMessage('network.accessibility.check', lang, this.networkCheckCache[site.name].accessible, response.status);
          this.logNetworkCheck(
            checkId, 
            resultMessage, 
            this.networkCheckCache[site.name].accessible ? 'success' : 'error',
            site.name,
            lang
          );
        } catch (error) {
          this.networkCheckCache[site.name].accessible = false;
          this.networkCheckCache[site.name].lastCheckTime = now;
          this.networkCheckCache[site.name].url = site.url;
          
          this.logNetworkCheck(
            checkId, 
            formatMessage('network.check.failed', lang, error instanceof Error ? error.message : String(error)), 
            'error', 
            site.name,
            lang
          );
        }
      }));
      
      this.logNetworkCheck(
        checkId, 
        formatMessage('network.all.checked', lang), 
        'success', 
        undefined,
        lang
      );
    } else {
      this.logNetworkCheck(
        checkId, 
        formatMessage('network.all.cached', lang), 
        'info', 
        undefined,
        lang
      );
    }
    
    // 构建响应结果
    const checkResult = {
      github: {
        accessible: this.networkCheckCache.github.accessible,
        name: this.networkCheckCache.github.name,
        url: this.networkCheckCache.github.url
      },
      pip: {
        accessible: this.networkCheckCache.pip.accessible,
        name: this.networkCheckCache.pip.name,
        url: this.networkCheckCache.pip.url
      },
      huggingface: {
        accessible: this.networkCheckCache.huggingface.accessible,
        name: this.networkCheckCache.huggingface.name,
        url: this.networkCheckCache.huggingface.url
      }
    };

    // 更新检查日志的状态和结果
    const log = this.networkCheckLogs.get(checkId);
    if (log) {
      log.status = 'completed';
      log.endTime = Date.now();
      log.result = checkResult;
      this.logNetworkCheck(
        checkId, 
        formatMessage('network.check.completed', lang), 
        'success',
        undefined,
        lang
      );
    }
  }
  
  /**
   * 获取网络检查日志
   * @param checkId 检查ID
   * @returns 检查日志或null
   */
  public getNetworkCheckLog(checkId: string): NetworkCheckLog | null {
    return this.networkCheckLogs.get(checkId) || null;
  }

  /**
   * 获取当前网络检查结果
   * @returns 当前网络状态
   */
  public getCurrentNetworkStatus(): any {
    return {
      github: {
        accessible: this.networkCheckCache.github.accessible,
        name: this.networkCheckCache.github.name,
        url: this.networkCheckCache.github.url
      },
      pip: {
        accessible: this.networkCheckCache.pip.accessible,
        name: this.networkCheckCache.pip.name,
        url: this.networkCheckCache.pip.url
      },
      huggingface: {
        accessible: this.networkCheckCache.huggingface.accessible,
        name: this.networkCheckCache.huggingface.name,
        url: this.networkCheckCache.huggingface.url
      }
    };
  }
}
