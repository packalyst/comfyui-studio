import { Context } from 'koa';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { PluginHistoryManager } from './history';
import { PluginInstallManager } from './install';
import { PluginUninstallManager } from './uninstall';
import { PluginCacheManager } from './cache';
import { TaskProgressManager } from './progress';
import { PluginInfoManager } from './info';

export class PluginsController {
  private historyManager: PluginHistoryManager;
  private installManager: PluginInstallManager;
  private uninstallManager: PluginUninstallManager;
  private cacheManager: PluginCacheManager;
  private progressManager: TaskProgressManager;
  private infoManager: PluginInfoManager;

  constructor() {
    // 初始化各个管理器
    this.historyManager = new PluginHistoryManager();
    this.cacheManager = new PluginCacheManager();
    this.progressManager = new TaskProgressManager();
    this.infoManager = new PluginInfoManager();
    this.installManager = new PluginInstallManager(this.historyManager, this.progressManager, this.cacheManager);
    this.uninstallManager = new PluginUninstallManager(this.historyManager, this.progressManager, this.cacheManager);
  }

  // 获取所有插件
  async getAllPlugins(ctx: Context): Promise<void> {
    try {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.info('plugin.api.get_all_plugins', { lng: lang });
      
      const forceRefresh = ctx.query.force === 'true';
      // 若前端声明强制刷新，先刷新本地已安装信息，确保版本覆盖后再响应
      if (forceRefresh) {
        try {
          await this.cacheManager.refreshInstalledPlugins();
        } catch (e) {
          i18nLogger.warn('plugin.api.force_refresh_failed', { message: e instanceof Error ? e.message : String(e), lng: lang });
        }
      }
      const pluginsData = await this.cacheManager.getAllPlugins(forceRefresh);
      
      ctx.body = pluginsData;
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.get_all_plugins_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = { error: '获取插件列表失败' };
    }
  }

  // 安装插件
  async installPlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.request.body as { pluginId: string };
    const { githubProxy: clientProvidedProxy } = ctx.request.body as { githubProxy: string };
    
    try {
      // 从缓存中获取插件信息
      const pluginsData = await this.cacheManager.getAllPlugins(false);
      const pluginInfo = pluginsData.find(p => p.id === pluginId);
      
      if (!pluginInfo) {
        ctx.status = 404;
        ctx.body = {
          success: false,
          message: `未找到插件: ${pluginId}`
        };
        return;
      }
      
      const taskId = await this.installManager.installPlugin(ctx, pluginId, clientProvidedProxy, pluginInfo);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'install', clientProvidedProxy);
      
