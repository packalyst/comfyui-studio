import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { ModelInfo } from './info';
import { getExistingHubScanDirs } from '../../utils/shared-model-hub';

export class ModelInstallManager {
  private readonly comfyuiPath: string;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
  }

  // 根据模型名称推断模型类型
  inferModelType(modelName: string): string {
    const lowerName = modelName.toLowerCase();
    
    if (lowerName.endsWith('.safetensors') || lowerName.endsWith('.ckpt')) {
      if (lowerName.includes('lora')) return 'lora';
      if (lowerName.includes('inpaint')) return 'inpaint';
      if (lowerName.includes('controlnet')) return 'controlnet';
      return 'checkpoint';
    } else if (lowerName.endsWith('.pth')) {
      if (lowerName.includes('upscale')) return 'upscaler';
      return 'vae';
    } else if (lowerName.endsWith('.pt')) {
      return 'embedding';
    }
    
    return 'checkpoint'; // 默认类型
  }
  
  // 根据模型类型获取保存目录
  getModelSaveDir(modelType: string): string {
    switch (modelType) {
      case 'checkpoint': return 'models/checkpoints';
      case 'lora': return 'models/loras';
      case 'vae': return 'models/vae';
      case 'controlnet': return 'models/controlnet';
      case 'upscaler': return 'models/upscale_models';
      case 'embedding': return 'models/embeddings';
      case 'inpaint': return 'models/inpaint';
      default: return 'models/checkpoints';
    }
  }

  // 扫描已安装的模型
  async scanInstalledModels(): Promise<Map<string, any>> {
    const installedModels = new Map<string, any>();
    
    try {
      const localSubdirs = [
        'checkpoints',
        'loras',
        'vae',
        'controlnet',
        'upscale_models',
        'embeddings',
        'inpaint',
        'diffusion_models',
        'clip',
        'clip_vision',
        'hypernetworks',
        'ipadapter',
        'unet',
        'style_models',
        'facerestore_models',
        'text_encoders',
      ];
      const modelDirs = localSubdirs.map((d) => path.join(this.comfyuiPath, 'models', d));

      // Ensure local dirs exist (shared hub is read-only mount; do not mkdir there)
      for (const dir of modelDirs) {
        await fs.ensureDir(dir);
      }

      for (const dir of modelDirs) {
        await this.scanDirectory(dir, installedModels, this.comfyuiPath);
      }

      const hubDirs = getExistingHubScanDirs();
      for (const dir of hubDirs) {
        await this.scanDirectory(dir, installedModels, null);
      }
      
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('model.install.scan_completed', { count: installedModels.size, lng: logLang });
      return installedModels;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('model.install.scan_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return installedModels;
    }
  }
  
  /**
   * @param rootForRelative - If set, save_path is relative to this root (ComfyUI install). If null (shared hub), save_path is absolute.
   */
  private async scanDirectory(dir: string, result: Map<string, any>, rootForRelative: string | null): Promise<void> {
    try {
      const files = await fs.readdir(dir);
      
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = await fs.stat(fullPath);
        
        if (stat.isDirectory()) {
          // 递归扫描子目录
          await this.scanDirectory(fullPath, result, rootForRelative);
        } else {
          // 检查是否是模型文件
          const ext = path.extname(file).toLowerCase();
          if (['.safetensors', '.ckpt', '.pth', '.pt', '.bin'].includes(ext)) {
            // 检查文件完整性
            const fileInfo = await this.checkFileBasicIntegrity(fullPath, file, stat.size);
            
            // 使用文件名作为键，文件信息作为值
            const storePath =
              rootForRelative !== null
                ? path.relative(rootForRelative, fullPath)
                : fullPath;
            result.set(file, {
              path: storePath,
              size: stat.size,
              status: fileInfo.status,
              type: this.inferModelTypeFromPath(storePath)
            });
            
            // 记录文件状态信息到日志（使用debug级别，避免过多日志）
            // i18nLogger.debug('model.install.file_found', { file, path: relativePath, status: fileInfo.status, size: this.formatFileSize(stat.size), lng: i18nLogger.getLocale() });
          }
        }
      }
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('model.install.scan_dir_failed', { dir, message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }

  // 简化版的文件完整性检查
  private async checkFileBasicIntegrity(filePath: string, fileName: string, fileSize: number): Promise<{status: 'complete' | 'incomplete' | 'corrupted', message?: string}> {
    try {
      // 1. 基本检查：文件是否为空
      if (fileSize === 0) {
        return { status: 'incomplete', message: '文件大小为0' };
      }
      
      // 2. 尝试读取文件的前几个字节，检查是否可以访问
      try {
        // 使用 fs.promises.open 代替 fs.open
        const fileHandle = await fs.promises.open(filePath, 'r');
        const buffer = Buffer.alloc(1024); // 读取前1KB进行测试
        
        try {
          const { bytesRead } = await fileHandle.read(buffer, 0, 1024, 0);
          await fileHandle.close();
          
          if (bytesRead <= 0) {
            return { status: 'corrupted', message: '文件无法读取' };
          }
        } catch (error) {
          await fileHandle.close();
          throw error;
        }
      } catch (error) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.error('model.install.read_file_failed', { fileName, message: error instanceof Error ? error.message : String(error), lng: logLang });
        return { status: 'corrupted', message: '文件无法访问' };
      }
      
      // 通过所有检查，文件被认为是完整的
      return { status: 'complete' };
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('model.install.check_integrity_failed', { fileName, message: error instanceof Error ? error.message : String(error), lng: logLang });
      return { status: 'corrupted', message: '检查过程中出错' };
    }
  }

  // 格式化文件大小为可读形式
  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  // 从路径推断模型类型
  private inferModelTypeFromPath(relativePath: string): string {
    const lowercasePath = relativePath.toLowerCase();
    if (lowercasePath.includes('checkpoints') || lowercasePath.includes('/main/') || lowercasePath.includes('olares-shared-model/main')) return 'checkpoint';
    if (lowercasePath.includes('loras') || lowercasePath.includes('/lora/') || lowercasePath.includes('olares-shared-model/lora')) return 'lora';
    if (lowercasePath.includes('vae')) return 'vae';
    if (lowercasePath.includes('controlnet')) return 'controlnet';
    if (lowercasePath.includes('upscale')) return 'upscaler';
    if (lowercasePath.includes('embeddings')) return 'embedding';
    if (lowercasePath.includes('inpaint')) return 'inpaint';
    if (lowercasePath.includes('diffusion_models') || lowercasePath.includes('/unet/')) return 'checkpoint';
    if (lowercasePath.includes('clip_vision')) return 'checkpoint';
    if (lowercasePath.includes('text_encoders') || lowercasePath.includes('/clip/')) return 'checkpoint';
    return 'unknown';
  }

  // 解析大小字符串为字节数
  parseSizeString(sizeStr: string): number | null {
    try {
      if (!sizeStr) return null;
      
      const match = sizeStr.match(/^([\d.]+)\s*([KMGT]B?)?$/i);
      if (!match) return null;
      
      const value = parseFloat(match[1]);
      const unit = match[2]?.toUpperCase() || '';
      
      if (isNaN(value)) return null;
      
      switch (unit) {
        case 'KB':
        case 'K':
          return value * 1024;
        case 'MB':
        case 'M':
          return value * 1024 * 1024;
        case 'GB':
        case 'G':
          return value * 1024 * 1024 * 1024;
        case 'TB':
        case 'T':
          return value * 1024 * 1024 * 1024 * 1024;
        default:
          return value;
      }
    } catch (error) {
      return null;
    }
  }

  // 刷新模型列表的安装状态并检查完整性
  async refreshInstalledStatus(models: ModelInfo[]): Promise<ModelInfo[]> {
    try {
      // 扫描已安装的模型
      const installedModels = await this.scanInstalledModels();
      
      // 跟踪已处理的模型文件，避免重复添加
      const processedFiles = new Set<string>();
      
      // 更新每个模型的安装状态和文件状态
      const updatedModels = await Promise.all(models.map(async model => {
        // 检查模型文件名是否在已安装列表中
        if (model.filename && installedModels.has(model.filename)) {
          processedFiles.add(model.filename); // 标记此文件已处理
          const fileInfo = installedModels.get(model.filename);
          model.installed = true;
          model.fileStatus = fileInfo.status;
          model.fileSize = fileInfo.size;
          model.save_path = fileInfo.path;
          
          // 如果模型有预期大小，检查是否匹配
          if (model.size) {
            const expectedSize = this.parseSizeString(model.size);
            if (expectedSize && Math.abs(fileInfo.size - expectedSize) / expectedSize > 0.1) {
              model.fileStatus = 'incomplete';
              const logLang = i18nLogger.getLocale();
              i18nLogger.warn('model.install.size_mismatch', { filename: model.filename, expected: model.size, actual: this.formatFileSize(fileInfo.size), lng: logLang });
            }
          }
        } else {
          // 也检查模型名称是否匹配
          const possibleMatches = Array.from(installedModels.keys()).filter(
            filename => filename.includes(model.name) || (model.name && filename.includes(model.name))
          );
          
          if (possibleMatches.length > 0) {
            processedFiles.add(possibleMatches[0]); // 标记此文件已处理
            const fileInfo = installedModels.get(possibleMatches[0]);
            model.installed = true;
            model.filename = possibleMatches[0];
            model.fileStatus = fileInfo.status;
            model.fileSize = fileInfo.size;
            model.save_path = fileInfo.path;
            
            // 与预期大小比较
            if (model.size) {
              const expectedSize = this.parseSizeString(model.size);
              if (expectedSize && Math.abs(fileInfo.size - expectedSize) / expectedSize > 0.1) {
                model.fileStatus = 'incomplete';
                const logLang = i18nLogger.getLocale();
              i18nLogger.warn('model.install.size_mismatch', { filename: model.filename, expected: model.size, actual: this.formatFileSize(fileInfo.size), lng: logLang });
              }
            }
          } else {
            model.installed = false;
            model.fileStatus = undefined;
          }
        }
        
        return model;
      }));
      
      // 添加已安装但未在列表中的模型文件
      const unknownModels: ModelInfo[] = [];
      
      for (const [filename, fileInfo] of installedModels.entries()) {
        if (!processedFiles.has(filename)) {
          const logLang = i18nLogger.getLocale();
          i18nLogger.info('model.install.unknown_model_found', { filename, path: fileInfo.path, lng: logLang });
          
          // 创建新的模型信息对象
          const newModel: ModelInfo = {
            name: filename, // 使用文件名作为模型名
            type: fileInfo.type || this.inferModelTypeFromPath(fileInfo.path),
            base_url: '',
            save_path: fileInfo.path,
            description: 'Locally discovered model, not in official list',
            filename: filename,
            installed: true,
            fileStatus: 'unknown', // 特殊状态表示"未知模型,无法确认完整性"
            fileSize: fileInfo.size
          };
          
          unknownModels.push(newModel);
        }
      }
      
      // 如果有未知模型，添加到结果列表中
      if (unknownModels.length > 0) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.info('model.install.unknown_models_added', { count: unknownModels.length, lng: logLang });
        return [...updatedModels, ...unknownModels];
      }
      
      return updatedModels;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('model.install.refresh_status_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return [];
    }
  }

  // 删除模型
  async deleteModel(modelName: string, models: ModelInfo[]): Promise<{ success: boolean; message: string }> {
    try {
      // 获取模型信息
      const modelInfo = models.find(model => 
        model.name === modelName || model.filename === modelName
      );
      
      if (!modelInfo) {
        return { success: false, message: `找不到模型: ${modelName}` };
      }
      
      if (!modelInfo.installed) {
        return { success: false, message: `模型未安装: ${modelName}` };
      }
      
      // Build absolute path; shared-hub files store absolute save_path
      const modelPath = modelInfo.save_path
        ? path.isAbsolute(modelInfo.save_path)
          ? modelInfo.save_path
          : path.join(this.comfyuiPath, modelInfo.save_path)
        : path.join(
            this.comfyuiPath,
            this.getModelSaveDir(modelInfo.type),
            modelInfo.filename || modelName
          );
      
      logger.info(`Attempting to delete model: ${modelName} at path: ${modelPath}`);
      
      // 检查文件是否存在
      if (!await fs.pathExists(modelPath)) {
        return { success: false, message: `找不到模型文件: ${modelPath}` };
      }
      
      // 删除文件
      await fs.remove(modelPath);
      logger.info(`Model deleted successfully: ${modelName}`);
      
      return { 
        success: true,
        message: `模型 ${modelName} 已成功删除`
      };
    } catch (error) {
      logger.error(`Delete model error: ${error instanceof Error ? error.message : String(error)}`);
      return { 
        success: false,
        message: `删除模型时出错: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  // 获取状态标签
  getStatusLabel(status?: string): string {
    switch (status) {
      case 'complete': return '完整';
      case 'incomplete': return '不完整';
      case 'corrupted': return '已损坏';
      case 'unknown': return '未知模型,无法确认完整性';
      default: return '未知';
    }
  }
}
