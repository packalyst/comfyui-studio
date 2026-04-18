/**
 * 资源包安装进度管理器
 * 负责跟踪和管理资源包安装的进度状态
 */
import { ResourcePackInstallProgress, ResourceInstallStatus, InstallStatus, ResourcePack } from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';

export class ProgressManager {
  private packInstallProgress = new Map<string, ResourcePackInstallProgress>();

  /**
   * 创建新的安装进度记录
   */
  public createProgress(pack: ResourcePack, taskId: string): ResourcePackInstallProgress {
    const progress: ResourcePackInstallProgress = {
      packId: pack.id,
      packName: pack.name,
      taskId,
      status: InstallStatus.PENDING,
      currentResourceIndex: 0,
      totalResources: pack.resources.length,
      progress: 0,
      startTime: Date.now(),
      resourceStatuses: pack.resources.map(resource => ({
        resourceId: resource.id,
        resourceName: resource.name,
        resourceType: resource.type,
        status: InstallStatus.PENDING,
        progress: 0
      }))
    };

    this.packInstallProgress.set(taskId, progress);
    i18nLogger.info('resourcepack.progress.created', { name: pack.name, taskId, lng: i18nLogger.getLocale() });
    return progress;
  }

  /**
   * 获取安装进度
   */
  public getProgress(taskId: string): ResourcePackInstallProgress | undefined {
    return this.packInstallProgress.get(taskId);
  }

  /**
   * 更新总体进度
   */
  public updateOverallProgress(taskId: string, currentIndex: number, totalResources: number): void {
    const progress = this.packInstallProgress.get(taskId);
    if (progress) {
      // 统一为基于 resourceStatuses.progress 的平均值
      const list = Array.isArray(progress.resourceStatuses) ? progress.resourceStatuses : [];
      const count = list.length > 0 ? list.length : Math.max(1, totalResources || 0);
      const sum = list.reduce((acc, r) => acc + Math.max(0, Math.min(100, Number(r.progress || 0))), 0);
      const average = Math.floor(sum / count);

      // 同步索引信息（以 completed 数量近似，用于兼容旧字段）
      const completedCount = list.filter(r => r.status === InstallStatus.COMPLETED).length;
      progress.currentResourceIndex = Math.max(0, completedCount - 1);
      progress.totalResources = list.length || totalResources;
      progress.progress = average;
    }
  }

  /**
   * 更新资源状态
   */
  public updateResourceStatus(
    taskId: string, 
    resourceId: string, 
    status: InstallStatus, 
    progress: number = 0,
    error?: string
  ): void {
    const packProgress = this.packInstallProgress.get(taskId);
    if (packProgress) {
      const resourceStatus = packProgress.resourceStatuses.find(rs => rs.resourceId === resourceId);
      if (resourceStatus) {
        resourceStatus.status = status;
        resourceStatus.progress = progress;
        if (error) {
          resourceStatus.error = error;
        }
        if (status === InstallStatus.DOWNLOADING || status === InstallStatus.INSTALLING) {
          resourceStatus.startTime = resourceStatus.startTime || Date.now();
        }
        if (status === InstallStatus.COMPLETED || status === InstallStatus.ERROR || status === InstallStatus.CANCELED) {
          resourceStatus.endTime = Date.now();
        }

        // 每次资源进度更新后同步刷新总体进度
        this.updateOverallProgress(taskId, 0, packProgress.totalResources);
      }
    }
  }

  /**
   * 更新任务状态
   */
  public updateTaskStatus(taskId: string, status: InstallStatus, error?: string): void {
    const progress = this.packInstallProgress.get(taskId);
    if (progress) {
      progress.status = status;
      if (error) {
        progress.error = error;
      }
      if (status === InstallStatus.COMPLETED || status === InstallStatus.ERROR || status === InstallStatus.CANCELED) {
        progress.endTime = Date.now();
      }
    }
  }

  /**
   * 取消任务
   */
  public cancelTask(taskId: string): boolean {
    const progress = this.packInstallProgress.get(taskId);
    if (!progress) {
      return false;
    }

    progress.canceled = true;
    progress.status = InstallStatus.CANCELED;
    progress.endTime = Date.now();

    // 更新所有未完成资源的状态
    for (const resourceStatus of progress.resourceStatuses) {
      if (resourceStatus.status !== InstallStatus.COMPLETED && 
          resourceStatus.status !== InstallStatus.ERROR &&
          resourceStatus.status !== InstallStatus.SKIPPED) {
        // 保留已存在的进度值，仅更新状态和结束时间
        resourceStatus.status = InstallStatus.CANCELED;
        resourceStatus.endTime = Date.now();
      }
    }

    i18nLogger.info('resourcepack.progress.task_canceled', { taskId, lng: i18nLogger.getLocale() });
    return true;
  }

  /**
   * 检查任务是否已取消
   */
  public isTaskCanceled(taskId: string): boolean {
    const progress = this.packInstallProgress.get(taskId);
    return Boolean(progress?.canceled);
  }

  /**
   * 检查是否已有相同的安装任务在进行中
   */
  public hasActiveTask(taskId: string): boolean {
    const progress = this.packInstallProgress.get(taskId);
    // note: 冷启动对齐会创建 PENDING 的进度，这不应阻止重新开始安装
    return Boolean(progress && (
      progress.status === InstallStatus.DOWNLOADING || 
      progress.status === InstallStatus.INSTALLING
    ));
  }

  /**
   * 清理完成的进度记录（可选，用于内存管理）
   */
  public cleanupCompletedTasks(): void {
    const completedTasks: string[] = [];
    
    for (const [taskId, progress] of this.packInstallProgress.entries()) {
      if (progress.status === InstallStatus.COMPLETED || 
          progress.status === InstallStatus.ERROR || 
          progress.status === InstallStatus.CANCELED) {
        // 只保留最近1小时的记录
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        if (progress.endTime && progress.endTime < oneHourAgo) {
          completedTasks.push(taskId);
        }
      }
    }

    for (const taskId of completedTasks) {
      this.packInstallProgress.delete(taskId);
      i18nLogger.info('resourcepack.progress.cleaned', { taskId, lng: i18nLogger.getLocale() });
    }
  }

  /**
   * 获取所有活跃的任务ID
   */
  public getActiveTaskIds(): string[] {
    const activeTasks: string[] = [];
    
    for (const [taskId, progress] of this.packInstallProgress.entries()) {
      if (progress.status === InstallStatus.PENDING || 
          progress.status === InstallStatus.DOWNLOADING || 
          progress.status === InstallStatus.INSTALLING) {
        activeTasks.push(taskId);
      }
    }
    
    return activeTasks;
  }
}
