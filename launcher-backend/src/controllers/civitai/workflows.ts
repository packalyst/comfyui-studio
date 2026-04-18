import superagent from 'superagent';
import { logger } from '../../utils/logger';
import { Context } from 'koa';

const CIVITAI_API_BASE_URL = 'https://civitai.com/api/v1';

// Interface for SuperAgent error handling
interface SuperAgentError extends Error {
  status?: number;
  response?: {
    body?: {
      message?: string;
    };
  };
}

export class CivitaiWorkflowsService {

  /**
   * Get latest workflows
   * @param ctx Koa context object
   */
  async getLatestWorkflows(ctx: Context): Promise<void> {
    try {
      // Get query parameters and ensure they are single values
      const limit = typeof ctx.query.limit === 'string' ? parseInt(ctx.query.limit) : 24;
      const page = typeof ctx.query.page === 'string' ? parseInt(ctx.query.page) : 1;
      const cursor = typeof ctx.query.cursor === 'string' ? ctx.query.cursor : undefined;
      
      // Build Civitai API request URL, use types query parameter instead of path
      let apiUrl = `${CIVITAI_API_BASE_URL}/models`;
      
      // Build query parameters object
      const queryParams: Record<string, string | number | boolean> = {
        limit,
        types: 'Workflows',
        sort: 'Newest',
        nsfw: false
      };
      
      // Handle pagination
      if (cursor) {
        queryParams.cursor = cursor;
      } else {
        queryParams.page = page;
      }
      
      logger.info(`Getting workflows, parameters: ${JSON.stringify(queryParams)}`);
      
      // Make request and return result
      const response = await superagent
        .get(apiUrl)
        .query(queryParams);
      
      ctx.body = response.body;
    } catch (error) {
      logger.error('Failed to get latest workflows:', error);
      
      // Handle error response
      const err = error as SuperAgentError;
      
      if (err.response) {
        const statusCode = err.status || 500;
        const errorMessage = err.response.body?.message || 'Error occurred while getting latest workflows';
        
        ctx.status = statusCode;
        ctx.body = {
          error: true,
          message: errorMessage
        };
      } else {
        ctx.status = 500;
        ctx.body = {
          error: true,
          message: 'Internal server error'
        };
      }
    }
  }

  /**
   * Get hot workflows
   * @param ctx Koa context object
   */
  async getHotWorkflows(ctx: Context): Promise<void> {
    try {
      // Get query parameters and ensure they are single values
      const limit = typeof ctx.query.limit === 'string' ? parseInt(ctx.query.limit) : 24;
      const page = typeof ctx.query.page === 'string' ? parseInt(ctx.query.page) : 1;
      const cursor = typeof ctx.query.cursor === 'string' ? ctx.query.cursor : undefined;
      
      // Build Civitai API request URL
      let apiUrl = `${CIVITAI_API_BASE_URL}/models`;
      
      // Build query parameters object
      const queryParams: Record<string, string | number | boolean> = {
        limit,
        types: 'Workflows',
        sort: 'Most Downloaded',
        period: 'Month',
        nsfw: false
      };
      
      // Handle pagination
      if (cursor) {
        queryParams.cursor = cursor;
      } else {
        queryParams.page = page;
      }
      
      logger.info(`Getting hot workflows, parameters: ${JSON.stringify(queryParams)}`);
      
      // Make request and return result
      const response = await superagent
        .get(apiUrl)
        .query(queryParams);
      
      ctx.body = response.body;
    } catch (error) {
      logger.error('Failed to get hot workflows:', error);
      
      // Handle error response
      const err = error as SuperAgentError;
      
      if (err.response) {
        const statusCode = err.status || 500;
        const errorMessage = err.response.body?.message || 'Error occurred while getting hot workflows';
        
        ctx.status = statusCode;
        ctx.body = {
          error: true,
          message: errorMessage
        };
      } else {
        ctx.status = 500;
        ctx.body = {
          error: true,
          message: 'Internal server error'
        };
      }
    }
  }
}

export default new CivitaiWorkflowsService();
