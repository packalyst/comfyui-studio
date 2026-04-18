import { Context } from 'koa';
import CivitaiModelsService from './models';
import CivitaiWorkflowsService from './workflows';

export class CivitaiController {
  
  /**
   * 获取最新模型
   * @param ctx Koa上下文对象
   */
  async getLatestModels(ctx: Context): Promise<void> {
    return CivitaiModelsService.getLatestModels(ctx);
  }

  /**
   * 获取热门模型
   * @param ctx Koa上下文对象
   */
  async getHotModels(ctx: Context): Promise<void> {
    return CivitaiModelsService.getHotModels(ctx);
  }

  /**
   * 获取特定模型的详细信息
   * @param ctx Koa上下文对象
   */
  async getModelDetails(ctx: Context): Promise<void> {
    return CivitaiModelsService.getModelDetails(ctx);
  }
  
  /**
   * 下载模型文件
   * @param ctx Koa上下文对象
   */
  async downloadModel(ctx: Context): Promise<void> {
    return CivitaiModelsService.downloadModel(ctx);
  }

  /**
   * 使用完整URL获取模型
   */
  async getLatestModelsByUrl(ctx: Context): Promise<void> {
    return CivitaiModelsService.getLatestModelsByUrl(ctx);
  }

  /**
   * 获取最新工作流
   * @param ctx Koa上下文对象
   */
  async getLatestWorkflows(ctx: Context): Promise<void> {
    return CivitaiWorkflowsService.getLatestWorkflows(ctx);
  }

  /**
   * 获取热门工作流
   * @param ctx Koa上下文对象
   */
  async getHotWorkflows(ctx: Context): Promise<void> {
    return CivitaiWorkflowsService.getHotWorkflows(ctx);
  }
}

export default new CivitaiController();
