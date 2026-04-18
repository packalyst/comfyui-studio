import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config';
import { i18nLogger } from '../../utils/logger';

// 环境变量接口
export interface EnvironmentVariables {
  PIP_INDEX_URL?: string;
  HF_ENDPOINT?: string;
  GITHUB_PROXY?: string;
}

export class EnvironmentConfigurator {
  public envConfig: EnvironmentVariables = {};
  
  // 环境变量配置文件路径
  private readonly ENV_CONFIG_FILE = path.join(config.dataDir, 'env-config.json');

  constructor() {
    // 确保目录存在
    if (!fs.existsSync(config.dataDir)) {
      fs.mkdirSync(config.dataDir, { recursive: true });
    }
    
    // 加载已保存的环境变量
    this.loadEnvironmentVariables();
  }

  /**
   * 加载已保存的环境变量
   */
  private loadEnvironmentVariables(): void {
    try {
      if (fs.existsSync(this.ENV_CONFIG_FILE)) {
        const configData = fs.readFileSync(this.ENV_CONFIG_FILE, 'utf8');
        this.envConfig = JSON.parse(configData);
        
        // 应用已保存的环境变量到当前进程
        Object.entries(this.envConfig).forEach(([key, value]) => {
          if (value) {
            process.env[key] = value;
            i18nLogger.info('system.config.env_loaded', { key, value, lng: i18nLogger.getLocale() });
          }
        });
      }
    } catch (error) {
      i18nLogger.error('system.config.load_error', { message: error instanceof Error ? error.message : String(error), lng: i18nLogger.getLocale() });
    }
  }

  /**
   * 保存环境变量到配置文件
   */
  private saveEnvironmentVariables(): void {
    try {
      fs.writeFileSync(this.ENV_CONFIG_FILE, JSON.stringify(this.envConfig, null, 2), 'utf8');
      i18nLogger.info('system.config.env_saved', { path: this.ENV_CONFIG_FILE, lng: i18nLogger.getLocale() });
    } catch (error) {
      i18nLogger.error('system.config.save_error', { message: error instanceof Error ? error.message : String(error), lng: i18nLogger.getLocale() });
    }
  }

  /**
   * 验证URL格式
   * @param url 要验证的URL
   * @returns 是否有效
   */
  private validateUrl(url: string): boolean {
    const urlPattern = /^https?:\/\/.+/i;
    return urlPattern.test(url);
  }

  /**
   * 配置PIP源
   * @param pipUrl PIP源URL
   * @returns 配置结果
   */
  public configurePipSource(pipUrl: string): { success: boolean; message: string; data?: any } {
    try {
      if (!pipUrl) {
        return {
          success: false,
          message: '缺少必需的参数pipUrl'
        };
      }
      
      // 验证URL格式
      if (!this.validateUrl(pipUrl)) {
        return {
          success: false,
          message: 'PIP源URL格式无效'
        };
      }
      
      // 设置环境变量
      process.env.PIP_INDEX_URL = pipUrl;
      this.envConfig.PIP_INDEX_URL = pipUrl;
      this.saveEnvironmentVariables();
      
      i18nLogger.info('system.config.pip_set', { url: pipUrl, lng: i18nLogger.getLocale() });
      
      return {
        success: true,
        message: 'PIP源配置成功',
        data: { pipUrl: pipUrl }
      };
    } catch (error) {
      i18nLogger.error('system.config.pip_error', { message: error instanceof Error ? error.message : String(error), lng: i18nLogger.getLocale() });
      return {
        success: false,
        message: '服务器内部错误'
      };
    }
  }

  /**
   * 配置Hugging Face端点
   * @param hfEndpoint HF端点URL
   * @returns 配置结果
   */
  public configureHuggingFaceEndpoint(hfEndpoint: string): { success: boolean; message: string; data?: any } {
    try {
      if (!hfEndpoint) {
        return {
          success: false,
          message: '缺少必需的参数hfEndpoint'
        };
      }
      
      // 验证URL格式
      if (!this.validateUrl(hfEndpoint)) {
        return {
          success: false,
          message: 'Hugging Face端点URL格式无效'
        };
      }
      
      // 设置环境变量
      process.env.HF_ENDPOINT = hfEndpoint;
      this.envConfig.HF_ENDPOINT = hfEndpoint;
      this.saveEnvironmentVariables();
      
      i18nLogger.info('system.config.hf_set', { endpoint: hfEndpoint, lng: i18nLogger.getLocale() });
      
      return {
        success: true,
        message: 'Hugging Face端点配置成功',
        data: { hfEndpoint: hfEndpoint }
      };
    } catch (error) {
      i18nLogger.error('system.config.hf_error', { message: error instanceof Error ? error.message : String(error), lng: i18nLogger.getLocale() });
      return {
        success: false,
        message: '服务器内部错误'
      };
    }
  }

  /**
   * 配置GitHub代理站点地址
   * @param githubProxy GitHub代理URL
   * @returns 配置结果
   */
  public configureGithubProxy(githubProxy: string): { success: boolean; message: string; data?: any } {
    try {
      if (!githubProxy) {
        return {
          success: false,
          message: '缺少必需的参数githubProxy'
        };
      }
      
      // 验证URL格式
      if (!this.validateUrl(githubProxy)) {
        return {
          success: false,
          message: 'GitHub代理URL格式无效'
        };
      }
      
      // 设置环境变量
      process.env.GITHUB_PROXY = githubProxy;
      this.envConfig.GITHUB_PROXY = githubProxy;
      this.saveEnvironmentVariables();
      
      i18nLogger.info('system.config.github_set', { proxy: githubProxy, lng: i18nLogger.getLocale() });
      
      return {
        success: true,
        message: 'GitHub代理配置成功',
        data: { githubProxy: githubProxy }
      };
    } catch (error) {
      i18nLogger.error('system.config.github_error', { message: error instanceof Error ? error.message : String(error), lng: i18nLogger.getLocale() });
      return {
        success: false,
        message: '服务器内部错误'
      };
    }
  }

  /**
   * 获取当前网络配置
   * @returns 网络配置信息
   */
  public getNetworkConfig(): any {
    return {
      github: {
        url: this.envConfig.GITHUB_PROXY || process.env.GITHUB_PROXY || 'https://github.com/'
      },
      pip: {
        url: this.envConfig.PIP_INDEX_URL || process.env.PIP_INDEX_URL || 'https://pypi.org/simple/'
      },
      huggingface: {
        url: this.envConfig.HF_ENDPOINT || process.env.HF_ENDPOINT || 'https://huggingface.co/'
      }
    };
  }

  /**
   * 获取环境变量配置
   * @returns 环境变量配置
   */
  public getEnvironmentConfig(): EnvironmentVariables {
    return { ...this.envConfig };
  }
}
