import { Context } from 'koa';
import superagent from 'superagent';
import { NetworkChecker } from './networkchecker';
import { EnvironmentConfigurator } from './configurator';
import { i18nLogger, logger } from '../../utils/logger';

// 定义认证相关常量
const AuthorizationTokenCookieKey = "auth_token";
const AuthorizationTokenKey = "X-Authorization";

export class SystemController {
  private networkChecker: NetworkChecker;
  private environmentConfigurator: EnvironmentConfigurator;

  constructor() {
    this.networkChecker = new NetworkChecker();
    this.environmentConfigurator = new EnvironmentConfigurator();
  }

  /**
   * 打开目录
   * @param ctx Koa上下文
   */
  public async openPath(ctx: Context): Promise<void> {
    const token = this.getToken(ctx);
    if (!token) {
      ctx.status = 401;
      ctx.body = {
        code: 401,
        message: '未找到访问令牌',
        data: null
      };
      return;
    }

    const lang = (ctx.query.lang as string) || 'en';
    const osSystemServer = process.env.OS_SYSTEM_SERVER;
    if (!osSystemServer) {
      i18nLogger.warn('system.env.os_system_server_required', { lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '服务器配置错误',
        data: null
      };
      return;
    }

    const httpPostUrl = `http://${osSystemServer}/legacy/v1alpha1/api.intent/v1/server/intent/send`;
    i18nLogger.info('system.api.http_post_url', { url: httpPostUrl, lng: lang }, { url: httpPostUrl });

    const path = ctx.query.path as string;
    i18nLogger.info('system.api.path', { path, lng: lang }, { path });

    const jsonData = {
      action: 'view',
      category: 'default',
      data: {
        path: path
      }
    };

    try {
      const response = await superagent
        .post(httpPostUrl)
        .set('Content-Type', 'application/json; charset=UTF-8')
        .send(jsonData);

      i18nLogger.info('system.api.response_status', { status: response.status, lng: lang }, { status: response.status });
      i18nLogger.info('system.api.response_header', { header: JSON.stringify(response.header), lng: lang }, { header: JSON.stringify(response.header) });
      i18nLogger.info('system.api.response_body', { body: JSON.stringify(response.body), lng: lang }, { body: JSON.stringify(response.body) });

      ctx.status = 200;
      ctx.body = {
        code: 200,
        message: '成功',
        data: null
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      i18nLogger.error('system.api.open_app_error', { message: errorMessage, lng: lang }, { message: errorMessage });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '服务器内部错误',
        data: null
      };
    }
  }

  /**
   * 打开目录 V2 - 使用环境变量中的完整API地址
   * @param ctx Koa上下文
   */
  public async openPathV2(ctx: Context): Promise<void> {
    const token = this.getToken(ctx);
    if (!token) {
      ctx.status = 401;
      ctx.body = {
        code: 401,
        message: '未找到访问令牌',
        data: null
      };
      return;
    }

    const lang = (ctx.query.lang as string) || 'en';
    const desktopApiUrl = process.env.DESKTOP_API_URL;
    if (!desktopApiUrl) {
      i18nLogger.warn('system.env.desktop_api_url_required', { lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '服务器配置错误',
        data: null
      };
      return;
    }

    i18nLogger.info('system.api.desktop_api_url', { url: desktopApiUrl, lng: lang }, { url: desktopApiUrl });

    const path = ctx.query.path as string;
    i18nLogger.info('system.api.path', { path, lng: lang }, { path });

    const jsonData = {
      action: 'view',
      category: 'launcher',
      data: {
        path: path,
        appid: 'files'
      },
      extras: {
        token: token
      }
    };

    try {
      const response = await superagent
        .post(desktopApiUrl)
        .set('Content-Type', 'application/json; charset=UTF-8')
        .send(jsonData);

      i18nLogger.info('system.api.response_status', { status: response.status, lng: lang }, { status: response.status });
      i18nLogger.info('system.api.response_header', { header: JSON.stringify(response.header), lng: lang }, { header: JSON.stringify(response.header) });
      i18nLogger.info('system.api.response_body', { body: JSON.stringify(response.body), lng: lang }, { body: JSON.stringify(response.body) });

      ctx.status = 200;
      ctx.body = {
        code: 200,
        message: '成功',
        data: null
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      i18nLogger.error('system.api.open_app_error', { message: errorMessage, lng: lang }, { message: errorMessage });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '服务器内部错误',
        data: null
      };
    }
  }

  /**
   * 获取 Files 基础路径（由 NODENAME 环境变量决定）
   */
  public async getFilesBasePath(ctx: Context): Promise<void> {
    const nodeName = process.env.NODENAME || 'olares';
    const basePath = `/Files/External/${nodeName}/ai/`;

    ctx.status = 200;
    ctx.body = {
      basePath
    };
  }

  /**
   * 检查网络状态
   * @param ctx Koa上下文
   */
  public async checkNetworkStatus(ctx: Context): Promise<void> {
    // 获取强制检查参数和语言参数
    const forceCheck = ctx.query.force === 'true' || (ctx.request.body as any)?.force === true;
    const lang = ctx.query.lang as string || (ctx.request.body as any)?.lang || 'en';
    
    // 使用网络检查器开始检查
    const checkResult = this.networkChecker.startNetworkCheck(
      forceCheck, 
      lang, 
      this.environmentConfigurator.getEnvironmentConfig()
    );
    
    ctx.status = 200;
    ctx.body = {
      code: 200,
      message: '网络检查已启动，请使用返回的checkId查询结果',
      data: checkResult
    };
  }
  
  /**
   * 获取网络检查日志
   * @param ctx Koa上下文
   */
  public async getNetworkCheckLog(ctx: Context): Promise<void> {
    const checkId = ctx.params.id || ctx.query.id as string;
    // 获取语言参数（仅作为前端展示偏好），实际日志语言由 FORCE_LOG_LANGUAGE 控制
    const clientLang = ctx.query.lang as string || 'en';
    const logLang = i18nLogger.getLocale();
    
    if (!checkId) {
      ctx.status = 400;
      ctx.body = {
        code: 400,
        message: logLang === 'zh' ? '缺少检查ID参数' : 'Missing check ID parameter',
        data: null
      };
      return;
    }
    
    const log = this.networkChecker.getNetworkCheckLog(checkId);
    
    if (!log) {
      ctx.status = 404;
      ctx.body = {
        code: 404,
        message: logLang === 'zh' ? '未找到指定的检查日志' : 'Network check log not found',
        data: null
      };
      return;
    }
    
    // 构建当前的网络检查结果，确保始终返回最新状态
    const currentNetworkStatus = this.networkChecker.getCurrentNetworkStatus();
    
    ctx.status = 200;
    ctx.body = {
      code: 200,
      message: logLang === 'zh' ? '获取网络检查日志成功' : 'Network check log retrieved successfully',
      data: {
        log: log,
        currentNetworkStatus: currentNetworkStatus
      }
    };
  }

  /**
   * 配置PIP源
   * @param ctx Koa上下文
   */
  public async configurePipSource(ctx: Context): Promise<void> {
    try {
      // 从请求体中获取PIP源URL
      const { pipUrl } = ctx.request.body as { pipUrl: string };
      
      if (!pipUrl) {
        ctx.status = 400;
        ctx.body = {
          code: 400,
          message: '缺少必需的参数pipUrl',
          data: null
        };
        return;
      }
      
      // 使用环境变量配置器配置PIP源
      const result = this.environmentConfigurator.configurePipSource(pipUrl);
      
      if (result.success) {
        // 只使PIP源相关的缓存失效
        this.networkChecker.invalidateNetworkCheckCache('pip');
        
        ctx.status = 200;
        ctx.body = {
          code: 200,
          message: result.message,
          data: result.data
        };
      } else {
        ctx.status = 400;
        ctx.body = {
          code: 400,
          message: result.message,
          data: null
        };
      }
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('system.config.pip_error', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '服务器内部错误',
        data: null
      };
    }
  }

  /**
   * 配置Hugging Face端点
   * @param ctx Koa上下文
   */
  public async configureHuggingFaceEndpoint(ctx: Context): Promise<void> {
    try {
      // 从请求体中获取HF端点URL
      const { hfEndpoint } = ctx.request.body as { hfEndpoint: string };
      
      if (!hfEndpoint) {
        ctx.status = 400;
        ctx.body = {
          code: 400,
          message: '缺少必需的参数hfEndpoint',
          data: null
        };
        return;
      }
      
      // 使用环境变量配置器配置HF端点
      const result = this.environmentConfigurator.configureHuggingFaceEndpoint(hfEndpoint);
      
      if (result.success) {
        // 只使Hugging Face相关的缓存失效
        this.networkChecker.invalidateNetworkCheckCache('huggingface');
        
        ctx.status = 200;
        ctx.body = {
          code: 200,
          message: result.message,
          data: result.data
        };
      } else {
        ctx.status = 400;
        ctx.body = {
          code: 400,
          message: result.message,
          data: null
        };
      }
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('system.config.hf_error', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '服务器内部错误',
        data: null
      };
    }
  }

  /**
   * 配置GitHub代理站点地址
   * @param ctx Koa上下文
   */
  public async configureGithubProxy(ctx: Context): Promise<void> {
    try {
      // 从请求体中获取GitHub代理URL
      const { githubProxy } = ctx.request.body as { githubProxy: string };
      
      if (!githubProxy) {
        ctx.status = 400;
        ctx.body = {
          code: 400,
          message: '缺少必需的参数githubProxy',
          data: null
        };
        return;
      }
      
      // 使用环境变量配置器配置GitHub代理
      const result = this.environmentConfigurator.configureGithubProxy(githubProxy);
      
      if (result.success) {
        // 只使GitHub相关的缓存失效
        this.networkChecker.invalidateNetworkCheckCache('github');
        
        ctx.status = 200;
        ctx.body = {
          code: 200,
          message: result.message,
          data: result.data
        };
      } else {
        ctx.status = 400;
        ctx.body = {
          code: 400,
          message: result.message,
          data: null
        };
      }
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('system.config.github_error', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '服务器内部错误',
        data: null
      };
    }
  }

  /**
   * 从请求中获取令牌
   * @param ctx Koa上下文
   * @returns 令牌字符串或空字符串
   */
  private getToken(ctx: Context): string {
    // 尝试从 Cookie 中获取令牌
    const cookieToken = ctx.cookies.get(AuthorizationTokenCookieKey);
    if (cookieToken) {
      return cookieToken;
    }

    // 尝试从 X-Authorization 头获取令牌
    const xAuthToken = ctx.headers[AuthorizationTokenKey.toLowerCase()];
    if (xAuthToken) {
      return Array.isArray(xAuthToken) ? xAuthToken[0] : xAuthToken;
    }

    // 尝试从 Authorization 头获取 Bearer 令牌
    const authHeader = ctx.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // 如果都没有找到，返回空字符串
    return '';
  }

  /**
   * 获取环境配置
   * @returns 环境配置对象
   */
  public getEnvironmentConfig(): any {
    return this.environmentConfigurator.getEnvironmentConfig();
  }

  /**
   * 获取当前网络配置
   * @param ctx Koa上下文
   */
  public async getNetworkConfig(ctx: Context): Promise<void> {
    try {
      // 从环境变量配置器获取网络配置
      const networkConfig = this.environmentConfigurator.getNetworkConfig();
      
      // 合并网络检查结果
      const currentNetworkStatus = this.networkChecker.getCurrentNetworkStatus();
      
      const result = {
        github: {
          url: networkConfig.github.url,
          accessible: currentNetworkStatus.github.accessible
        },
        pip: {
          url: networkConfig.pip.url,
          accessible: currentNetworkStatus.pip.accessible
        },
        huggingface: {
          url: networkConfig.huggingface.url,
          accessible: currentNetworkStatus.huggingface.accessible
        }
      };

      ctx.status = 200;
      ctx.body = {
        code: 200,
        message: '获取网络配置成功',
        data: result
      };
    } catch (error) {
      const lang = (ctx.query.lang as string) || 'en';
      i18nLogger.error('system.config.get_network_config_error', { message: error instanceof Error ? error.message : String(error), lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '服务器内部错误',
        data: null
      };
    }
  }
} 