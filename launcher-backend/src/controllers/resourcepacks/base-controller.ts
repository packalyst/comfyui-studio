/**
 * 资源包基础控制器
 * 包含资源包管理的核心逻辑和公共方法
 */
import * as Koa from 'koa';
import * as path from 'path';
import * as fs from 'fs';
import { DownloadController } from '../download/download.controller';
import { 
  ResourcePack, 
  ResourceType, 
  InstallStatus, 
  ModelResource, 
  PluginResource, 
  WorkflowResource, 
  CustomResource 
} from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { ProgressManager } from './progress-manager';
import { ModelInstaller } from './model-installer';
import { PluginInstaller } from './plugin-installer';
import { WorkflowInstaller } from './workflow-installer';
import { CustomInstaller } from './custom-installer';
import { resolveModelFilePath } from '../../utils/shared-model-hub';

export class BaseResourcePacksController extends DownloadController {
  protected resourcePacks: ResourcePack[] = [];
  protected progressManager: ProgressManager;
  protected modelInstaller: ModelInstaller;
  protected pluginInstaller: PluginInstaller;
  protected workflowInstaller: WorkflowInstaller;
  protected customInstaller: CustomInstaller;
  protected comfyuiPath: string;
  
  // 存储每个任务的 AbortController，用于取消下载
  protected taskAbortControllers = new Map<string, AbortController>();

  constructor() {
    super();
    
    // 获取ComfyUI路径
    const { config } = require('../../config');
    this.comfyuiPath = config.comfyui.path || process.env.COMFYUI_PATH || path.join(process.cwd(), 'comfyui');
    
    // 初始化各个安装器和进度管理器
    this.progressManager = new ProgressManager();
    this.modelInstaller = new ModelInstaller(this.comfyuiPath);
    this.pluginInstaller = new PluginInstaller(this.comfyuiPath);
    this.workflowInstaller = new WorkflowInstaller(this.comfyuiPath);
    this.customInstaller = new CustomInstaller(this.comfyuiPath);
    
    // 加载资源包
    this.loadResourcePacks();
  }

