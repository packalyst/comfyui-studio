import fs from 'fs-extra';
import path from 'path';
import https from 'https';
import { logger } from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import { config } from '../../config';
import { EssentialModel } from '../../types/models.types';
import { resolveModelFilePath } from '../../utils/shared-model-hub';

// 模型信息接口
export interface ModelInfo {
  name: string;
  type: string;
  base_url: string;
  save_path: string;
  description?: string;
  reference?: string;
  filename?: string;
  sha256?: string;
  installed?: boolean;
  url?: string;
  fileStatus?: 'complete' | 'incomplete' | 'corrupted' | 'unknown';
  fileSize?: number;
  size?: string;
}

// 定义接口来匹配远程API的响应结构
interface ModelListResponse {
  models: ModelInfo[];
}

export class ModelInfoManager {
  private modelCache: ModelInfo[] = [];
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 1天的缓存时间
  private readonly MODEL_LIST_URL = 'https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/model-list.json';
  private readonly LOCAL_CACHE_PATH = path.join(config.dataDir, 'model-cache.json');
  private readonly LOCAL_DEFAULT_LIST_PATH = path.join(__dirname, '../model-list.json');
  private readonly comfyuiPath: string;

  constructor(comfyuiPath: string) {
    this.comfyuiPath = comfyuiPath;
  }

