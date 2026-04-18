/**
 * 资源包管理控制器
 * 用于管理和安装包含多种资源类型的资源包
 */
import * as Koa from 'koa';
import { BaseResourcePacksController } from './base-controller';
import { ResourcePack, InstallStatus } from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';

/**
 * 资源包管理控制器类
 */
export class ResourcePacksController extends BaseResourcePacksController {
  constructor() {
    super();
  }

  
  /**
   * 安装资源包
   */
  public async installResourcePack(ctx: Koa.Context): Promise<void> {
    const { packId } = ctx.request.body as { packId: string };
    const { selectedResources } = ctx.request.body as { selectedResources?: string[] };
    const { source = 'hf' } = ctx.request.body as { source?: string };
    
    // 查找资源包
    const pack = this.resourcePacks.find(p => p.id === packId);
    if (!pack) {
      ctx.status = 404;
      ctx.body = { error: `资源包 ${packId} 不存在` };
      return;
    }
    
    // 使用资源包ID作为任务ID
    const taskId = packId;
    
    // 检查是否已有相同的安装任务在进行中
    if (this.progressManager.hasActiveTask(taskId)) {
      // 已有相同的安装任务在进行中，直接返回任务ID
      ctx.body = { taskId, existing: true };
      return;
    }
    
    // 创建安装进度记录
    this.progressManager.createProgress(pack, taskId);
    
    const logLang = i18nLogger.getLocale();
    // 启动异步安装任务
    this.startResourcePackInstallation(pack, taskId, source, selectedResources)
      .catch(err => {
        i18nLogger.error('resourcepack.install_failed', { message: err.message, lng: logLang });
        
        // 更新安装状态为错误
        this.progressManager.updateTaskStatus(taskId, InstallStatus.ERROR, err.message);
      });
    
    // 返回任务ID
    ctx.body = { taskId, existing: false };
  }

  /**
   * 取消资源包安装
   */
  public async cancelResourcePackInstallation(ctx: Koa.Context): Promise<void> {
    const { taskId } = ctx.params;
    
    const progress = this.progressManager.getProgress(taskId);
    if (!progress) {
      ctx.status = 404;
      ctx.body = { error: `未找到任务 ${taskId} 的进度信息` };
      return;
    }
    
    // 检查任务是否可以进行取消操作
    if (progress.status === InstallStatus.COMPLETED || 
        progress.status === InstallStatus.ERROR || 
        progress.status === InstallStatus.CANCELED) {
      ctx.status = 400;
      ctx.body = { error: `任务 ${taskId} 已完成或已取消，无法再次取消` };
      return;
    }
    
    try {
      // 取消任务
      const success = this.progressManager.cancelTask(taskId);
      
      if (success) {
        // 调用基类的取消下载方法
        await this.cancelDownloadTask(taskId);
        
        const logLang = i18nLogger.getLocale();
        i18nLogger.info('resourcepack.cancel_success', { taskId, lng: logLang });
        ctx.body = { 
          success: true, 
          message: '已成功取消安装任务',
          taskId: taskId
        };
      } else {
        ctx.status = 500;
        ctx.body = { error: '取消任务失败' };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('resourcepack.cancel_failed', { message: errorMsg, lng: logLang });
      
      ctx.status = 500;
      ctx.body = { error: `取消任务失败: ${errorMsg}` };
    }
  }


} 