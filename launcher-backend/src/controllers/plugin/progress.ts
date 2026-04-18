import { i18nLogger } from '../../utils/logger';

// 任务进度映射
export interface TaskProgress {
  progress: number;
  completed: boolean;
  pluginId: string;
  type: 'install' | 'uninstall' | 'disable' | 'enable' | 'switch-version';
  message?: string;
  githubProxy?: string;
  logs?: string[];
}

export class TaskProgressManager {
  private taskProgressMap: Record<string, TaskProgress> = {};

  constructor() {}

  // 创建新任务
  createTask(taskId: string, pluginId: string, type: 'install' | 'uninstall' | 'disable' | 'enable' | 'switch-version', githubProxy?: string): void {
    this.taskProgressMap[taskId] = {
      progress: 0,
      completed: false,
      pluginId,
      type,
      githubProxy,
      logs: []
    };
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('plugin.progress.task_created', { taskId, pluginId, type, lng: logLang });
  }

  // 更新任务进度
  updateProgress(taskId: string, progress: number, message?: string): void {
    if (this.taskProgressMap[taskId]) {
      this.taskProgressMap[taskId].progress = progress;
      if (message) {
        this.taskProgressMap[taskId].message = message;
      }
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.progress.task_updated', { taskId, progress, lng: logLang });
    }
  }

  // 完成任务
  completeTask(taskId: string, success: boolean = true, message?: string): void {
    if (this.taskProgressMap[taskId]) {
      this.taskProgressMap[taskId].completed = true;
      this.taskProgressMap[taskId].progress = success ? 100 : 0;
      if (message) {
        this.taskProgressMap[taskId].message = message;
      }
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.progress.task_completed', { taskId, success, lng: logLang });
    }
  }

  // 添加日志
  addLog(taskId: string, logMessage: string): void {
    if (this.taskProgressMap[taskId]) {
      if (!this.taskProgressMap[taskId].logs) {
        this.taskProgressMap[taskId].logs = [];
      }
      this.taskProgressMap[taskId].logs!.push(logMessage);
    }
  }

  // 获取任务进度
  getTaskProgress(taskId: string): TaskProgress | null {
    return this.taskProgressMap[taskId] || null;
  }

  // 获取所有任务
  getAllTasks(): Record<string, TaskProgress> {
    return { ...this.taskProgressMap };
  }

  // 删除任务
  removeTask(taskId: string): void {
    if (this.taskProgressMap[taskId]) {
      delete this.taskProgressMap[taskId];
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.progress.task_removed', { taskId, lng: logLang });
    }
  }

  // 清理已完成的任务
  cleanupCompletedTasks(): void {
    const taskIds = Object.keys(this.taskProgressMap);
    let cleanedCount = 0;
    
    taskIds.forEach(taskId => {
      if (this.taskProgressMap[taskId].completed) {
        delete this.taskProgressMap[taskId];
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.progress.tasks_cleaned', { count: cleanedCount, lng: logLang });
    }
  }

  // 获取活跃任务数量
  getActiveTaskCount(): number {
    return Object.values(this.taskProgressMap).filter(task => !task.completed).length;
  }

  // 获取任务统计信息
  getTaskStats(): {
    total: number;
    active: number;
    completed: number;
    byType: Record<string, number>;
  } {
    const tasks = Object.values(this.taskProgressMap);
    const stats = {
      total: tasks.length,
      active: tasks.filter(t => !t.completed).length,
      completed: tasks.filter(t => t.completed).length,
      byType: {} as Record<string, number>
    };

    // 按类型统计
    tasks.forEach(task => {
      if (!stats.byType[task.type]) {
        stats.byType[task.type] = 0;
      }
      stats.byType[task.type]++;
    });

    return stats;
  }

  // 检查任务是否存在
  taskExists(taskId: string): boolean {
    return taskId in this.taskProgressMap;
  }

  // 获取插件的所有任务
  getTasksByPlugin(pluginId: string): TaskProgress[] {
    return Object.values(this.taskProgressMap).filter(task => task.pluginId === pluginId);
  }

  // 获取特定类型的任务
  getTasksByType(type: 'install' | 'uninstall' | 'disable' | 'enable'): TaskProgress[] {
    return Object.values(this.taskProgressMap).filter(task => task.type === type);
  }
} 