/**
 * 工作流资源安装器
 * 负责处理工作流资源的下载和安装
 */
import * as path from 'path';
import * as fs from 'fs';
import { WorkflowResource, InstallStatus, CustomDownloadOptions } from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { downloadFile } from '../../utils/download.utils';

export class WorkflowInstaller {
  private comfyuiPath: string;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
  }

  /**
   * 安装工作流资源
   */
  public async installWorkflowResource(
    resource: WorkflowResource,
    taskId: string,
    onProgress: (status: InstallStatus, progress: number, error?: string) => void,
    abortController?: AbortController
  ): Promise<void> {
    // track last known percent to preserve on cancel
    let lastPercent = 0;
    
    const logLang = i18nLogger.getLocale();
    // 确保工作流目录存在
    const workflowsDir = path.join(this.comfyuiPath, 'user', 'default', 'workflows');
    if (!fs.existsSync(workflowsDir)) {
      fs.mkdirSync(workflowsDir, { recursive: true });
      i18nLogger.info('resourcepack.workflow.create_dir', { path: workflowsDir, lng: logLang });
    }

    // 目标文件路径
    const outputPath = path.join(workflowsDir, resource.filename);

    // 检查文件是否已存在
    if (fs.existsSync(outputPath)) {
      // 工作流文件已存在，根据需要可以选择覆盖或跳过
      // 这里选择覆盖，因为工作流可能有更新
      i18nLogger.info('resourcepack.workflow.file_exists', { path: outputPath, lng: logLang });
    }

    // 获取所有可用的下载URL
    const downloadUrls = this.getAllDownloadUrls(resource);
    i18nLogger.info('resourcepack.workflow.prepare_download', { name: resource.name, sources: downloadUrls.map(u => u.source).join(', '), lng: logLang });

    let lastError: Error | null = null;
    
    // 依次尝试每个下载源
    for (const { url: downloadUrl, source: currentSource } of downloadUrls) {
      try {
        onProgress(InstallStatus.DOWNLOADING, 0);
        i18nLogger.info('resourcepack.workflow.try_download', { source: currentSource, name: resource.name, url: downloadUrl, lng: logLang });

        // 创建下载进度处理函数
        const onDownloadProgress = (downloadedBytes: number, totalBytes: number) => {
          const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0;
          lastPercent = percent;
          onProgress(InstallStatus.DOWNLOADING, percent);

          // 记录进度
          if (percent % 20 === 0) { // 每20%记录一次
            i18nLogger.info('resourcepack.workflow.download_progress', { name: resource.name, source: currentSource, percent, lng: logLang });
          }

          return true;
        };

        // 配置下载选项
        const downloadAbortController = abortController || new AbortController();
        const progressAdapter = this.createProgressAdapter(onDownloadProgress);

        const downloadOptions: CustomDownloadOptions = {
          abortController: downloadAbortController,
          onProgress: progressAdapter
        };

        // 使用适配后的进度回调
        const result = await downloadFile(
          downloadUrl,
          outputPath,
          progressAdapter,
          downloadOptions as any
        );

        // 检查下载结果
        if (!result) {
          // 下载被取消，处理这种情况但不抛出错误
          i18nLogger.info('resourcepack.workflow.download_canceled', { taskId, lng: logLang });
          onProgress(InstallStatus.CANCELED, lastPercent);
          return;
        }

        // 处理可能存在的.download后缀
        const finalPath = this.handleDownloadExtension(outputPath);

        // 下载完成后检查文件
        if (fs.existsSync(finalPath)) {
          i18nLogger.info('resourcepack.workflow.download_completed', { name: resource.name, source: currentSource, lng: logLang });
          onProgress(InstallStatus.COMPLETED, 100);
          return; // 下载成功，直接返回
        } else {
          throw new Error(`File not found after download: ${finalPath}`);
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // 如果是用户取消，立即终止所有重试
        if (/(取消|canceled|cancelled|abort|aborted)/i.test(errorMsg)) {
          onProgress(InstallStatus.CANCELED, lastPercent);
          i18nLogger.info('resourcepack.workflow.download_canceled_by_user', { name: resource.name, lng: logLang });
          
          // 删除不完整的文件
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
              i18nLogger.info('resourcepack.workflow.deleted_incomplete', { path: outputPath, lng: logLang });
            } catch (unlinkError) {
              i18nLogger.error('resourcepack.workflow.delete_incomplete_failed', { path: outputPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
            }
          }
          
          throw error;
        }
        
        // 记录错误，继续尝试下一个源
        i18nLogger.error('resourcepack.workflow.download_failed', { source: currentSource, name: resource.name, message: errorMsg, lng: logLang });
        
        // 删除不完整的文件，为下一次尝试做准备
        if (fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
            i18nLogger.info('resourcepack.workflow.deleted_incomplete_retry', { path: outputPath, lng: logLang });
          } catch (unlinkError) {
            i18nLogger.error('resourcepack.workflow.delete_incomplete_failed', { path: outputPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
          }
        }
        
        // 删除临时下载文件
        const tempPath = `${outputPath}.download`;
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
            i18nLogger.info('resourcepack.workflow.deleted_temp', { path: tempPath, lng: logLang });
          } catch (unlinkError) {
            i18nLogger.error('resourcepack.workflow.delete_temp_failed', { path: tempPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
          }
        }
      }
    }
    
    // 所有下载源都失败了
    const finalErrorMsg = i18nLogger.translate('resourcepack.workflow.all_sources_failed', { name: resource.name, message: lastError?.message || 'Unknown error', lng: logLang });
    onProgress(InstallStatus.ERROR, 0, finalErrorMsg);
    i18nLogger.error('resourcepack.workflow.all_sources_failed', { name: resource.name, message: lastError?.message || 'Unknown error', lng: logLang });
    throw new Error(finalErrorMsg);
  }

  /**
   * 获取所有可用的下载URL（按优先级排序）
   */
  private getAllDownloadUrls(resource: WorkflowResource): Array<{ url: string; source: string }> {
    const urls: Array<{ url: string; source: string }> = [];
    
    if (typeof resource.url === 'string') {
      // 如果URL是字符串，只有一个下载源
      urls.push({ url: resource.url, source: 'default' });
    } else {
      // 按优先级添加下载源: hf -> mirror -> cdn
      if (resource.url.hf) {
        urls.push({ url: resource.url.hf, source: 'hf' });
      }
      if (resource.url.mirror) {
        urls.push({ url: resource.url.mirror, source: 'mirror' });
      }
      if (resource.url.cdn) {
        urls.push({ url: resource.url.cdn, source: 'cdn' });
      }
    }
    
    return urls;
  }

  /**
   * 修复 downloadFile 函数中类型错误的适配器
   */
  private createProgressAdapter(callback: (downloaded: number, total: number) => void): (progress: number, downloadedBytes: number, totalBytes: number) => void {
    return (progress: number, downloadedBytes: number, totalBytes: number) => {
      callback(downloadedBytes, totalBytes);
    };
  }

  /**
   * 检查并处理下载文件的后缀
   */
  private handleDownloadExtension(filePath: string): string {
    const downloadExt = '.download';
    const logLang = i18nLogger.getLocale();
    
    // 检查是否存在带.download后缀的文件
    if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}${downloadExt}`)) {
      try {
        // 重命名文件，移除.download后缀
        fs.renameSync(`${filePath}${downloadExt}`, filePath);
        i18nLogger.info('resourcepack.workflow.file_renamed', { from: `${filePath}${downloadExt}`, to: filePath, lng: logLang });
      } catch (error) {
        i18nLogger.error('resourcepack.workflow.rename_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
        // 如果重命名失败，返回带后缀的文件路径
        return `${filePath}${downloadExt}`;
      }
    }
    
    return filePath;
  }
}
