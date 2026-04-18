import * as fs from 'fs';
import * as path from 'path';
import logger, { i18nLogger } from '../../utils/logger';
import { Context } from 'koa';

// 确定环境和路径
const isDev = process.env.NODE_ENV !== 'production';

// 历史记录路径
const HISTORY_FILE_PATH = process.env.PLUGIN_HISTORY_PATH || 
  path.join(isDev ? process.cwd() : process.env.DATA_DIR as string, '.comfyui-manager-history.json');

// 最大历史记录数量
const MAX_HISTORY_ITEMS = 100;

// 定义历史记录项的类型
export interface PluginOperationHistory {
  id: string;                          // 操作ID
  pluginId: string;                    // 插件ID
  pluginName?: string;                 // 插件名称
  type: 'install' | 'uninstall' | 'disable' | 'enable' | 'switch-version'; // 操作类型
  typeText?: string;                   // 操作类型的本地化文本
  startTime: number;                   // 操作开始时间戳
  endTime?: number;                    // 操作结束时间戳
  status: 'running' | 'success' | 'failed'; // 操作状态
  statusText?: string;                 // 状态的本地化文本
  logs: string[];                      // 详细日志
  result?: string;                     // 最终结果描述
  resultLocalized?: string;            // 本地化的结果描述
  githubProxy?: string;                // GitHub代理URL (如果使用)
}

export class PluginHistoryManager {
  private operationHistory: PluginOperationHistory[] = [];

  constructor() {
    // 加载历史记录
    this.loadHistory();
  }

  // 加载历史记录
  private async loadHistory(): Promise<void> {
    try {
      const logLang = i18nLogger.getLocale();
      if (fs.existsSync(HISTORY_FILE_PATH)) {
        const historyData = fs.readFileSync(HISTORY_FILE_PATH, 'utf-8');
        this.operationHistory = JSON.parse(historyData);
        i18nLogger.info('plugin.history.loaded', { count: this.operationHistory.length, lng: logLang });
      } else {
        i18nLogger.info('plugin.history.file_not_found', { lng: logLang });
        this.operationHistory = [];
        // 确保目录存在
        const historyDir = path.dirname(HISTORY_FILE_PATH);
        if (!fs.existsSync(historyDir)) {
          fs.mkdirSync(historyDir, { recursive: true });
        }
        // 创建空的历史记录文件
        this.saveHistory();
      }
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.history.load_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      this.operationHistory = [];
    }
  }

