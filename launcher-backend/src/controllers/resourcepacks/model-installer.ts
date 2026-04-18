/**
 * 模型资源安装器
 * 负责处理模型资源的下载和安装
 */
import * as path from 'path';
import * as fs from 'fs';
import { ModelResource, InstallStatus, CustomDownloadOptions } from '../../types/resource-packs.types';
import { EssentialModel } from '../../types/models.types';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { downloadFile } from '../../utils/download.utils';
import { SystemController } from '../system/system.controller';
import { resolveModelFilePath } from '../../utils/shared-model-hub';

export class ModelInstaller {
  private comfyuiPath: string;
  private systemController: SystemController;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
    this.systemController = new SystemController();
  }

  /**
   * 安装模型资源
   */
  public async installModelResource(
    resource: ModelResource, 
    taskId: string, 
    source: string,
    onProgress: (status: InstallStatus, progress: number, error?: string) => void,
    abortController?: AbortController
  ): Promise<void> {
    // track last known percent to preserve on cancel
    let lastPercent = 0;
    
    // 获取模型目录
    const { config } = require('../../config');
    const modelsRootPath = config.modelsDir || path.join(this.comfyuiPath, 'models');

    const logLang = i18nLogger.getLocale();
    // 确保模型目录存在
    const modelDirPath = path.join(modelsRootPath, resource.dir);
    if (!fs.existsSync(modelDirPath)) {
      i18nLogger.info('resourcepack.model.create_dir', { path: modelDirPath, lng: logLang });
      fs.mkdirSync(modelDirPath, { recursive: true });
    }

    // 目标文件路径
    const outputPath = path.join(modelDirPath, resource.out);

    const existingAnywhere = resolveModelFilePath(modelsRootPath, resource.dir, resource.out);
    if (existingAnywhere) {
      try {
        const stats = fs.statSync(existingAnywhere);
        if (stats.size > 0) {
          i18nLogger.info('resourcepack.model.file_exists', { path: existingAnywhere, lng: logLang });
          onProgress(InstallStatus.SKIPPED, 100);
          return;
        }
      } catch (_) {
        // fall through to local check
      }
    }

    // 检查文件是否已存在
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size > 0) {
        i18nLogger.info('resourcepack.model.file_exists', { path: outputPath, lng: logLang });
        onProgress(InstallStatus.SKIPPED, 100);
        return;
      } else {
        // 如果文件存在但大小为0，删除它
        i18nLogger.info('resourcepack.model.empty_file', { path: outputPath, lng: logLang });
        fs.unlinkSync(outputPath);
      }
    }

    // 获取所有可用的下载URL
    const downloadUrls = this.getAllDownloadUrls(resource, source);
    i18nLogger.info('resourcepack.model.prepare_download', { name: resource.name, sources: downloadUrls.map(u => u.source).join(', '), lng: logLang });

    let lastError: Error | null = null;
    
    // 依次尝试每个下载源
    for (const { url: downloadUrl, source: currentSource } of downloadUrls) {
      try {
        onProgress(InstallStatus.DOWNLOADING, 0);
        i18nLogger.info('resourcepack.model.try_download', { source: currentSource, name: resource.name, url: downloadUrl, lng: logLang });

        // 创建下载进度处理函数
        const onDownloadProgress = (downloadedBytes: number, totalBytes: number) => {
          const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0;
          lastPercent = percent;
          onProgress(InstallStatus.DOWNLOADING, percent);

          // 记录进度
          if (percent % 10 === 0) {
            const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
            const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
            i18nLogger.info('resourcepack.model.download_progress', { name: resource.name, source: currentSource, percent, downloadedMB, totalMB, lng: logLang });
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

        // 使用 downloadFile 工具进行下载
        const result = await downloadFile(
          downloadUrl,
          outputPath,
          progressAdapter,
          downloadOptions as any
        );

        // 检查下载结果
        if (!result) {
          i18nLogger.info('resourcepack.model.download_canceled', { taskId, lng: logLang });
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
            i18nLogger.info('resourcepack.model.download_completed', { name: resource.name, source: currentSource, size: sizeMB, lng: logLang });
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
          i18nLogger.info('resourcepack.model.download_canceled_by_user', { name: resource.name, lng: logLang });
          
          // 删除不完整的文件
          if (fs.existsSync(outputPath)) {
            try {
              fs.unlinkSync(outputPath);
              i18nLogger.info('resourcepack.model.deleted_incomplete', { path: outputPath, lng: logLang });
            } catch (unlinkError) {
              i18nLogger.error('resourcepack.model.delete_incomplete_failed', { path: outputPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
            }
          }
          
          throw error;
        }
        
        // 记录错误，继续尝试下一个源
        i18nLogger.error('resourcepack.model.download_failed', { source: currentSource, name: resource.name, message: errorMsg, lng: logLang });
        
        // 删除不完整的文件，为下一次尝试做准备
        if (fs.existsSync(outputPath)) {
          try {
            fs.unlinkSync(outputPath);
            i18nLogger.info('resourcepack.model.deleted_incomplete_retry', { path: outputPath, lng: logLang });
          } catch (unlinkError) {
            i18nLogger.error('resourcepack.model.delete_incomplete_failed', { path: outputPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
          }
        }
        
        // 删除临时下载文件
        const tempPath = `${outputPath}.download`;
        if (fs.existsSync(tempPath)) {
          try {
            fs.unlinkSync(tempPath);
            i18nLogger.info('resourcepack.model.deleted_temp', { path: tempPath, lng: logLang });
          } catch (unlinkError) {
            i18nLogger.error('resourcepack.model.delete_temp_failed', { path: tempPath, message: unlinkError instanceof Error ? unlinkError.message : String(unlinkError), lng: logLang });
          }
        }
      }
    }
    
    // 所有下载源都失败了
    const finalErrorMsg = `All download sources failed for model ${resource.name}. Last error: ${lastError?.message || 'Unknown error'}`;
    onProgress(InstallStatus.ERROR, 0, finalErrorMsg);
    logger.error(finalErrorMsg);
    throw new Error(finalErrorMsg);
  }

  /**
   * 获取所有可用的下载URL（按优先级排序）
   * 首先使用用户选择的源，然后尝试 cdn，最后尝试另一个主要源
   */
  private getAllDownloadUrls(resource: ModelResource, source: string): Array<{ url: string; source: string }> {
    const urls: Array<{ url: string; source: string }> = [];
    
    if (typeof resource.url === 'string') {
      // 如果URL是字符串，只有一个下载源
      urls.push({ url: resource.url, source: 'default' });
    } else {
      // 首先添加用户选择的源
      const primarySource = source === 'mirror' ? 'mirror' : 'hf';
      const primaryUrl = source === 'mirror' ? resource.url.mirror : resource.url.hf;
      
      if (primaryUrl) {
        const processedUrl = this.processHfEndpoint(primaryUrl);
        urls.push({ url: processedUrl, source: primarySource });
      }
      
      // 然后添加 cdn 作为备用源
      if (resource.url.cdn) {
        urls.push({ url: resource.url.cdn, source: 'cdn' });
      }
      
      // 最后添加另一个主要源作为最后的备用
      const alternativeSource = source === 'mirror' ? 'hf' : 'mirror';
      const alternativeUrl = source === 'mirror' ? resource.url.hf : resource.url.mirror;
      
      if (alternativeUrl && alternativeUrl !== primaryUrl) {
        const processedUrl = this.processHfEndpoint(alternativeUrl);
        urls.push({ url: processedUrl, source: alternativeSource });
      }
    }
    
    return urls;
  }

  /**
   * 获取下载URL（保留用于向后兼容）
   */
  private getDownloadUrl(resource: ModelResource, source: string): string {
    let downloadUrl: string;
    
    if (typeof resource.url === 'string') {
      downloadUrl = resource.url;
    } else {
      // 根据source参数选择下载源
      downloadUrl = (source === 'mirror' ? resource.url.mirror : resource.url.hf) || resource.url.hf || resource.url.mirror || '';
    }

    return this.processHfEndpoint(downloadUrl);
  }

  /**
   * 处理HF端点配置
   */
  private processHfEndpoint(downloadUrl: string): string {
    // 从系统控制器获取HF端点配置
    const hfEndpoint = this.getHuggingFaceEndpoint();
    
    if (hfEndpoint && downloadUrl.includes('huggingface.co')) {
      i18nLogger.info('resourcepack.model.hf_endpoint_replaced', { endpoint: hfEndpoint, lng: i18nLogger.getLocale() });
      return downloadUrl.replace('huggingface.co/', hfEndpoint.replace(/^https?:\/\//, ''));
    }

    return downloadUrl;
  }

  /**
   * 获取Hugging Face端点配置
   */
  private getHuggingFaceEndpoint(): string | undefined {
    // 优先使用环境变量
    if (process.env.HF_ENDPOINT) {
      return process.env.HF_ENDPOINT;
    }
    
    // 尝试从系统控制器的配置中获取
    if (this.systemController) {
      const envConfig = this.systemController.getEnvironmentConfig();
      if (envConfig && envConfig.HF_ENDPOINT) {
        return envConfig.HF_ENDPOINT;
      }
    }
    
    return undefined;
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
        i18nLogger.info('resourcepack.model.file_renamed', { from: `${filePath}${downloadExt}`, to: filePath, lng: i18nLogger.getLocale() });
      } catch (error) {
        i18nLogger.error('resourcepack.model.rename_failed', { message: error instanceof Error ? error.message : String(error), lng: i18nLogger.getLocale() });
        // 如果重命名失败，返回带后缀的文件路径
        return `${filePath}${downloadExt}`;
      }
    }
    
    return filePath;
  }
}