  /**
   * 加载资源包列表
   */
  protected loadResourcePacks(): void {
    try {
      // 从标准路径加载资源包定义
      const packDefinitionsPath = path.join(__dirname, '../../../resource-packs');
      
      const logLang = i18nLogger.getLocale();
      // 确保目录存在
      if (!fs.existsSync(packDefinitionsPath)) {
        fs.mkdirSync(packDefinitionsPath, { recursive: true });
        i18nLogger.info('resourcepack.base.create_dir', { path: packDefinitionsPath, lng: logLang });
      }
      
      // 读取目录下所有JSON文件
      const files = fs.readdirSync(packDefinitionsPath).filter(file => file.endsWith('.json'));
      
      for (const file of files) {
        try {
          const filePath = path.join(packDefinitionsPath, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const pack = JSON.parse(content) as ResourcePack;
          
          // 验证资源包格式
          if (this.validateResourcePack(pack)) {
            this.resourcePacks.push(pack);
            i18nLogger.info('resourcepack.base.loaded', { name: pack.name, lng: logLang });
          } else {
            i18nLogger.warn('resourcepack.base.invalid_format', { path: filePath, lng: logLang });
          }
        } catch (error) {
          i18nLogger.error('resourcepack.base.parse_failed', { file, message: error instanceof Error ? error.message : String(error), lng: logLang });
        }
      }
      
      i18nLogger.info('resourcepack.base.loaded_count', { count: this.resourcePacks.length, lng: logLang });
    } catch (error) {
      i18nLogger.error('resourcepack.base.load_failed', { message: error instanceof Error ? error.message : String(error), lng: i18nLogger.getLocale() });
    }
  }

  /**
   * 验证资源包格式
   */
  protected validateResourcePack(pack: any): boolean {
    // 基本属性验证
    if (!pack.id || !pack.name || !Array.isArray(pack.resources)) {
      return false;
    }
    
    // 资源验证
    for (const resource of pack.resources) {
      if (!resource.id || !resource.name || !resource.type) {
        return false;
      }
      
      // 根据类型验证特定属性
      switch (resource.type) {
        case ResourceType.MODEL:
          if ((!resource.url || !resource.dir || !resource.out)) {
            return false;
          }
          break;
        case ResourceType.PLUGIN:
          if (!resource.github) {
            return false;
          }
          break;
        case ResourceType.WORKFLOW:
          if (!resource.url || !resource.filename) {
            return false;
          }
          break;
        case ResourceType.CUSTOM:
          if (!resource.url || !resource.destination) {
            return false;
          }
          break;
        default:
          return false;
      }
    }
    
    return true;
  }

  /**
   * 获取资源包列表
   */
  public async getResourcePacks(ctx: Koa.Context): Promise<void> {
    ctx.body = this.resourcePacks;
  }

  /**
   * 获取资源包详情
   */
  public async getResourcePackDetail(ctx: Koa.Context): Promise<void> {
    const { id } = ctx.params;
    
    const pack = this.resourcePacks.find(p => p.id === id);
    if (!pack) {
      ctx.status = 404;
      ctx.body = { error: `资源包 ${id} 不存在` };
      return;
    }

    // 在返回前尽可能为资源补充 size：先本地文件大小，其次尝试远程HEAD
    try {
      const withLocal = this.augmentPackWithLocalSizes(pack);
      const augmented = await this.augmentPackWithRemoteSizes(withLocal);
      ctx.body = augmented;
    } catch (e) {
      ctx.body = pack;
    }
  }

  /**
   * 开始资源包安装
   */
  protected async startResourcePackInstallation(
    pack: ResourcePack, 
    taskId: string, 
    source: string = 'hf',
    selectedResources?: string[]
  ): Promise<void> {
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('resourcepack.base.start_install', { name: pack.name, taskId, lng: logLang });
    
    // 获取进度对象
    const progress = this.progressManager.getProgress(taskId);
    if (!progress) {
      throw new Error(`未找到任务 ${taskId} 的进度信息`);
    }
    
    // 为任务创建 AbortController
    const abortController = new AbortController();
    this.taskAbortControllers.set(taskId, abortController);
    
    // 更新状态为下载中
    this.progressManager.updateTaskStatus(taskId, InstallStatus.DOWNLOADING);
    
    // 过滤要安装的资源
    const resourcesToInstall = selectedResources 
      ? pack.resources.filter(r => selectedResources.includes(r.id))
      : pack.resources;
    
    try {
      // 依次安装每个资源
      for (let i = 0; i < resourcesToInstall.length; i++) {
        // 检查是否已取消
        if (this.progressManager.isTaskCanceled(taskId) || abortController.signal.aborted) {
          i18nLogger.info('resourcepack.base.install_canceled', { name: pack.name, lng: logLang });
          this.progressManager.updateTaskStatus(taskId, InstallStatus.CANCELED);
          return;
        }
        
        const resource = resourcesToInstall[i];
        
        // 更新当前资源状态（若已有进度则不清零，保持已有百分比直至 onProgress 覆盖）
        try {
          const existing = this.progressManager.getProgress(taskId);
          const keep = existing?.resourceStatuses.find(rs => rs.resourceId === resource.id)?.progress;
          const initial = typeof keep === 'number' && keep > 0 ? keep : 0;
          this.progressManager.updateResourceStatus(
            taskId, 
            resource.id, 
            InstallStatus.DOWNLOADING, 
            initial
          );
        } catch (_) {
          this.progressManager.updateResourceStatus(
            taskId, 
            resource.id, 
            InstallStatus.DOWNLOADING, 
            0
          );
        }
        
        try {
          i18nLogger.info('resourcepack.base.start_resource_install', { name: resource.name, current: i + 1, total: resourcesToInstall.length, lng: logLang });

          // 创建进度回调函数
          const onProgress = (status: InstallStatus, progress: number, error?: string) => {
            this.progressManager.updateResourceStatus(taskId, resource.id, status, progress, error);
          };

          // 读取重试配置
          // comment: keep config import lazy to avoid circular deps at top level
          const { config } = require('../../config');
          const maxAttempts: number = Number(config?.retry?.maxAttempts ?? 2);
          const baseDelayMs: number = Number(config?.retry?.baseDelayMs ?? 1000);
          const backoffFactor: number = Number(config?.retry?.backoffFactor ?? 2);
          const maxDelayMs: number = Number(config?.retry?.maxDelayMs ?? 15000);

          let attempt = 0;
          // 首次尝试 + 重试次数
          const totalAttempts = Math.max(1, 1 + (Number.isFinite(maxAttempts) ? maxAttempts : 0));
          let lastError: any = undefined;

          while (attempt < totalAttempts) {
            // 取消检查
            if (abortController.signal.aborted || this.progressManager.isTaskCanceled(taskId)) {
              i18nLogger.info('resourcepack.base.resource_install_canceled', { name: resource.name, lng: logLang });
              // 保留已记录的进度
              try {
                const existing = this.progressManager.getProgress(taskId);
                const keep = existing?.resourceStatuses.find(rs => rs.resourceId === resource.id)?.progress ?? 0;
                this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, keep);
              } catch (_) {
                this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, 0);
              }
              return;
            }

            try {
              // 根据资源类型执行不同的安装逻辑，传递 AbortController
              switch (resource.type) {
                case ResourceType.MODEL:
                  await this.modelInstaller.installModelResource(
                    resource as ModelResource,
                    taskId,
                    source,
                    onProgress,
                    abortController
                  );
                  break;

                case ResourceType.PLUGIN:
                  await this.pluginInstaller.installPluginResource(
                    resource as PluginResource,
                    taskId,
                    onProgress,
                    abortController
                  );
                  break;

                case ResourceType.WORKFLOW:
                  await this.workflowInstaller.installWorkflowResource(
                    resource as WorkflowResource,
                    taskId,
                    onProgress,
                    abortController
                  );
                  break;

                case ResourceType.CUSTOM:
                  await this.customInstaller.installCustomResource(
                    resource as CustomResource,
                    taskId,
                    onProgress,
                    abortController
                  );
                  break;
              }
              // 成功则跳出重试循环
              lastError = undefined;
              break;
            } catch (err) {
              // 若为取消错误，直接退出
              if (abortController.signal.aborted || this.progressManager.isTaskCanceled(taskId)) {
                i18nLogger.info('resourcepack.base.resource_install_canceled', { name: resource.name, lng: logLang });
                // 保留已记录的进度
                try {
                  const existing = this.progressManager.getProgress(taskId);
                  const keep = existing?.resourceStatuses.find(rs => rs.resourceId === resource.id)?.progress ?? 0;
                  this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, keep);
                } catch (_) {
                  this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, 0);
                }
                return;
              }

              lastError = err;
              attempt++;

              // 若还有机会，退避等待后重试
              if (attempt < totalAttempts) {
                const delay = Math.min(
                  Math.floor(baseDelayMs * Math.pow(backoffFactor, attempt - 0)),
                  maxDelayMs
                );
                i18nLogger.warn('resourcepack.base.retry_install', { attempt, total: totalAttempts - 1, name: resource.name, delay, lng: logLang });
                await new Promise(res => setTimeout(res, delay));
                continue;
              }

              // 无更多重试机会，抛出以进入外层catch
              throw err;
            }
          }

        } catch (error) {
          // 检查是否是取消导致的错误
          if (abortController.signal.aborted || this.progressManager.isTaskCanceled(taskId)) {
            i18nLogger.info('resourcepack.base.resource_install_canceled', { name: resource.name, lng: logLang });
            // 保留已记录的进度
            try {
              const existing = this.progressManager.getProgress(taskId);
              const keep = existing?.resourceStatuses.find(rs => rs.resourceId === resource.id)?.progress ?? 0;
              this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, keep);
            } catch (_) {
              this.progressManager.updateResourceStatus(taskId, resource.id, InstallStatus.CANCELED, 0);
            }
            return;
          }
          