  // 保存历史记录
  private saveHistory(): void {
    try {
      const logLang = i18nLogger.getLocale();
      // 限制历史记录数量
      if (this.operationHistory.length > MAX_HISTORY_ITEMS) {
        this.operationHistory = this.operationHistory.slice(-MAX_HISTORY_ITEMS);
      }
      
      fs.writeFileSync(HISTORY_FILE_PATH, JSON.stringify(this.operationHistory, null, 2), 'utf-8');
      i18nLogger.info('plugin.history.saved', { count: this.operationHistory.length, lng: logLang });
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.history.save_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }

  // 添加历史记录
  public addHistoryItem(
    taskId: string, 
    pluginId: string, 
    type: 'install' | 'uninstall' | 'disable' | 'enable' | 'switch-version', 
    githubProxy?: string,
    pluginName?: string
  ): PluginOperationHistory {
    // 创建新的历史记录项
    const historyItem: PluginOperationHistory = {
      id: taskId,
      pluginId,
      pluginName,
      type,
      startTime: Date.now(),
      status: 'running',
      logs: [`[${new Date().toLocaleString()}] 开始${this.getOperationTypeName(type)}插件 ${pluginId}`],
      githubProxy
    };
    
    // 添加到历史记录数组
    this.operationHistory.unshift(historyItem);
    
    // 保存历史记录
    this.saveHistory();
    
    return historyItem;
  }

  // 更新历史记录
  public updateHistoryItem(taskId: string, updates: Partial<PluginOperationHistory>): void {
    // 查找历史记录项
    const historyItem = this.operationHistory.find(item => item.id === taskId);
    if (historyItem) {
      // 更新历史记录项
      Object.assign(historyItem, updates);
      
      // 保存历史记录
      this.saveHistory();
    }
  }

  // 获取操作类型名称
  private getOperationTypeName(type: 'install' | 'uninstall' | 'disable' | 'enable' | 'switch-version'): string {
    switch (type) {
      case 'install': return '安装';
      case 'uninstall': return '卸载';
      case 'disable': return '禁用';
      case 'enable': return '启用';
      case 'switch-version': return '切换版本';
    }
  }

  // 获取操作历史记录
  public async getOperationHistory(ctx: Context): Promise<void> {
    try {
      const limit = ctx.query.limit ? parseInt(ctx.query.limit as string) : 100;
      const limitedHistory = this.operationHistory.slice(0, limit);
      
      ctx.body = {
        success: true,
        history: limitedHistory
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.history.get_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `获取历史记录失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取特定操作的详细日志
  public async getOperationLogs(ctx: Context): Promise<void> {
    try {
      const taskId = ctx.params.taskId;
      if (!taskId) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          message: 'Task ID is required'
        };
        return;
      }
      
      // 查找特定任务
      const task = this.operationHistory.find(item => item.id === taskId);
      
      if (!task) {
        ctx.status = 404;
        ctx.body = {
          success: false,
          message: 'Task not found'
        };
        return;
      }
      
      // 获取客户端首选语言
      const locale = this.getClientLocale(ctx) || i18nLogger.getLocale();
      
      // 翻译日志
      const translatedLogs = this.translateLogs(task.logs || [], locale);
      
      ctx.body = {
        success: true,
        logs: translatedLogs
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.history.get_logs_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: 'Failed to get operation logs'
      };
    }
  }

  // 清除历史记录
  public async clearOperationHistory(ctx: Context): Promise<void> {
    try {
      this.operationHistory = [];
      this.saveHistory();
      
      ctx.body = {
        success: true,
        message: '历史记录已清除'
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.history.clear_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `清除历史记录失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取插件历史记录 - 添加本地化支持
  public async getPluginHistory(ctx: Context): Promise<void> {
    try {
      // 获取客户端首选语言
      const locale = this.getClientLocale(ctx) || i18nLogger.getLocale();
      
      // 本地化历史记录
      const localizedHistory = this.operationHistory.map(item => {
        const localizedItem = { ...item };
        
        // 翻译操作类型
        localizedItem.typeText = this.translateOperationType(item.type, locale);
        
        // 翻译状态
        localizedItem.statusText = this.translateStatus(item.status, locale);
        
        // 尝试本地化结果消息
        if (item.result) {
          localizedItem.resultLocalized = this.translateResult(item.result, locale);
        }
        
        return localizedItem;
      });
      
      ctx.body = {
        success: true,
        history: localizedHistory
      };
    } catch (error) {
      const lang = this.getClientLocale(ctx) || 'en';
      i18nLogger.error('plugin.history.get_plugin_history_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: i18nLogger.translate('plugins.history.error', { lng: this.getClientLocale(ctx) })
      };
    }
  }
  
  // 清除插件历史记录
  public async clearPluginHistory(ctx: Context): Promise<void> {
    try {
      const locale = this.getClientLocale(ctx) || i18nLogger.getLocale();
      
      // 清空历史记录文件
      await require('fs').promises.writeFile(
        HISTORY_FILE_PATH,
        JSON.stringify([])
      );
      
      // 清空内存中的历史记录
      this.operationHistory = [];
      
      ctx.body = {
        success: true,
        message: i18nLogger.translate('plugins.history.cleared', { lng: locale })
      };
    } catch (error) {
      const lang = this.getClientLocale(ctx) || 'en';
      i18nLogger.error('plugin.history.clear_plugin_history_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: i18nLogger.translate('plugins.history.clear_error', { lng: this.getClientLocale(ctx) })
      };
    }
  }
  
  // 删除特定的插件历史记录
  public async deletePluginHistoryItem(ctx: Context): Promise<void> {
    const { id } = ctx.request.body as { id?: string };
    const locale = this.getClientLocale(ctx) || i18nLogger.getLocale();
    
    if (!id) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        message: i18nLogger.translate('plugins.history.id_required', { lng: locale })
      };
      return;
    }
    
    try {
      // 查找并删除记录
      const index = this.operationHistory.findIndex(item => item.id === id);
      
      if (index !== -1) {
        const deletedItem = this.operationHistory[index];
        this.operationHistory.splice(index, 1);
        
        // 保存更新后的历史记录
        this.saveHistory();
        
        ctx.body = {
          success: true,
          message: i18nLogger.translate('plugins.history.item_deleted', { 
            lng: locale,
            name: deletedItem.pluginName || deletedItem.pluginId
          })
        };
      } else {
        ctx.status = 404;
        ctx.body = {
          success: false,
          message: i18nLogger.translate('plugins.history.item_not_found', { 
            lng: locale,
            id 
          })
        };
      }
    } catch (error) {
      const lang = locale || 'en';
      i18nLogger.error('plugin.history.delete_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: i18nLogger.translate('plugins.history.delete_error', { lng: locale })
      };
    }
  }

  // 获取客户端首选语言
  private getClientLocale(ctx: Context): string | undefined {
    // 从查询参数获取
    if (ctx.query.lang && typeof ctx.query.lang === 'string') {
      // 从查询参数获取语言
      return ctx.query.lang;
    }
    
    // 从Accept-Language头获取
    const acceptLanguage = ctx.get('Accept-Language');
    if (acceptLanguage) {
      const lang = acceptLanguage.split(',')[0].split(';')[0].split('-')[0];
        // 从Accept-Language获取语言
      return lang;
    }
    
    // 未找到语言参数，使用默认语言
    return undefined;
  }
  
  // 翻译操作类型
  private translateOperationType(type: string, locale: string): string {
    // 直接对应的翻译映射，避免使用i18n中间层
    const translations: Record<string, Record<string, string>> = {
      'install': {
        'en': 'Install',
        'zh': '安装',
        'ja': 'インストール',
        'ko': '설치'
      },
      'uninstall': {
        'en': 'Uninstall',
        'zh': '卸载',
        'ja': 'アンインストール',
        'ko': '제거'
      },
      'enable': {
        'en': 'Enable',
        'zh': '启用',
        'ja': '有効化',
        'ko': '활성화'
      },
      'disable': {
        'en': 'Disable',
        'zh': '禁用',
        'ja': '無効化',
        'ko': '비活性化'
      }
    };
    
    // 如果有对应语言的直接翻译，使用它
    if (translations[type] && translations[type][locale]) {
      return translations[type][locale];
    }
    
    // 否则尝试使用i18n
    const keyMap: Record<string, string> = {
      'install': 'plugins.operation.install',
      'uninstall': 'plugins.operation.uninstall',
      'enable': 'plugins.operation.enable',
      'disable': 'plugins.operation.disable',
      'switch-version': 'plugins.operation.switchVersion'
    };
    
    const key = keyMap[type] || 'plugins.operation.unknown';
    
    try {
      return i18nLogger.translate(key, { lng: locale });
    } catch (error) {
      // 如果没有匹配的翻译，返回英文备用翻译
      if (translations[type] && translations[type]['en']) {
        return translations[type]['en'];
      }
      
      // 最后的后备
      return type.charAt(0).toUpperCase() + type.slice(1);
    }
  }
  
  // 翻译状态
  private translateStatus(status: string, locale: string): string {
    // 直接翻译映射
    const translations: Record<string, Record<string, string>> = {
      'running': {
        'en': 'Running',
        'zh': '进行中',
        'ja': '実行中',
        'ko': '실행 중'
      },
      'success': {
        'en': 'Success',
        'zh': '成功',
        'ja': '成功',
        'ko': '성공'
      },
      'failed': {
        'en': 'Failed',
        'zh': '失败',
        'ja': '失敗',
        'ko': '실패'
      }
    };
    
    // 如果有对应语言的直接翻译，使用它
    if (translations[status] && translations[status][locale]) {
      return translations[status][locale];
    }
    
    // 否则尝试使用i18n
    const keyMap: Record<string, string> = {
      'running': 'plugins.status.running',
      'success': 'plugins.status.success',
      'failed': 'plugins.status.failed'
    };
    
    const key = keyMap[status] || 'plugins.status.unknown';
    
    try {
      return i18nLogger.translate(key, { lng: locale });
    } catch (error) {
      // 如果没有匹配的翻译，返回英文备用翻译
      if (translations[status] && translations[status]['en']) {
        return translations[status]['en'];
      }
      
      // 最后的后备
      return status.charAt(0).toUpperCase() + status.slice(1);
    }
  }
  
  // 翻译结果信息
  private translateResult(result: string, locale: string): string {
    // 直接翻译映射，与其他翻译方法一致
    const translations: Record<string, Record<string, string>> = {
      'install_completed': {
        'en': 'Installation completed on {{date}}',
        'zh': '安装完成于 {{date}}',
        'ja': 'インストールが完了しました {{date}}',
        'ko': '설치 완료 {{date}}'
      },
      'uninstall_completed': {
        'en': 'Uninstalled on {{date}}',
        'zh': '卸载完成于 {{date}}',
        'ja': 'アンインストールが完了しました {{date}}',
        'ko': '제거 완료 {{date}}'
      },
      'enable_completed': {
        'en': 'Enabled on {{date}}',
        'zh': '启用完成于 {{date}}',
        'ja': '有効化しました {{date}}',
        'ko': '활성화 완료 {{date}}'
      },
      'disable_completed': {
        'en': 'Disabled on {{date}}',
        'zh': '禁用完成于 {{date}}',
        'ja': '無効化しました {{date}}',
        'ko': '비활성화 완료 {{date}}'
      },
      'operation_failed': {
        'en': 'Operation failed: {{message}}',
        'zh': '操作失败: {{message}}',
        'ja': '操作に失敗しました: {{message}}',
        'ko': '작업 실패: {{message}}'
      }
    };
    
    // 提取日期时间或错误消息
    let type = '';
    let params: Record<string, string> = {};
    
    if (result.includes('安装完成于')) {
      type = 'install_completed';
      const dateMatch = result.match(/安装完成于\s+(.*)/);
      params.date = dateMatch ? dateMatch[1] : '';
    } else if (result.includes('卸载完成于')) {
      type = 'uninstall_completed';
      const dateMatch = result.match(/卸载完成于\s+(.*)/);
      params.date = dateMatch ? dateMatch[1] : '';
    } else if (result.includes('启用完成于')) {
      type = 'enable_completed';
      const dateMatch = result.match(/启用完成于\s+(.*)/);
      params.date = dateMatch ? dateMatch[1] : '';
    } else if (result.includes('禁用完成于')) {
      type = 'disable_completed';
      const dateMatch = result.match(/禁用完成于\s+(.*)/);
      params.date = dateMatch ? dateMatch[1] : '';
    } else if (result.includes('失败') || result.includes('错误')) {
      type = 'operation_failed';
      params.message = result;
    } else {
      // 无法匹配已知模式，返回原始结果
      return result;
    }
    
    // 如果有对应语言的直接翻译，使用它
    if (translations[type] && translations[type][locale]) {
      let translatedText = translations[type][locale];
      
      // 替换参数
      Object.keys(params).forEach(key => {
        translatedText = translatedText.replace(`{{${key}}}`, params[key]);
      });
      
      return translatedText;
    }
    
    // 尝试使用i18n
    try {
      return i18nLogger.translate(`plugins.result.${type}`, { 
        lng: locale, 
        ...params 
      });
    } catch (error) {
      // 如果无法翻译，返回英文备用
      if (translations[type] && translations[type]['en']) {
        let translatedText = translations[type]['en'];
        
        // 替换参数
        Object.keys(params).forEach(key => {
          translatedText = translatedText.replace(`{{${key}}}`, params[key]);
        });
        
        return translatedText;
      }
      
      // 最后的后备，返回原始结果
      return result;
    }
  }

  // 添加日志翻译方法
  private translateLogs(logs: string[], locale: string): string[] {
    // 如果是中文，不需要翻译
    if (locale === 'zh') {
      return logs;
    }
    
    // 英文翻译映射
    const zhToEnMap: Record<string, string> = {
      '开始安装插件': 'Started installing plugin',
      '正在查找插件信息': 'Looking for plugin information',
      '找到插件': 'Found plugin',
      '准备安装': 'Preparing installation',
      '正在下载插件': 'Downloading plugin',
      '执行': 'Executing',
      'Git错误': 'Git error',
      '开发环境：跳过依赖安装': 'Development environment: skipping dependency installation',
      '安装完成于': 'Installation completed on',
      '开始卸载插件': 'Started uninstalling plugin',
      '准备卸载': 'Preparing uninstallation',
      '发现插件在禁用目录中': 'Plugin found in disabled directory',
      '正在卸载禁用状态的插件': 'Uninstalling disabled plugin',
      '已删除插件目录': 'Plugin directory deleted',
      '清理临时文件': 'Cleaning temporary files',
      '卸载完成于': 'Uninstallation completed on',
      '正在卸载插件': 'Uninstalling plugin',
      '已将插件目录备份到': 'Plugin directory backed up to',
      '备份目录已保留': 'Backup directory preserved',
      '插件目录不存在': 'Plugin directory does not exist',
      '卸载失败': 'Uninstallation failed',
      '开始禁用插件': 'Started disabling plugin',
      '准备禁用': 'Preparing to disable',
      '正在移动插件到禁用目录': 'Moving plugin to disabled directory',
      '禁用完成于': 'Disabling completed on',
      // 添加更多翻译
      '缓存为空或已过期，获取最新插件数据': 'Cache is empty or expired, fetching latest plugin data',
      '在缓存中未找到插件': 'Plugin not found in cache, trying to fetch from source',
      '尝试从源获取': 'Trying to fetch from source',
      '未找到插件': 'Plugin not found',
      '检测到已有安装，正在备份': 'Detected existing installation, creating backup',
      '尝试备用方式下载': 'Trying alternative download method',
      '备用方式也失败': 'Alternative method also failed',
      '正在安装依赖': 'Installing dependencies',
      '检查依赖': 'Checking dependencies',
      '检查依赖文件': 'Checking dependency files',
      '发现requirements.txt': 'Found requirements.txt',
      '依赖安装输出': 'Dependency installation output',
      '依赖安装警告': 'Dependency installation warning',
      '依赖安装失败，但继续安装流程': 'Dependency installation failed, but continuing installation',
      '未找到requirements.txt文件': 'requirements.txt file not found',
      '执行安装脚本': 'Executing installation script',
      '发现install.py': 'Found install.py',
      '安装脚本输出': 'Installation script output',
      '安装脚本警告': 'Installation script warning',
      '安装脚本执行失败，但继续安装流程': 'Installation script execution failed, but continuing installation',
      '未找到install.py脚本': 'install.py script not found',
      '安装失败': 'Installation failed',
      '已删除失败的安装目录': 'Failed installation directory deleted',
      '清理失败的安装目录失败': 'Failed to clean up installation directory',
      '开始启用插件': 'Started enabling plugin',
      '准备启用': 'Preparing to enable',
      '禁用的插件目录不存在': 'Disabled plugin directory does not exist',
      '删除已存在的启用版本': 'Deleting existing enabled version',
      '正在移动插件到启用目录': 'Moving plugin to enabled directory',
      '启用完成于': 'Enabling completed on',
      '启用失败': 'Enabling failed',
      '删除已存在的禁用版本': 'Deleting existing disabled version',
      '插件安装完成于': 'Plugin installation completed on',
      '开始从资源包安装插件': 'Started installing plugin from resource package',
      '开始从自定义URL安装插件': 'Started installing plugin from custom URL',
      '从GitHub安装完成': 'Installation from GitHub completed',
      '创建目录': 'Creating directory',
      '下载文件': 'Downloading file',
      '文件已保存到': 'File saved to',
      '不支持的安装类型': 'Unsupported installation type',
      'Git输出': 'Git output',
      '尝试备用方式': 'Trying alternative method',
      'git克隆失败': 'Git clone failed',
      '正在准备': 'Preparing',
      '正在创建备份': 'Creating backup',
      '正在检查环境': 'Checking environment',
      '创建禁用插件目录': 'Creating disabled plugins directory',
      '无法读取git信息': 'Cannot read git information'
    };
    
    // 翻译每一行日志
    return logs.map(log => {
      // 时间戳处理
      const timestampMatch = log.match(/\[(.*?)\]/);
      let translatedLog = log;
      
      if (timestampMatch) {
        const timestamp = timestampMatch[1];
        const content = log.replace(/\[.*?\]\s*/, '');
        
        // 尝试替换已知中文短语
        let translatedContent = content;
        Object.keys(zhToEnMap).forEach(zhText => {
          if (content.includes(zhText)) {
            translatedContent = translatedContent.replace(
              zhText, 
              zhToEnMap[zhText]
            );
          }
        });
        
        translatedLog = `[${timestamp}] ${translatedContent}`;
      }
      
      return translatedLog;
    });
  }

  // 获取历史记录数组（供外部访问）
  public getHistory(): PluginOperationHistory[] {
    return this.operationHistory;
  }

  // 设置历史记录数组（供外部更新）
  public setHistory(history: PluginOperationHistory[]): void {
    this.operationHistory = history;
    this.saveHistory();
  }
}