      ctx.body = {
        success: true,
        message: '开始安装插件',
        taskId
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.install_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `安装失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 卸载插件
  async uninstallPlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.request.body as { pluginId: string };
    
    try {
      const taskId = await this.uninstallManager.uninstallPlugin(ctx, pluginId);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'uninstall');
      
      // 异步刷新插件列表
      this.refreshPluginsAfterUninstall(pluginId);
      
      ctx.body = {
        success: true,
        message: '开始卸载插件',
        taskId
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.uninstall_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `卸载失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 禁用插件
  async disablePlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.request.body as { pluginId: string };
    
    try {
      const taskId = await this.uninstallManager.disablePlugin(ctx, pluginId);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'disable');
      
      ctx.body = {
        success: true,
        message: '开始禁用插件',
        taskId
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.disable_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `禁用失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 启用插件
  async enablePlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.request.body as { pluginId: string };
    
    try {
      const taskId = await this.uninstallManager.enablePlugin(ctx, pluginId);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'enable');
      
      ctx.body = {
        success: true,
        message: '开始启用插件',
        taskId
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.enable_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `启用失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取插件操作进度
  async getPluginProgress(ctx: Context): Promise<void> {
    const { taskId } = ctx.params;
    
    const progress = this.progressManager.getTaskProgress(taskId);
    if (!progress) {
      ctx.status = 404;
      ctx.body = {
        success: false,
        message: '找不到该任务'
      };
      return;
    }
    
    ctx.body = {
      ...progress
    };
  }

  // 获取操作历史记录
  async getOperationHistory(ctx: Context): Promise<void> {
    await this.historyManager.getOperationHistory(ctx);
  }

  // 获取特定操作的详细日志
  async getOperationLogs(ctx: Context): Promise<void> {
    await this.historyManager.getOperationLogs(ctx);
  }

  // 清除历史记录
  async clearOperationHistory(ctx: Context): Promise<void> {
    await this.historyManager.clearOperationHistory(ctx);
  }

  // 刷新已安装插件列表
  async refreshInstalledPlugins(ctx: Context): Promise<void> {
    try {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.info('plugin.api.refresh_installed_plugins', { lng: lang });
      
      const installedPlugins = await this.cacheManager.refreshInstalledPlugins();
      
      ctx.body = {
        success: true,
        message: '已刷新插件列表',
        plugins: installedPlugins
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.refresh_installed_plugins_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `刷新失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 如果其他控制器需要访问这些方法，确保它们是公共的
  public getPluginPath(pluginId: string): string {
    return this.uninstallManager.getPluginPath(pluginId);
  }

  public async getInstalledPluginsForPython(): Promise<any[]> {
    return this.infoManager.getAllInstalledPluginsInfo();
  }

  // 获取插件历史记录 - 添加本地化支持
  public async getPluginHistory(ctx: Context): Promise<void> {
    await this.historyManager.getPluginHistory(ctx);
  }
  
  // 清除插件历史记录
  public async clearPluginHistory(ctx: Context): Promise<void> {
    await this.historyManager.clearPluginHistory(ctx);
  }
  
  // 删除特定的插件历史记录
  public async deletePluginHistoryItem(ctx: Context): Promise<void> {
    await this.historyManager.deletePluginHistoryItem(ctx);
  }

  // 添加一个新的公共方法，用于从其他控制器直接调用安装插件
  public async installPluginFromGitHub(
    githubUrl: string, 
    branch: string = 'main',
    progressCallback: (progress: any) => boolean,
    operationId: string
  ): Promise<void> {
    await this.installManager.installPluginFromGitHub(githubUrl, branch, progressCallback, operationId);
  }

  // 添加一个新的API端点，用于自定义插件安装
  async installCustomPlugin(ctx: Context): Promise<void> {
    // 从请求体中获取参数
    const { githubUrl, branch = 'main' } = ctx.request.body as { 
      githubUrl: string, 
      branch?: string 
    };
    
    // 验证参数
    if (!githubUrl) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        message: 'GitHub URL 是必需的'
      };
      return;
    }
    
    try {
      const taskId = await this.installManager.installCustomPlugin(ctx, githubUrl, branch);
      
      // Extract plugin ID from GitHub URL for response
      const githubUrlParts = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      const pluginId = githubUrlParts ? githubUrlParts[2].replace(/\.git$/, '') : taskId;
      
      // Note: progressManager.createTask is already called in installManager.installCustomPlugin
      
      ctx.body = {
        success: true,
        message: '开始安装自定义插件',
        taskId,
        pluginId
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.custom_install_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `安装失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取任务统计信息
  async getTaskStats(ctx: Context): Promise<void> {
    try {
      const stats = this.progressManager.getTaskStats();
      ctx.body = {
        success: true,
        stats
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.get_task_stats_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `获取统计失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 清理已完成的任务
  async cleanupCompletedTasks(ctx: Context): Promise<void> {
    try {
      this.progressManager.cleanupCompletedTasks();
      ctx.body = {
        success: true,
        message: '已清理已完成的任务'
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.cleanup_tasks_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `清理失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取缓存状态
  async getCacheStatus(ctx: Context): Promise<void> {
    try {
      const status = this.cacheManager.getCacheStatus();
      ctx.body = {
        success: true,
        status
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.get_cache_status_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `获取状态失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 清空缓存
  async clearCache(ctx: Context): Promise<void> {
    try {
      this.cacheManager.clearCache();
      ctx.body = {
        success: true,
        message: '缓存已清空'
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.clear_cache_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `清空失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 验证插件
  async validatePlugin(ctx: Context): Promise<void> {
    const { pluginId } = ctx.params;
    
    try {
      const pluginPath = this.getPluginPath(pluginId);
      const validation = this.infoManager.validatePlugin(pluginPath);
      
      ctx.body = {
        success: true,
        pluginId,
        validation
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.validate_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `验证失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 获取插件依赖关系
  async getPluginDependencies(ctx: Context): Promise<void> {
    const { pluginId } = ctx.params;
    
    try {
      const pluginPath = this.getPluginPath(pluginId);
      const dependencies = this.infoManager.getPluginDependencies(pluginPath);
      
      ctx.body = {
        success: true,
        pluginId,
        dependencies
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.get_dependencies_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `获取依赖失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 切换插件版本
  async switchPluginVersion(ctx: Context): Promise<void> {
    const { pluginId, targetVersion } = ctx.request.body as { 
      pluginId: string; 
      targetVersion: any;
    };
    const { githubProxy: clientProvidedProxy } = ctx.request.body as { githubProxy: string };
    
    try {
      // 验证参数
      if (!pluginId || !targetVersion) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          message: '插件ID和目标版本是必需的'
        };
        return;
      }
      
      // 从缓存中获取插件信息
      const pluginsData = await this.cacheManager.getAllPlugins(false);
      const pluginInfo = pluginsData.find(p => p.id === pluginId);
      
      if (!pluginInfo) {
        ctx.status = 404;
        ctx.body = {
          success: false,
          message: `未找到插件: ${pluginId}`
        };
        return;
      }
      
      // 验证目标版本是否存在
      const availableVersions = pluginInfo.versions || [];
      const latestVersion = pluginInfo.latest_version;
      
      // 检查目标版本是否在可用版本中
      const versionExists = availableVersions.some((v: any) => v.id === targetVersion.id) || 
                           (latestVersion && latestVersion.id === targetVersion.id);
      
      if (!versionExists) {
        ctx.status = 400;
        ctx.body = {
          success: false,
          message: '目标版本不存在或不可用'
        };
        return;
      }
      
      const taskId = await this.installManager.switchPluginVersion(ctx, pluginId, targetVersion, clientProvidedProxy);
      
      // 创建进度任务
      this.progressManager.createTask(taskId, pluginId, 'switch-version', clientProvidedProxy);
      
      ctx.body = {
        success: true,
        message: `开始切换到版本 ${targetVersion.version}`,
        taskId
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.switch_version_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `版本切换失败: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  // 卸载后刷新插件列表
  private async refreshPluginsAfterUninstall(pluginId: string): Promise<void> {
    try {
      // 等待一段时间确保卸载完成
      setTimeout(async () => {
        try {
          const logLang = i18nLogger.getLocale();
          i18nLogger.info('plugin.api.refresh_after_uninstall', { pluginId, lng: logLang });
          await this.cacheManager.refreshInstalledPlugins();
          i18nLogger.info('plugin.api.refresh_completed', { lng: logLang });
        } catch (error) {
          const logLang = i18nLogger.getLocale();
          i18nLogger.error('plugin.api.refresh_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
        }
      }, 2000); // 等待2秒
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.api.schedule_refresh_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }

  // 手动更新 all_nodes.mirrored.json
  async updateAllNodesCache(ctx: Context): Promise<void> {
    try {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.info('plugin.api.update_all_nodes_requested', { lng: lang });
      
      const result = await this.cacheManager.manualUpdateAllNodesCache();
      
      if (result.success) {
        ctx.body = {
          success: true,
          message: result.message,
          nodesCount: result.nodesCount
        };
      } else {
        ctx.status = 500;
        ctx.body = {
          success: false,
          message: result.message
        };
      }
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('plugin.api.update_all_nodes_failed', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        success: false,
        message: `Update failed: ${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

} 