import * as http from 'http';
import httpProxy from 'http-proxy';
import { config } from '../../config';
import { isComfyUIRunning } from './utils';
import { getNotRunningHtml } from './html-generator';
import { i18nLogger } from '../../utils/logger';

// Create proxy server
export const createComfyUIProxy = () => {
  const proxy = httpProxy.createProxyServer({
    target: `http://localhost:${config.comfyui.port}`,
    ws: true,
  });
  
  // Add error handling
  proxy.on('error', (err, req, res) => {
    const logLang = i18nLogger.getLocale();
    i18nLogger.error('comfyui.proxy.error', { message: err instanceof Error ? err.message : String(err), lng: logLang });
    if (res && 'writeHead' in res) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('代理请求出错');
    }
  });
  
  const server = http.createServer(async (req, res) => {
    const comfyRunning = await isComfyUIRunning();
    
    if (comfyRunning) {
      proxy.web(req, res);
    } else {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getNotRunningHtml());
    }
  });
  
  // Handle WebSocket connections
  server.on('upgrade', async (req, socket, head) => {
    const comfyRunning = await isComfyUIRunning();
    
    if (comfyRunning) {
      proxy.ws(req, socket, head);
    } else {
      socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    }
  });
  
  return server;
};
