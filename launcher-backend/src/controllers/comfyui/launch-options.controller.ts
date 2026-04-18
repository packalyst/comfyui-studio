import { Context } from 'koa';
import { i18nLogger } from '../../utils/logger';
import { ComfyUIArgsService, LaunchOptionsConfig } from './launch-options.service';

export class ComfyUIArgsController {
  private argsService: ComfyUIArgsService;

  constructor(argsService?: ComfyUIArgsService) {
    this.argsService = argsService || new ComfyUIArgsService();

    this.getLaunchOptions = this.getLaunchOptions.bind(this);
    this.updateLaunchOptions = this.updateLaunchOptions.bind(this);
    this.resetToDefault = this.resetToDefault.bind(this);
  }

  // Get current launch options and full command view
  async getLaunchOptions(ctx: Context): Promise<void> {
    try {
      const view = this.argsService.getLaunchCommandView();
      ctx.status = 200;
      ctx.body = {
        code: 200,
        message: 'ok',
        data: view
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const lang = i18nLogger.getLocale();
      i18nLogger.error('comfyui.launch_options.get_failed', { message: msg, lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '获取启动参数失败',
        data: null
      };
    }
  }

  // Update launch options config
  async updateLaunchOptions(ctx: Context): Promise<void> {
    try {
      const payload = ctx.request.body as Partial<LaunchOptionsConfig>;
      const lang = (ctx.query.lang as string) || i18nLogger.getLocale();
      i18nLogger.info('comfyui.launch_options.update_request', { lng: lang });

      this.argsService.updateLaunchOptions(payload);
      const view = this.argsService.getLaunchCommandView();

      ctx.status = 200;
      ctx.body = {
        code: 200,
        message: '更新启动参数成功',
        data: view
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const lang = i18nLogger.getLocale();
      i18nLogger.error('comfyui.launch_options.update_failed', { message: msg, lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '更新启动参数失败',
        data: null
      };
    }
  }

  async resetToDefault(ctx: Context): Promise<void> {
    try {
      this.argsService.resetToDefault();
      const view = this.argsService.getLaunchCommandView();
      ctx.status = 200;
      ctx.body = {
        code: 200,
        message: '已恢复为默认配置',
        data: view
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const lang = i18nLogger.getLocale();
      i18nLogger.error('comfyui.launch_options.reset_failed', { message: msg, lng: lang });
      ctx.status = 500;
      ctx.body = {
        code: 500,
        message: '恢复默认失败',
        data: null
      };
    }
  }
}

