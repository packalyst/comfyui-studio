/**
 * 自定义资源安装器
 * 负责处理自定义资源的下载和安装
 */
import * as path from 'path';
import * as fs from 'fs';
import { CustomResource, InstallStatus, CustomDownloadOptions } from '../../types/resource-packs.types';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { downloadFile } from '../../utils/download.utils';

export class CustomInstaller {
  private comfyuiPath: string;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
  }

  /**
   * 安装自定义资源
   */
  public async installCustomResource(
    resource: CustomResource,
    taskId: string,
    onProgress: (status: InstallStatus, progress: number, error?: string) => void,
    abortController?: AbortController
  ): Promise<void> {
    // track last known percent to preserve on cancel
    let lastPercent = 0;
    
    // 处理目标路径
    const destinationPath = resource.destination;

    // 确定输出目录和文件名
    let outputDir: string;
    let outputFilename: string;

    if (path.isAbsolute(destinationPath)) {
      // 如果是绝对路径，直接使用
      outputDir = path.dirname(destinationPath);
      outputFilename = path.basename(destinationPath);
    } else {
      // 如果是相对路径，相对于ComfyUI目录
      outputDir = path.dirname(path.join(this.comfyuiPath, destinationPath));
      outputFilename = path.basename(destinationPath);
    }

    const logLang = i18nLogger.getLocale();
    // 确保输出目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      i18nLogger.info('resourcepack.custom.create_dir', { path: outputDir, lng: logLang });
    }

    // 完整的输出路径
    const outputPath = path.join(outputDir, outputFilename);

    // 检查文件是否已存在
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size > 0) {
        i18nLogger.info('resourcepack.custom.file_exists', { path: outputPath, lng: logLang });
        onProgress(InstallStatus.SKIPPED, 100);
        return;
      } else {
        // 如果文件存在但大小为0，删除它
        i18nLogger.info('resourcepack.custom.empty_file', { path: outputPath, lng: logLang });
        fs.unlinkSync(outputPath);
      }
    }

    // 获取所有可用的下载URL
    const downloadUrls = this.getAllDownloadUrls(resource);
    i18nLogger.info('resourcepack.custom.prepare_download', { name: resource.name, sources: downloadUrls.map(u => u.source).join(', '), lng: logLang });

    let lastError: Error | null = null;
    
    // 依次尝试每个下载源
    for (const { url: downloadUrl, source: currentSource } of downloadUrls) {
      try {
        onProgress(InstallStatus.DOWNLOADING, 0);
        i18nLogger.info('resourcepack.custom.try_download', { source: currentSource, name: resource.name, url: downloadUrl, lng: logLang });

        // 创建下载进度处理函数
        const onDownloadProgress = (downloadedBytes: number, totalBytes: number) => {
          const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0;
          lastPercent = percent;
          onProgress(InstallStatus.DOWNLOADING, percent);

          // 记录进度
          if (percent % 20 === 0) { // 每20%记录一次
            const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
            const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
            i18nLogger.info('resourcepack.custom.download_progress', { name: resource.name, source: currentSource, percent, downloadedMB, totalMB, lng: logLang });
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
          i18nLogger.info('resourcepack.custom.download_canceled', { taskId, lng: logLang });
          onProgress(InstallStatus.CANCELED, lastPercent);
          return;
        }

        // 处理可能存在的.download后缀
        const finalPath = this.handleDownloadExtension(outputPath);

        // 下载完成后检查文件
        if (fs.existsSync(finalPath)) {
          const stats = fs.statSync(finalPath);
          if (stats.size > 0) {
            const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            i18nLogger.info('resourcepack.custom.download_completed', { name: resource.name, source: currentSource, size: sizeMB, lng: logLang });
            onProgress(InstallStatus.COMPLETED, 100);
            return; // 下载成功，直接返回
          } else {
            // 文件大小为0，可能下载失败
            fs.unlinkSync(finalPath);
            throw new Error(`Downloaded file has zero size, download may have failed: ${finalPath}`);
          }
        } else {
          throw new Error(`File not found after download: ${finalPath}`);
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // 如果是用户取消，立即终止所有重试
        if (/(取消|canceled|cancelled|abort|aborted)/i.test(errorMsg)) {
          onProgress(InstallStatus.CANCELED, lastPercent);
          i18nLogger.info('resourcepack.custom.download_canceled_by_user', { name: resource.name, lng: logLang });
          
          // 删除不完整的文件
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
              i18nLogger.info('resourcepack.custom.deleted_incomplete', { path: outputPath, lng: logLang });
            } catch (unlinkError) {
              i18nLogger.error('resourcepack.custom.delete_incomplete_failed', { path: outputPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
            }
          }
          
          throw error;
        }
        
        // 记录错误，继续尝试下一个源
        i18nLogger.error('resourcepack.custom.download_failed', { source: currentSource, name: resource.name, message: errorMsg, lng: logLang });
        
        // 删除不完整的文件，为下一次尝试做准备
        if (fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
            i18nLogger.info('resourcepack.custom.deleted_incomplete_retry', { path: outputPath, lng: logLang });
          } catch (unlinkError) {
            i18nLogger.error('resourcepack.custom.delete_incomplete_failed', { path: outputPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
          }
        }
        
        // 删除临时下载文件
        const tempPath = `${outputPath}.download`;
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
            i18nLogger.info('resourcepack.custom.deleted_temp', { path: tempPath, lng: logLang });
          } catch (unlinkError) {
            i18nLogger.error('resourcepack.custom.delete_temp_failed', { path: tempPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
          }
        }
      }
    }
    
    // 所有下载源都失败了
    const finalErrorMsg = i18nLogger.translate('resourcepack.custom.all_sources_failed', { name: resource.name, message: lastError?.message || 'Unknown error', lng: logLang });
    onProgress(InstallStatus.ERROR, 0, finalErrorMsg);
    i18nLogger.error('resourcepack.custom.all_sources_failed', { name: resource.name, message: lastError?.message || 'Unknown error', lng: logLang });
    throw new Error(finalErrorMsg);
  }

  /**
   * 获取所有可用的下载URL（按优先级排序）
   */
  private getAllDownloadUrls(resource: CustomResource): Array<{ url: string; source: string }> {
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
    
    // 检查是否存在带.download后缀的文件
    if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}${downloadExt}`)) {
      try {
        // 重命名文件，移除.download后缀
        fs.renameSync(`${filePath}${downloadExt}`, filePath);
        i18nLogger.info('resourcepack.custom.file_renamed', { from: `${filePath}${downloadExt}`, to: filePath, lng: i18nLogger.getLocale() });
      } catch (error) {
        i18nLogger.error('resourcepack.custom.rename_failed', { message: error instanceof Error ? error.message : String(error), lng: i18nLogger.getLocale() });
        // 如果重命名失败，返回带后缀的文件路径
        return `${filePath}${downloadExt}`;
      }
    }
    
    return filePath;
  }
}
