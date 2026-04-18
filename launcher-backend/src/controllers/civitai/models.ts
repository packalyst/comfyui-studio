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

export class CivitaiModelsService {
  
  /**
   * Get latest models
   * @param ctx Koa context object
   */
  async getLatestModels(ctx: Context): Promise<void> {
    try {
      const limit = ctx.query.limit ? parseInt(ctx.query.limit as string) : 12;
      const page = ctx.query.page ? parseInt(ctx.query.page as string) : 1;
      const cursor = ctx.query.cursor as string | undefined;
      
      // Build API request URL, sort=Newest to get latest models
      const url = `${CIVITAI_API_BASE_URL}/models`;
      
      // Build query parameters
      const queryParams: any = {
        limit,
        sort: 'Newest',
        period: 'AllTime',
        nsfw: false // Default exclude NSFW content
      };
      
      // If cursor is provided, prioritize cursor pagination
      if (cursor) {
        queryParams.cursor = cursor;
      } else {
        queryParams.page = page;
      }
      
      const response = await superagent
        .get(url)
        .query(queryParams);
      
      ctx.body = response.body;
    } catch (error) {
      logger.error('Failed to get latest models:', error);
      
      // Add type assertion
      const err = error as SuperAgentError;
      
      if (err.response) {
        const statusCode = err.status || 500;
        const errorMessage = err.response.body?.message || 'Error occurred while getting latest models';
        
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
   * Get hot models
   * @param ctx Koa context object
   */
  async getHotModels(ctx: Context): Promise<void> {
    try {
      const limit = ctx.query.limit ? parseInt(ctx.query.limit as string) : 24;
      const page = ctx.query.page ? parseInt(ctx.query.page as string) : 1;
      
      const url = `${CIVITAI_API_BASE_URL}/models`;
      
      const response = await superagent
        .get(url)
        .query({
          limit,
          page,
          sort: 'Most Downloaded',
          period: 'Month',
          nsfw: false
        });
      
      ctx.body = response.body;
    } catch (error) {
      logger.error('Failed to get hot models:', error);
      
      // Add type assertion
      const err = error as SuperAgentError;
      
      if (err.response) {
        ctx.status = err.status || 500;
        ctx.body = {
          error: true,
          message: err.response.body?.message || 'Error occurred while getting hot models'
        };
      } else {
        ctx.status = 500;
        ctx.body = { error: true, message: 'Internal server error' };
      }
    }
  }

  /**
   * Get specific model details
   * @param ctx Koa context object
   */
  async getModelDetails(ctx: Context): Promise<void> {
    try {
      const modelId = ctx.params.id;
      
      if (!modelId) {
        ctx.status = 400;
        ctx.body = {
          error: true,
          message: 'Missing model ID'
        };
        return;
      }
      
      const url = `${CIVITAI_API_BASE_URL}/models/${modelId}`;
      
      const response = await superagent.get(url);
      ctx.body = response.body;
    } catch (error) {
      logger.error('Failed to get model details:', error);
      
      // Add type assertion
      const err = error as SuperAgentError;
      
      if (err.response) {
        const statusCode = err.status || 500;
        const errorMessage = err.response.body?.message || 'Error occurred while getting model details';
        
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
   * Download model file
   * @param ctx Koa context object
   */
  async downloadModel(ctx: Context): Promise<void> {
    try {
      const modelVersionId = ctx.params.versionId;
      
      if (!modelVersionId) {
        ctx.status = 400;
        ctx.body = {
          error: true,
          message: 'Missing model version ID'
        };
        return;
      }
      
      // Use Civitai download API
      const downloadUrl = `${CIVITAI_API_BASE_URL}/download/models/${modelVersionId}`;
      
      // Stream download requires special handling for Koa response
      ctx.body = superagent.get(downloadUrl);
      
      // Headers will be set from response
      ctx.set('Content-Type', 'application/octet-stream');
    } catch (error) {
      logger.error('Failed to download model:', error);
      
      // Add type assertion
      const err = error as SuperAgentError;
      
      if (err.response) {
        const statusCode = err.status || 500;
        const errorMessage = err.response.body?.message || 'Error occurred while downloading model';
        
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
   * Get models using full URL
   */
  async getLatestModelsByUrl(ctx: Context): Promise<void> {
    try {
      const fullUrl = ctx.query.url as string;
      
      if (!fullUrl) {
        ctx.status = 400;
        ctx.body = {
          error: true,
          message: 'Missing URL parameter'
        };
        return;
      }
      
      // Parse URL to extract required parameters
      let parsedUrl;
      try {
        parsedUrl = new URL(fullUrl);
      } catch (error) {
        ctx.status = 400;
        ctx.body = {
          error: true,
          message: 'Invalid URL format'
        };
        return;
      }
      
      // Extract query parameters from URL
      const params = Object.fromEntries(parsedUrl.searchParams.entries());
      
      // Build new request to Civitai API
      const url = `${CIVITAI_API_BASE_URL}/models`;
      
      logger.info(`Requesting next page by parsing parameters: ${JSON.stringify(params)}`);
      
      const response = await superagent
        .get(url)
        .query(params);
      
      ctx.body = response.body;
    } catch (error) {
      logger.error('Failed to get models using full URL:', error);
      
      const err = error as SuperAgentError;
      
      if (err.response) {
        const statusCode = err.status || 500;
        const errorMessage = err.response.body?.message || 'Error occurred while getting models using full URL';
        
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

export default new CivitaiModelsService();