          // 记录错误并继续安装其他资源
          const errorMsg = error instanceof Error ? error.message : String(error);
          i18nLogger.error('resourcepack.base.resource_install_failed', { name: resource.name, message: errorMsg, lng: logLang });
          
          this.progressManager.updateResourceStatus(
            taskId, 
            resource.id, 
            InstallStatus.ERROR, 
            0, 
            errorMsg
          );
        }
        
        // 更新总体进度
        this.progressManager.updateOverallProgress(taskId, i, resourcesToInstall.length);
      }
      
      // 完成安装
      this.progressManager.updateTaskStatus(taskId, InstallStatus.COMPLETED);
      
      i18nLogger.info('resourcepack.base.install_completed', { name: pack.name, lng: logLang });
      
    } finally {
      // 清理 AbortController
      this.taskAbortControllers.delete(taskId);
    }
  }

  /**
   * 获取资源包安装进度
   */
  public async getInstallProgress(ctx: Koa.Context): Promise<void> {
    const { taskId } = ctx.params;
    
    let progress = this.progressManager.getProgress(taskId);
    if (!progress) {
      // If no in-memory progress exists, try to bootstrap one by packId
      // comment: allow querying immediately after server start
      const pack = this.resourcePacks.find(p => p.id === taskId);
      if (pack) {
        logger.info(`[ResourcePacks] No in-memory progress for ${taskId}, found pack. Start disk reconciliation.`);
        // Align progress with any partial downloads on disk to fix wrong percent after restart
        try {
          await this.reconcileProgressFromDisk(taskId, pack);
          // refresh progress reference after reconciliation
          progress = this.progressManager.getProgress(taskId);
          if (!progress) {
            logger.warn(`[ResourcePacks] Reconciliation finished but progress still missing. Create progress for ${taskId}.`);
            progress = this.progressManager.createProgress(pack, taskId);
          } else {
            logger.info(`[ResourcePacks] Reconciliation produced progress for ${taskId}.`);
          }
        } catch (_) {
          // ignore reconciliation errors
        }
      }
    }
    
    if (!progress) {
      ctx.status = 404;
      ctx.body = { error: `未找到任务 ${taskId} 的进度信息` };
      return;
    }
    
    ctx.body = progress;
  }

  /**
   * 冷启动对齐：根据磁盘上的现有文件(完整文件或 .download 临时文件)恢复每个资源的进度
   * 仅对模型资源执行（可可靠定位到模型文件路径）
   */
  private async reconcileProgressFromDisk(taskId: string, pack: ResourcePack): Promise<void> {
    try {
      const { config } = require('../../config');
      const modelsRootPath = config.modelsDir || path.join(this.comfyuiPath, 'models');
      logger.info(`[ResourcePacks] Reconcile from disk. modelsRoot=${modelsRootPath}, pack=${pack.id}`);

      // 统计整体进度
      let totalPercent = 0;
      let counted = 0;
      let completedCount = 0;
      let hasActive = false;

      // Ensure a progress scaffold exists to update
      let existing = this.progressManager.getProgress(taskId);
      if (!existing) {
        logger.info(`[ResourcePacks] No progress scaffold for ${taskId}, create one before updates.`);
        existing = this.progressManager.createProgress(pack, taskId);
      }

      for (const r of pack.resources) {
        if (this.isModelResource(r)) {
          try {
            const finalPath = resolveModelFilePath(modelsRootPath, r.dir, r.out);
            const tempPath = `${path.join(modelsRootPath, r.dir, r.out)}.download`;

            const hasFinal = !!finalPath;
            const hasTemp = fs.existsSync(tempPath);

            const resourceSize = typeof (r as any).size === 'number' ? (r as any).size : undefined;

            if (hasFinal) {
              // 已存在最终文件，视为完成
              logger.info(`[ResourcePacks] ${r.id} final exists => COMPLETED`);
              this.progressManager.updateResourceStatus(taskId, r.id, InstallStatus.COMPLETED, 100);
              totalPercent += 100;
              completedCount += 1;
              counted += 1;
              continue;
            }

            if (hasTemp && resourceSize && resourceSize > 0) {
              try {
                const stat = fs.statSync(tempPath);
                const downloaded = Math.max(0, Number(stat.size || 0));
                const percent = Math.max(0, Math.min(100, Math.floor((downloaded / resourceSize) * 100)));
                logger.info(`[ResourcePacks] ${r.id} temp exists ${downloaded}/${resourceSize} => ${percent}%`);
                this.progressManager.updateResourceStatus(taskId, r.id, InstallStatus.DOWNLOADING, percent);
                totalPercent += percent;
                counted += 1;
                if (percent > 0 && percent < 100) hasActive = true;
                continue;
              } catch (_) {
                // ignore per-resource error
                logger.warn(`[ResourcePacks] ${r.id} temp stat failed`);
              }
            }

            // 若存在临时文件但未知资源大小，尝试通过远程HEAD获取大小
            if (hasTemp && (!resourceSize || resourceSize <= 0)) {
              try {
                const url = this.getResourcePrimaryUrl(r as any);
                if (url) {
                  const remoteSize = await this.fetchRemoteContentLength(url);
                  if (typeof remoteSize === 'number' && remoteSize > 0) {
                    const stat = fs.statSync(tempPath);
                    const downloaded = Math.max(0, Number(stat.size || 0));
                    const percent = Math.max(0, Math.min(100, Math.floor((downloaded / remoteSize) * 100)));
                    logger.info(`[ResourcePacks] ${r.id} temp exists ${downloaded}/${remoteSize} (remote) => ${percent}%`);
                    this.progressManager.updateResourceStatus(taskId, r.id, InstallStatus.PENDING, percent);
                    totalPercent += percent;
                    counted += 1;
                    if (percent > 0 && percent < 100) hasActive = true;
                    continue;
                  } else {
                    logger.warn(`[ResourcePacks] ${r.id} remote size unavailable via HEAD`);
                  }
                } else {
                  logger.warn(`[ResourcePacks] ${r.id} missing primary URL for HEAD`);
                }
              } catch (e) {
                logger.warn(`[ResourcePacks] ${r.id} HEAD fetch failed: ${e instanceof Error ? e.message : String(e)}`);
              }
            }

            // 未找到任何已下载痕迹
            logger.info(`[ResourcePacks] ${r.id} no traces => PENDING`);
            this.progressManager.updateResourceStatus(taskId, r.id, InstallStatus.PENDING, 0);
            totalPercent += 0;
            counted += 1;
          } catch (_) {
            // ignore per-resource error
            logger.warn(`[ResourcePacks] ${r && (r as any).id ? (r as any).id : 'unknown'} reconcile error`);
          }
        }
      }

      // 汇总任务状态
      if (counted > 0) {
        const overall = Math.floor(totalPercent / counted);
        logger.info(`[ResourcePacks] task ${taskId} overall approx ${overall}%, completed=${completedCount}/${counted}, active=${hasActive}`);
        // 近似推导总体索引（用于现有overall计算逻辑不变）
        this.progressManager.updateOverallProgress(taskId, Math.max(0, completedCount - 1), counted);
        if (completedCount === counted) {
          this.progressManager.updateTaskStatus(taskId, InstallStatus.COMPLETED);
        // } else if (hasActive) {
        //   this.progressManager.updateTaskStatus(taskId, InstallStatus.DOWNLOADING);
        } else {
          this.progressManager.updateTaskStatus(taskId, InstallStatus.PENDING);
        }
        // 将第一个资源的progress近似映射为overall百分比（由前端以resourceStatuses为准）
        // 注：不单独设置一个overall字段，这里依赖前端读取 resourceStatuses
      }
    } catch (_) {
      // ignore
    }
  }

  // 类型守卫：模型资源
  private isModelResource(resource: any): resource is ModelResource {
    return Boolean(
      resource &&
      resource.type === ResourceType.MODEL &&
      typeof resource.dir === 'string' &&
      typeof resource.out === 'string'
    );
  }

  /**
   * 取消资源包安装
   */
  public async cancelInstallation(ctx: Koa.Context): Promise<void> {
    const { taskId } = ctx.params;
    
    const progress = this.progressManager.getProgress(taskId);
    if (!progress) {
      ctx.status = 404;
      ctx.body = { error: `未找到任务 ${taskId} 的进度信息` };
      return;
    }
    
    // 取消任务
    this.progressManager.cancelTask(taskId);
    
    // 使用基类的取消方法
    await this.cancelDownloadTask(taskId);
    
    ctx.body = { success: true, message: '已取消安装任务' };
  }

  /**
   * 实现取消下载任务方法
   */
  async cancelDownloadTask(taskId: string): Promise<boolean> {
    // 取消任务
    const success = this.progressManager.cancelTask(taskId);
    
    if (success) {
      // 获取并取消对应的 AbortController
      const abortController = this.taskAbortControllers.get(taskId);
      if (abortController) {
        abortController.abort();
        i18nLogger.info('resourcepack.base.abort_controller_interrupted', { taskId, lng: i18nLogger.getLocale() });
      }
      
      // 调用父类的取消下载方法
      await super.cancelDownload({ request: { body: { taskId } } } as Koa.Context);
      i18nLogger.info('resourcepack.base.download_task_canceled', { taskId, lng: i18nLogger.getLocale() });
    }
    
    return success;
  }

  /**
   * 尝试为资源包的资源补充本地文件大小（仅当文件已存在时）
   */
  protected augmentPackWithLocalSizes(pack: ResourcePack): ResourcePack {
    try {
      const { config } = require('../../config');
      const modelsRootPath = config.modelsDir || path.join(this.comfyuiPath, 'models');

      const resourcesWithSize = pack.resources.map((r: any) => {
        // 仅对模型资源尝试补充文件大小
        if (r.type === ResourceType.MODEL && r.dir && r.out) {
          try {
            const absPath = resolveModelFilePath(modelsRootPath, r.dir, r.out);
            if (absPath && fs.existsSync(absPath)) {
              const stats = fs.statSync(absPath);
              if (typeof stats.size === 'number' && stats.size >= 0) {
                return { ...r, size: stats.size };
              }
            }
          } catch (_) {
            // ignore
          }
        }
        return r;
      });

      return { ...pack, resources: resourcesWithSize } as ResourcePack;
    } catch (_) {
      return pack;
    }
  }

  /**
   * 通过远程HEAD请求尝试为缺失size的模型资源补充文件大小
   */
  protected async augmentPackWithRemoteSizes(pack: ResourcePack): Promise<ResourcePack> {
    const resources = await Promise.all(pack.resources.map(async (r: any) => {
      if (r && r.type === ResourceType.MODEL && (r.size == null || Number.isNaN(r.size))) {
        const url = this.getResourcePrimaryUrl(r);
        if (url) {
          try {
            const contentLength = await this.fetchRemoteContentLength(url);
            if (typeof contentLength === 'number' && contentLength > 0) {
              return { ...r, size: contentLength };
            }
          } catch (_) {
            // 忽略失败
          }
        }
      }
      return r;
    }));

    return { ...pack, resources } as ResourcePack;
  }

  /**
   * 选择模型资源的主要下载URL
   */
  private getResourcePrimaryUrl(resource: any): string | undefined {
    if (!resource) return undefined;
    if (typeof resource.url === 'string') return resource.url;
    if (resource.url && typeof resource.url === 'object') {
      // 默认优先使用 hf
      return resource.url.hf || resource.url.mirror;
    }
    return undefined;
  }

  /**
   * 发送HEAD请求获取远程Content-Length
   */
  private fetchRemoteContentLength(url: string, redirectLimit: number = 3, timeoutMs: number = 5000): Promise<number | undefined> {
    return new Promise((resolve) => {
      try {
        const httpModule = url.startsWith('https:') ? require('https') : require('http');
        const controller: AbortController | undefined = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
        const timer = setTimeout(() => {
          try { controller?.abort(); } catch (_) {}
          resolve(undefined);
        }, timeoutMs);

        // 尝试应用HF_ENDPOINT与下载时一致的端点替换
        let requestUrl = url;
        try {
          const { config } = require('../../config');
          const hfEndpoint = process.env.HF_ENDPOINT || (config?.HF_ENDPOINT);
          if (hfEndpoint && requestUrl.includes('huggingface.co')) {
            requestUrl = requestUrl.replace('huggingface.co/', String(hfEndpoint).replace(/^https?:\/\//, ''));
          }
        } catch (_) {}

        const req = httpModule.request(requestUrl, { method: 'HEAD', signal: controller?.signal }, (res: any) => {
          const status = res.statusCode || 0;
          // 处理重定向
          if ([301, 302, 303, 307, 308].includes(status) && redirectLimit > 0 && res.headers && res.headers.location) {
            const location = res.headers.location as string;
            res.resume();
            clearTimeout(timer);
            this.fetchRemoteContentLength(location, redirectLimit - 1, timeoutMs).then(resolve);
            return;
          }
          const lenHeader = res.headers ? (res.headers['content-length'] as string | undefined) : undefined;
          res.resume();
          clearTimeout(timer);
          if (lenHeader) {
            const n = parseInt(lenHeader, 10);
            resolve(Number.isFinite(n) && n > 0 ? n : undefined);
          } else {
            resolve(undefined);
          }
        });

        req.on('error', () => {
          clearTimeout(timer);
          resolve(undefined);
        });
        req.end();
      } catch (_) {
        resolve(undefined);
      }
    });
  }
}