  // 获取模型列表
  async getModelList(mode: 'cache' | 'local' | 'remote' = 'cache'): Promise<ModelInfo[]> {
    try {
      // 合并常规模型和基础模型列表
      const regularModels = await this.getRegularModelList(mode);
      return regularModels;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('model.info.get_list_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return [];
    }
  }

  // 获取常规模型列表
  private async getRegularModelList(mode: 'cache' | 'local' | 'remote' = 'cache'): Promise<ModelInfo[]> {
    try {
      const logLang = i18nLogger.getLocale();
      // 优先使用内存缓存(当mode为cache时)
      if (mode === 'cache' && this.modelCache && this.cacheTimestamp && 
          Date.now() - this.cacheTimestamp < this.CACHE_DURATION) {
        i18nLogger.info('model.info.use_cache', { lng: logLang });
        return this.modelCache;
      }

      // 如果请求远程数据，直接获取
      if (mode === 'remote') {
        return await this.getRemoteModels();
      }

      // 如果请求本地数据，尝试读取本地缓存
      if (mode === 'local') {
        return await this.getLocalModels();
      }

      // 默认情况下按顺序尝试：缓存文件 -> 远程API -> 本地默认列表
      // 尝试读取本地缓存文件
      try {
        if (await fs.pathExists(this.LOCAL_CACHE_PATH)) {
          const cacheData = await fs.readFile(this.LOCAL_CACHE_PATH, 'utf8');
          const cacheJson = JSON.parse(cacheData);
          
          if (cacheJson.models && Array.isArray(cacheJson.models) && 
              cacheJson.timestamp && 
              Date.now() - cacheJson.timestamp < this.CACHE_DURATION) {
            i18nLogger.info('model.info.use_local_cache', { lng: logLang });
            this.modelCache = cacheJson.models;
            this.cacheTimestamp = cacheJson.timestamp;
            return this.modelCache;
          }
        }
      } catch (cacheError) {
        i18nLogger.warn('model.info.read_cache_failed', { message: cacheError instanceof Error ? cacheError.message : String(cacheError), lng: logLang });
      }
      
      // 尝试从远程API获取
      try {
        i18nLogger.info('model.info.fetch_remote', { lng: logLang });
        const models = await this.getRemoteModels();
        
        // 更新缓存
        this.modelCache = models;
        this.cacheTimestamp = Date.now();
        
        // 保存到本地缓存
        this.ensureCacheDirectory();
        await fs.writeFile(this.LOCAL_CACHE_PATH, JSON.stringify({
          models,
          timestamp: this.cacheTimestamp
        }));
        
        i18nLogger.info('model.info.fetch_remote_success', { count: models.length, lng: logLang });
        return models;
      } catch (apiError) {
        i18nLogger.error('model.info.fetch_remote_failed', { message: apiError instanceof Error ? apiError.message : String(apiError), lng: logLang });
        
        // 使用本地默认模型列表
        try {
          i18nLogger.info('model.info.use_default_list', { lng: logLang });
          if (await fs.pathExists(this.LOCAL_DEFAULT_LIST_PATH)) {
            const defaultData = await fs.readFile(this.LOCAL_DEFAULT_LIST_PATH, 'utf8');
            const defaultJson = JSON.parse(defaultData);
            
            if (defaultJson.models && Array.isArray(defaultJson.models)) {
              i18nLogger.info('model.info.load_default_success', { count: defaultJson.models.length, lng: logLang });
              return defaultJson.models;
            }
          }
        } catch (defaultError) {
          i18nLogger.error('model.info.read_default_failed', { message: defaultError instanceof Error ? defaultError.message : String(defaultError), lng: logLang });
        }
      }
      
      // 所有方法都失败，返回空列表
      i18nLogger.warn('models.info.get_list_empty', { lng: logLang });
      return [];
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('models.info.get_regular_list_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return [];
    }
  }

  // 获取本地模型列表（不依赖网络）
  private getLocalModels(): ModelInfo[] {
    try {
      // 这里可以添加一个预先打包的模型列表作为备用
      const localModelListPath = path.join(__dirname, '../../data/default-model-list.json');
      if (fs.existsSync(localModelListPath)) {
        const models = JSON.parse(fs.readFileSync(localModelListPath, 'utf-8'));
        return models;
      }
    } catch (error) {
      console.error('Error loading local model list:', error);
    }
    return [];
  }

  // 从远程获取最新模型列表
  private async getRemoteModels(): Promise<ModelInfo[]> {
    try {
      return new Promise((resolve, reject) => {
        https.get(this.MODEL_LIST_URL, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              // 解析响应数据并获取models数组
              const parsedData = JSON.parse(data) as ModelListResponse;
              const models = parsedData.models || [];
              
              // 更新缓存
              this.modelCache = models;
              this.cacheTimestamp = Date.now();
              
              // 保存到本地缓存
              fs.writeFileSync(this.LOCAL_CACHE_PATH, JSON.stringify({
                models,
                timestamp: this.cacheTimestamp
              }));
              
              resolve(models);
            } catch (error) {
              const logLang = i18nLogger.getLocale();
              i18nLogger.error('model.info.parse_data_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
              resolve([]); 
            }
          });
        }).on('error', (error) => {
          const logLang = i18nLogger.getLocale();
          i18nLogger.error('model.info.fetch_remote_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
          resolve([]);
        });
      });
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('model.info.fetch_remote_error', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return [];
    }
  }

  // 将基础模型转换为ModelInfo格式
  convertEssentialModelsToModelInfo(essentialModels: EssentialModel[]): ModelInfo[] {
    try {
      return essentialModels.map(model => {
        // 创建路径字符串
        const savePath = `models/${model.dir}/${model.out}`;
        const modelsRoot = path.join(this.comfyuiPath, 'models');
        const resolved = resolveModelFilePath(modelsRoot, model.dir, model.out);
        const isInstalled = resolved !== null;
        let fileSize = 0;
        let fileStatus: 'complete' | 'incomplete' | 'corrupted' | 'unknown' = 'unknown';
        
        if (isInstalled && resolved) {
          try {
            const stat = fs.statSync(resolved);
            fileSize = stat.size;
            fileStatus = fileSize > 0 ? 'complete' : 'incomplete';
          } catch (error) {
            const logLang = i18nLogger.getLocale();
            i18nLogger.error('model.info.check_essential_file_failed', { path: resolved, message: error instanceof Error ? error.message : String(error), lng: logLang });
          }
        }
        
        // 创建与ModelInfo接口兼容的对象
        return {
          name: model.name,
          type: model.type,
          base_url: '',
          save_path: savePath,
          description: model.description,
          filename: model.out,
          installed: isInstalled && fileSize > 0,
          essential: true,
          fileStatus: fileStatus,
          fileSize: fileSize,
          url: model.url.mirror || model.url.hf
        } as unknown as ModelInfo;
      });
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('model.info.convert_essential_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return [];
    }
  }

  // 确保缓存目录存在
  private ensureCacheDirectory() {
    const dir = path.dirname(this.LOCAL_CACHE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // 获取模型信息
  async getModelInfo(modelName: string): Promise<ModelInfo | undefined> {
    const models = await this.getModelList();
    return models.find(model => model.name === modelName);
  }

  // 更新模型缓存
  updateModelCache(models: ModelInfo[]) {
    this.modelCache = models;
    this.cacheTimestamp = Date.now();
  }

  // 获取缓存时间戳
  getCacheTimestamp(): number {
    return this.cacheTimestamp;
  }
}
