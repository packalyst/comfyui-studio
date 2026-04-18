import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { PluginHistoryManager } from './history';
import { PluginCacheManager } from './cache';

// 确定环境和路径
const isDev = process.env.NODE_ENV !== 'production';

// 在开发环境中使用当前目录，生产环境使用配置路径
const COMFYUI_PATH = process.env.COMFYUI_PATH || 
  (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');

const CUSTOM_NODES_PATH = path.join(COMFYUI_PATH, 'custom_nodes');

// 确保有一个 .disabled 目录用于存放禁用的插件
const DISABLED_PLUGINS_PATH = path.join(CUSTOM_NODES_PATH, '.disabled');

export class PluginUninstallManager {
  private historyManager: PluginHistoryManager;
  private progressManager?: any; // 进度管理器实例
  private cacheManager?: PluginCacheManager; // 缓存管理器实例

  constructor(historyManager: PluginHistoryManager, progressManager?: any, cacheManager?: PluginCacheManager) {
    this.historyManager = historyManager;
    this.progressManager = progressManager;
    this.cacheManager = cacheManager;
  }

  // 卸载插件
  async uninstallPlugin(ctx: any, pluginId: string): Promise<string> {
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('plugin.uninstall.request', { pluginId, lng: logLang });
    
    const taskId = uuidv4();
    
    // 添加到历史记录
    this.historyManager.addHistoryItem(taskId, pluginId, 'uninstall');
    
    // 实际卸载插件任务
    this.uninstallPluginTask(taskId, pluginId);
    
    return taskId;
  }

  // 实际卸载插件任务
  private async uninstallPluginTask(taskId: string, pluginId: string): Promise<void> {
    try {
      this.logOperation(taskId, '准备卸载...');
      
      // 确定插件路径 - 检查常规目录和禁用目录
      const pluginPath = path.join(CUSTOM_NODES_PATH, pluginId);
      const disabledPluginPath = path.join(DISABLED_PLUGINS_PATH, pluginId);
      
      // 先检查常规目录，再检查禁用目录
      let targetPath = pluginPath;
      let isDisabled = false;
      
      if (!fs.existsSync(pluginPath)) {
        if (!fs.existsSync(disabledPluginPath)) {
          this.logOperation(taskId, `插件目录不存在: ${pluginPath} 和 ${disabledPluginPath}`);
          throw new Error(`插件目录不存在: 既不在启用目录也不在禁用目录`);
        } else {
          // 插件在禁用目录中
          targetPath = disabledPluginPath;
          isDisabled = true;
          this.logOperation(taskId, `发现插件在禁用目录中: ${disabledPluginPath}`);
        }
      }
      
      this.logOperation(taskId, `正在卸载${isDisabled ? '禁用状态的' : ''}插件...`);
      
      // 删除插件目录
      await fs.promises.rm(targetPath, { recursive: true, force: true });
      this.logOperation(taskId, `已删除插件目录: ${targetPath}`);
      
      this.logOperation(taskId, '清理临时文件...');
      
      // 完成卸载
      const now = new Date();
      const successMessage = `卸载完成于 ${now.toLocaleString()}`;
      this.logOperation(taskId, successMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'success',
        result: successMessage
      });
      
      // 更新进度管理器 - 标记任务完成
      const logLang = i18nLogger.getLocale();
      if (this.progressManager) {
        this.progressManager.completeTask(taskId, true, successMessage);
        i18nLogger.info('plugin.uninstall.success', { taskId, lng: logLang });
      }
      
      // 清除插件缓存，确保下次获取时重新计算安装状态
      if (this.cacheManager) {
        await this.cacheManager.clearPluginCache(pluginId);
        i18nLogger.info('plugin.uninstall.cache_cleared', { pluginId, lng: logLang });
        try {
          await this.cacheManager.refreshInstalledPlugins();
          i18nLogger.info('plugin.uninstall.refresh_after_uninstall', { pluginId, lng: logLang });
        } catch (e) {
          i18nLogger.error('plugin.uninstall.refresh_failed', { message: e instanceof Error ? e.message : String(e), lng: logLang });
        }
      }
      
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.uninstall.failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      const errorMessage = `卸载失败: ${error instanceof Error ? error.message : '未知错误'}`;
      this.logOperation(taskId, errorMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'failed',
        result: errorMessage
      });
      
      // 更新进度管理器 - 标记任务失败
      if (this.progressManager) {
        this.progressManager.completeTask(taskId, false, errorMessage);
        i18nLogger.info('plugin.uninstall.failed_task', { taskId, lng: logLang });
      }
    }
  }

  // 禁用插件
  async disablePlugin(ctx: any, pluginId: string): Promise<string> {
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('plugin.disable.request', { pluginId, lng: logLang });
    
    const taskId = uuidv4();
    
    // 添加到历史记录
    this.historyManager.addHistoryItem(taskId, pluginId, 'disable');
    
    // 实际禁用插件任务
    this.disablePluginTask(taskId, pluginId);
    
    return taskId;
  }

  // 实际禁用插件任务
  private async disablePluginTask(taskId: string, pluginId: string): Promise<void> {
    try {
      this.logOperation(taskId, '准备禁用...');
      
      // 确定插件路径
      const pluginPath = path.join(CUSTOM_NODES_PATH, pluginId);
      const disabledPath = path.join(DISABLED_PLUGINS_PATH, pluginId);
      
      // 检查目录是否存在
      if (!fs.existsSync(pluginPath)) {
        this.logOperation(taskId, `插件目录不存在: ${pluginPath}`);
        throw new Error(`插件目录不存在: ${pluginPath}`);
      }
      
      // 确保禁用目录存在
      if (!fs.existsSync(DISABLED_PLUGINS_PATH)) {
        fs.mkdirSync(DISABLED_PLUGINS_PATH, { recursive: true });
        this.logOperation(taskId, `创建禁用插件目录: ${DISABLED_PLUGINS_PATH}`);
      }
      
      // 检查禁用目录中是否已存在同名插件
      if (fs.existsSync(disabledPath)) {
        // 如果存在同名禁用插件，先删除它
        this.logOperation(taskId, `删除已存在的禁用版本: ${disabledPath}`);
        await fs.promises.rm(disabledPath, { recursive: true, force: true });
      }
      
      this.logOperation(taskId, `正在移动插件到禁用目录: ${pluginPath} -> ${disabledPath}`);
      
      // 移动插件到禁用目录
      await fs.promises.rename(pluginPath, disabledPath);
      
      // 完成禁用
      const now = new Date();
      const successMessage = `禁用完成于 ${now.toLocaleString()}`;
      this.logOperation(taskId, successMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'success',
        result: successMessage
      });
      
      // 更新进度管理器 - 标记任务完成
      const logLang = i18nLogger.getLocale();
      if (this.progressManager) {
        this.progressManager.completeTask(taskId, true, successMessage);
        i18nLogger.info('plugin.disable.success', { taskId, lng: logLang });
      }
      
      // 清除插件缓存，确保下次获取时重新计算状态
      if (this.cacheManager) {
        await this.cacheManager.clearPluginCache(pluginId);
        i18nLogger.info('plugin.disable.cache_cleared', { pluginId, lng: logLang });
      }
      
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.disable.failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      const errorMessage = `禁用失败: ${error instanceof Error ? error.message : '未知错误'}`;
      this.logOperation(taskId, errorMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'failed',
        result: errorMessage
      });
    }
  }

  // 启用插件
  async enablePlugin(ctx: any, pluginId: string): Promise<string> {
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('plugin.enable.request', { pluginId, lng: logLang });
    
    const taskId = uuidv4();
    
    // 添加到历史记录
    this.historyManager.addHistoryItem(taskId, pluginId, 'enable');
    
    // 实际启用插件任务
    this.enablePluginTask(taskId, pluginId);
    
    return taskId;
  }

  // 实际启用插件任务
  private async enablePluginTask(taskId: string, pluginId: string): Promise<void> {
    try {
      this.logOperation(taskId, '准备启用...');
      
      // 确定插件路径
      const disabledPath = path.join(DISABLED_PLUGINS_PATH, pluginId);
      const enabledPath = path.join(CUSTOM_NODES_PATH, pluginId);
      
      // 检查禁用目录是否存在
      if (!fs.existsSync(disabledPath)) {
        this.logOperation(taskId, `禁用的插件目录不存在: ${disabledPath}`);
        throw new Error(`禁用的插件目录不存在: ${disabledPath}`);
      }
      
      // 检查启用目录中是否已存在同名插件
      if (fs.existsSync(enabledPath)) {
        // 如果存在同名已启用插件，先删除它
        this.logOperation(taskId, `删除已存在的启用版本: ${enabledPath}`);
        await fs.promises.rm(enabledPath, { recursive: true, force: true });
      }
      
      this.logOperation(taskId, `正在移动插件到启用目录: ${disabledPath} -> ${enabledPath}`);
      
      // 移动插件到启用目录
      await fs.promises.rename(disabledPath, enabledPath);
      
      // 完成启用
      const now = new Date();
      const successMessage = `启用完成于 ${now.toLocaleString()}`;
      this.logOperation(taskId, successMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'success',
        result: successMessage
      });
      
      // 更新进度管理器 - 标记任务完成
      const logLang = i18nLogger.getLocale();
      if (this.progressManager) {
        this.progressManager.completeTask(taskId, true, successMessage);
        i18nLogger.info('plugin.enable.success', { taskId, lng: logLang });
      }
      
      // 清除插件缓存，确保下次获取时重新计算状态
      if (this.cacheManager) {
        await this.cacheManager.clearPluginCache(pluginId);
        i18nLogger.info('plugin.enable.cache_cleared', { pluginId, lng: logLang });
      }
      
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.enable.failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      const errorMessage = `启用失败: ${error instanceof Error ? error.message : '未知错误'}`;
      this.logOperation(taskId, errorMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'failed',
        result: errorMessage
      });
    }
  }

  // 记录操作日志
  private logOperation(taskId: string, message: string): void {
    // 获取当前时间
    const timestamp = new Date().toLocaleString();
    const logMessage = `[${timestamp}] ${message}`;
    
    // 添加到历史记录
    const historyItem = this.historyManager.getHistory().find(item => item.id === taskId);
    if (historyItem) {
      historyItem.logs.push(logMessage);
      // 更新历史记录
      this.historyManager.setHistory([...this.historyManager.getHistory()]);
    }
    
    // 操作日志已通过 logOperation 记录，这里不再重复记录
  }

  // 如果其他控制器需要访问这些方法，确保它们是公共的
  public getPluginPath(pluginId: string): string {
    // 首先检查常规目录
    const regularPath = path.join(CUSTOM_NODES_PATH, pluginId);
    if (fs.existsSync(regularPath)) {
      return regularPath;
    }
    
    // 然后检查禁用目录
    const disabledPath = path.join(DISABLED_PLUGINS_PATH, pluginId);
    if (fs.existsSync(disabledPath)) {
      return disabledPath;
    }
    
    // 如果都找不到，返回常规路径（可能用于新安装）
    return regularPath;
  }
}
