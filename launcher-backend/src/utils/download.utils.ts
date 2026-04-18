/**
 * 下载相关工具函数
 */
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as logger from '../utils/logger';
import { i18nLogger } from '../utils/logger';
import { DownloadProgress, ModelInfo, DownloadOptions } from '../types/models.types';

// 创建下载进度对象
export function createDownloadProgress(): DownloadProgress {
  return {
    currentModel: null,
    currentModelIndex: 0,
    overallProgress: 0,
    currentModelProgress: 0,
    completed: false,
    error: null,
    downloadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    status: 'downloading'
  };
}

// Timeout configurations
const REQUEST_TIMEOUT = 30000; // 30 seconds for establishing connection
const SOCKET_TIMEOUT = 60000; // 60 seconds for socket idle timeout
const DATA_RECEIVE_TIMEOUT = 120000; // 120 seconds without receiving any data

/** Resolve redirect Location to absolute URL (handles relative paths from mirrors). */
function resolveRedirectUrl(location: string, currentUrl: string): string {
  const trimmed = (location || '').trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return new URL(trimmed, currentUrl).href;
}

// 文件下载函数，支持断点续传
export async function downloadFile(
  url: string, 
  destPath: string, 
  onProgress: (progress: number, downloadedBytes: number, totalBytes: number) => boolean | void,
  options: DownloadOptions,
  progressTracker?: DownloadProgress,
  skipHeadRequest: boolean = false,  // Skip HEAD request when following redirects
  lang?: string  // Language for i18n logging
): Promise<boolean> {
  const logLang = lang || i18nLogger.getLocale();
  i18nLogger.info('download.file.start', { url, destPath, lng: logLang });
  
  // 创建目标目录
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // 创建临时文件路径
  const tempPath = `${destPath}.download`;
  
  // 检查是否存在部分下载的文件
  let startBytes = 0;
  if (fs.existsSync(tempPath)) {
    const stat = fs.statSync(tempPath);
    if (stat.size > 0) {
      startBytes = stat.size;
      i18nLogger.info('download.file.resume_found', { size: startBytes, lng: logLang });
    }
  }
  
  // 初始化进度追踪器
  if (progressTracker) {
    progressTracker.startBytes = startBytes;
    progressTracker.downloadedBytes = startBytes;
    progressTracker.startTime = Date.now();
    progressTracker.lastUpdateTime = Date.now();
    progressTracker.lastBytes = startBytes;
  }
  
  const { abortController } = options;
  
  // 添加中止信号处理 - 检查是否在开始下载前已经取消
  if (abortController?.signal.aborted) {
    i18nLogger.info('download.file.canceled_before_start', { url, lng: logLang });
    return false;
  }
  
  return new Promise((resolve, reject) => {
    // Track last data receive time for idle timeout detection
    let lastDataReceiveTime = Date.now();
    let dataReceiveTimeoutTimer: NodeJS.Timeout | null = null;
    let isRejected = false; // Track if promise is already rejected
    
    // Wrap reject to mark as rejected and prevent multiple rejects
    const safeReject = (error: Error) => {
      if (!isRejected) {
        isRejected = true;
        reject(error);
      }
    };
    
    // Setup data receive timeout monitor
    const startDataReceiveMonitor = () => {
      if (dataReceiveTimeoutTimer) {
        clearTimeout(dataReceiveTimeoutTimer);
      }
      dataReceiveTimeoutTimer = setTimeout(() => {
        const idleTime = Date.now() - lastDataReceiveTime;
        i18nLogger.error('download.file.timeout', { idleTime, timeout: DATA_RECEIVE_TIMEOUT, lng: logLang });
        
        // Mark as rejected to stop processing
        isRejected = true;
        
        // Note: We can't remove listeners here because we don't have access to res yet
        // But isRejected flag will prevent data processing in the data event handler
        reject(new Error(i18nLogger.translate('download.file.timeout', { idleTime, timeout: DATA_RECEIVE_TIMEOUT, lng: logLang })));
      }, DATA_RECEIVE_TIMEOUT);
    };
    
    const updateDataReceiveTime = () => {
      lastDataReceiveTime = Date.now();
      startDataReceiveMonitor();
    };
    
    const clearDataReceiveMonitor = () => {
      if (dataReceiveTimeoutTimer) {
        clearTimeout(dataReceiveTimeoutTimer);
        dataReceiveTimeoutTimer = null;
      }
    };
    
    // Start monitoring
    startDataReceiveMonitor();
    // 在promise内部添加中止事件监听器
    const abortListener = () => {
      i18nLogger.info('download.file.canceled', { url, lng: logLang });
      clearDataReceiveMonitor();
      safeReject(new Error(i18nLogger.translate('download.file.canceled', { url, lng: logLang })));
    };
    
    if (abortController) {
      abortController.signal.addEventListener('abort', abortListener);
    }
    
    const httpClient = url.startsWith('https:') ? https : http;

    // Authorization headers (HF token etc.) forwarded from caller — applied to BOTH
    // the HEAD pre-flight and the GET download so gated URLs resolve on both.
    const authHeaders = options.authHeaders || {};

    // 先发送HEAD请求获取文件大小（除非 skipHeadRequest = true）
    const headOptions = {
      method: 'HEAD',
      headers: { ...authHeaders },
      signal: abortController?.signal,
      timeout: REQUEST_TIMEOUT
    };
    
    i18nLogger.info('download.file.head_request', { url, lng: logLang });
    
    const headReq = httpClient.request(url, headOptions, (headRes) => {
      // Update data receive time on HEAD response
      updateDataReceiveTime();
      // 从HEAD响应中获取文件大小
      let totalBytes = 0;
      
      // 处理重定向
      if (headRes.statusCode && (headRes.statusCode === 301 || headRes.statusCode === 302 || headRes.statusCode === 303 || headRes.statusCode === 307 || headRes.statusCode === 308)) {
        const location = headRes.headers.location;
        if (!location) {
          safeReject(new Error(`收到重定向状态码 ${headRes.statusCode} 但没有 location 头`));
          return;
        }
        
        // 记录日志
        i18nLogger.info('download.file.head_redirected', { location, lng: logLang });
        const resolvedLocation = resolveRedirectUrl(location, url);
        
        // 释放当前响应
        headRes.resume();
        
        // 对重定向地址发送新的HEAD请求
        headRes.on('end', () => {
          try {
            // 创建针对重定向地址的新HEAD请求
            const redirectHeadReq = httpClient.request(resolvedLocation, headOptions, (redirectHeadRes) => {
              let redirectTotalBytes = 0;
              
              // 处理重定向响应
              if (redirectHeadRes.headers['content-length']) {
                redirectTotalBytes = parseInt(redirectHeadRes.headers['content-length'] as string, 10);
                i18nLogger.info('download.file.redirect_size', { size: redirectTotalBytes, lng: logLang });
                
                // 更新总字节数
                totalBytes = redirectTotalBytes;
                if (progressTracker) progressTracker.totalBytes = totalBytes;
                
                // 断点续传逻辑：比较实际下载的字节与文件总大小
                // Pass the redirected URL so GET request uses it directly
                continueFetchFile(totalBytes, resolvedLocation);
              } else {
                // 如果没有content-length，可能无法确定文件大小，默认继续下载
                i18nLogger.warn('download.file.redirect_no_size', { lng: logLang });
                continueFetchFile(0);
              }
            });
            
            redirectHeadReq.on('error', (err) => {
              i18nLogger.error('download.file.redirect_head_error', { message: err.message, lng: logLang });
              // 出错时仍尝试下载文件
              continueFetchFile(0);
            });
            
            redirectHeadReq.end();
          } catch (err) {
            i18nLogger.error('download.file.redirect_error', { message: err instanceof Error ? err.message : String(err), lng: logLang });
            // 发生错误时，尝试继续下载
            continueFetchFile(0);
          }
        });
        return;
      }
      
      if (headRes.headers['content-length']) {
        totalBytes = parseInt(headRes.headers['content-length'] as string, 10);
        i18nLogger.info('download.file.size_obtained', { size: totalBytes, lng: logLang });
        if (progressTracker) progressTracker.totalBytes = totalBytes;
      }
      
      // 必须消费响应数据以触发'end'事件
      headRes.resume();
      
      // 在响应结束时调用继续下载逻辑，而不是立即调用
      headRes.on('end', () => {
        // 调用统一的继续下载逻辑
        continueFetchFile(totalBytes);
      });
    });
    
    // If skipHeadRequest is true, skip HEAD and go directly to GET
    // This is used when following redirects to avoid unnecessary HEAD requests
    if (skipHeadRequest) {
      i18nLogger.info('download.file.skip_head', { lng: logLang });
      // Get total bytes from progressTracker if available
      const totalBytes = progressTracker?.totalBytes || 0;
      continueFetchFile(totalBytes, url);  // Use url directly as it's already the redirected URL
    } else {
      // Send HEAD request normally
      // 添加HEAD请求错误处理，避免请求挂起
      headReq.on('error', (err) => {
        i18nLogger.error('download.file.head_error', { message: err.message, lng: logLang });
        // 出错时仍尝试下载文件
        continueFetchFile(0);
      });
      
      // Add HEAD request timeout handler
      headReq.on('timeout', () => {
        i18nLogger.error('download.file.head_timeout', { timeout: REQUEST_TIMEOUT, lng: logLang });
        headReq.destroy();
        // Try to continue with download even if HEAD fails
        continueFetchFile(0);
      });
      
      // 确保HEAD请求结束
      headReq.end();
    }
    
    // 统一处理是继续下载还是跳过的逻辑
    function continueFetchFile(totalBytes: number, finalUrl?: string) {
      // Use the final URL (after redirect) if provided, otherwise use original URL
      const downloadUrl = finalUrl || url;
      // 只有在以下情况下才跳过下载：
      // 1. 有明确的文件大小（totalBytes > 0）
      // 2. 已下载的部分(startBytes)等于或超过总大小
      // 3. 总大小不是太小（避免比较无效的重定向响应大小）
      if (totalBytes > 1000000 && startBytes >= totalBytes) {  // 至少1MB才可信
        i18nLogger.info('download.file.already_complete', { downloaded: startBytes, total: totalBytes, lng: logLang });
        
        // 重命名临时文件为最终文件
        if (fs.existsSync(tempPath)) {
          fs.renameSync(tempPath, destPath);
          i18nLogger.info('download.file.renamed', { from: tempPath, to: destPath, lng: logLang });
        }
        
        // 设置进度为100%并完成
        if (progressTracker) {
          progressTracker.currentModelProgress = 100;
          progressTracker.overallProgress = 100;
          progressTracker.totalBytes = totalBytes;
          progressTracker.downloadedBytes = totalBytes;
          progressTracker.completed = true;
        }
        
        onProgress(100, totalBytes, totalBytes);
        resolve(true);
        return;
      }
      
      // 如果文件大小不明确或部分下载未完成，继续下载过程
      i18nLogger.info('download.file.continue', { downloaded: startBytes, total: totalBytes || 0, lng: logLang });
      
      // 继续常规下载过程
      const requestOptions: {
        method: string;
        headers: Record<string, string>;
        signal?: AbortSignal;
        timeout?: number;
      } = {
        method: 'GET',
        headers: { ...authHeaders },
        signal: abortController?.signal,
        timeout: REQUEST_TIMEOUT
      };
      
      // 添加Range头用于断点续传
      if (startBytes > 0) {
        requestOptions.headers!['Range'] = `bytes=${startBytes}-`;
        i18nLogger.info('download.file.resume_set', { range: requestOptions.headers!['Range'], lng: logLang });
      }
      
      i18nLogger.info('download.file.prepare_request', { url: downloadUrl, lng: logLang });
      
      // Use the downloadUrl (which may be the redirected URL) instead of original url
      const httpClientForDownload = downloadUrl.startsWith('https:') ? https : http;
      const req = httpClientForDownload.request(downloadUrl, requestOptions, (res) => {
        i18nLogger.info('download.file.response_received', { statusCode: res.statusCode, lng: logLang });
        
        // Update data receive time on response received
        updateDataReceiveTime();
        
        // Set socket timeout for idle detection
        if (res.socket) {
          res.socket.setTimeout(SOCKET_TIMEOUT);
          res.socket.on('timeout', () => {
            i18nLogger.error('download.file.socket_timeout', { timeout: SOCKET_TIMEOUT, lng: logLang });
            
            // IMPORTANT: Mark as rejected FIRST to stop processing any queued data events
            isRejected = true;
            
            // Remove all event listeners to prevent further events
            res.removeAllListeners('data');
            res.removeAllListeners('end');
            res.removeAllListeners('error');
            
            // Destroy the socket first to stop data flow
            if (res.socket) {
              res.socket.destroy();
            }
            // Destroy the request
            req.destroy();
            // Clear data receive monitor
            clearDataReceiveMonitor();
            // Reject the promise
            reject(new Error(`Socket timeout: No activity for ${SOCKET_TIMEOUT}ms`));
          });
        }
        
        // 处理416错误 - 表示已经下载完全
        if (res.statusCode === 416) {
          i18nLogger.info('download.file.status_416', { lng: logLang });
          
          // 重命名临时文件为最终文件
          if (fs.existsSync(tempPath)) {
            fs.renameSync(tempPath, destPath);
            i18nLogger.info('download.file.renamed', { from: tempPath, to: destPath, lng: logLang });
          }
          
          // 设置进度为100%并完成
          if (progressTracker) {
            progressTracker.currentModelProgress = 100;
            progressTracker.overallProgress = 100;
            progressTracker.totalBytes = startBytes;
            progressTracker.downloadedBytes = startBytes;
            progressTracker.completed = true;
          }
          
          onProgress(100, startBytes, startBytes);
          resolve(true);
          return;
        }
        
        // 处理重定向
        // IMPORTANT: If HEAD redirected and we used the final URL, GET should NOT redirect
        // If GET still redirects, it might be a different URL (e.g. expired token)
        if (res.statusCode && (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308)) {
          const location = res.headers.location;
          if (!location) {
            safeReject(new Error(`收到重定向状态码 ${res.statusCode} 但没有 location 头`));
            return;
          }
          
          // Log redirect info
          if (downloadUrl !== url) {
            i18nLogger.warn('download.file.get_redirect_chain', { originalUrl: url.substring(0, 80), headRedirect: downloadUrl.substring(0, 80), getRedirect: location.substring(0, 80), lng: logLang });
          } else {
            i18nLogger.info('download.file.get_redirected', { location: location.substring(0, 100), lng: logLang });
          }
          
          const resolvedLocation = resolveRedirectUrl(location, downloadUrl);
          
          // Destroy current request and response immediately
          req.destroy();
          res.resume();
          
          // DON'T wait for 'end' event - redirect should be handled immediately
          // DON'T recursively call downloadFile - it will send HEAD again (wasteful and may timeout!)
          // Instead, send GET request directly in the SAME Promise context
          
          i18nLogger.info('download.file.direct_get_redirect', { lng: logLang });
          
          // Create new GET request to redirected URL
          const redirectHttpClient = resolvedLocation.startsWith('https:') ? https : http;
          const redirectOptions = {
            ...requestOptions,
            timeout: REQUEST_TIMEOUT
          };
          
          const redirectReq = redirectHttpClient.request(resolvedLocation, redirectOptions, (redirectRes) => {
            // This redirectRes is the new response - reuse the same handling logic below
            // by assigning it to 'res' and continuing
            // But we can't reassign 'res' in this scope...
            
            // For now, we have to recursively call but this is not ideal
            // TODO: Refactor to avoid recursive calls
          });
          
          // Recursively call downloadFile with skipHeadRequest=true
          // This avoids sending another HEAD request which is wasteful and may timeout
          i18nLogger.info('download.file.follow_redirect', { lng: logLang });
          
          try {
            downloadFile(
              resolvedLocation,       // Redirected URL (absolute)
              destPath, 
              onProgress, 
              options, 
              progressTracker,
              true,                   // ← skipHeadRequest = true (避免重新发HEAD)
              logLang                 // Pass language parameter
            ).then(resolve).catch(safeReject);
          } catch (err) {
            safeReject(err as Error);
          }
          
          return;
        }
        
        // 处理其他错误状态码
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          const error = new Error(`HTTP 错误状态码: ${res.statusCode}`);
          safeReject(error);
          return;
        }
        
        // 提取总文件大小
        let totalBytes = progressTracker?.totalBytes || 0;
        
        // 处理Content-Length
        if (res.headers['content-length']) {
          const contentLength = parseInt(res.headers['content-length'] as string, 10);
          if (!isNaN(contentLength)) {
            if (startBytes > 0 && res.statusCode === 206) {
              totalBytes = startBytes + contentLength;
              i18nLogger.info('download.file.resume_206', { total: totalBytes, downloaded: startBytes, contentLength, lng: logLang });
            } else {
              totalBytes = contentLength;
              i18nLogger.info('download.file.normal_download', { size: contentLength, lng: logLang });
            }
            if (progressTracker) progressTracker.totalBytes = totalBytes;
          }
        }
        
        // 处理Content-Range
        const rangeHeader = res.headers['content-range'];
        if (typeof rangeHeader === 'string') {
          const match = rangeHeader.match(/bytes\s+\d+-\d+\/(\d+)/);
          if (match && match[1]) {
            totalBytes = parseInt(match[1], 10);
            if (progressTracker) progressTracker.totalBytes = totalBytes;
            i18nLogger.info('download.file.content_range_size', { size: totalBytes, lng: logLang });
          }
        }
        
        // 处理数据下载
        let downloadedBytes = startBytes;
        let fileStream: fs.WriteStream | null = null;
        
        try {
          // 创建文件写入流
          fileStream = fs.createWriteStream(tempPath, { flags: startBytes > 0 ? 'a' : 'w' });
          
          // 关闭请求和文件流的辅助函数
          const cleanup = () => {
            // Remove event listeners first to prevent further processing
            res.removeAllListeners('data');
            res.removeAllListeners('end');
            res.removeAllListeners('error');
            
            if (fileStream) {
              fileStream.end();
              fileStream = null;
            }
            // Clear data receive monitor
            clearDataReceiveMonitor();
            // 移除中止事件监听器
            if (abortController) {
              abortController.signal.removeEventListener('abort', abortListener);
            }
          };
          
          res.on('data', (chunk) => {
            // Check if already rejected/completed before processing
            if (isRejected) {
              i18nLogger.debug('download.file.ignore_data_after_rejection', { url, lng: logLang });
              return;
            }
            
            // Update data receive time on every data chunk
            updateDataReceiveTime();
            
            // 先检查是否已中止
            if (abortController?.signal.aborted) {
              i18nLogger.info('download.file.abort_during', { url, lng: logLang });
              cleanup();
              safeReject(new Error(i18nLogger.translate('download.file.canceled', { url, lng: logLang })));
              return;
            }
            
            // 写入数据到文件
            if (fileStream) {
              fileStream.write(chunk);
            }
            
            // 更新下载统计
            downloadedBytes += chunk.length;
            if (progressTracker) progressTracker.downloadedBytes = downloadedBytes;
            
            // 计算进度
            const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
            if (progressTracker) {
              progressTracker.currentModelProgress = percent;
              progressTracker.overallProgress = percent;
            }
            
            // 计算下载速度
            const now = Date.now();
            const timeDiff = (now - (progressTracker?.lastUpdateTime || progressTracker?.startTime || now)) / 1000;
            
            if (timeDiff >= 0.5 && progressTracker) {
              const bytesDiff = downloadedBytes - (progressTracker.lastBytes || startBytes);
              
              if (bytesDiff > 0 && timeDiff > 0) {
                progressTracker.speed = Math.round(bytesDiff / timeDiff);
                i18nLogger.info('download.file.progress', { percent, speed: progressTracker.speed, downloaded: downloadedBytes, total: totalBytes, lng: logLang });
              }
              
              progressTracker.lastUpdateTime = now;
              progressTracker.lastBytes = downloadedBytes;
            }
            
            // Double check isRejected before calling external callbacks
            if (isRejected) {
              i18nLogger.debug('download.file.skip_progress_after_rejection', { url, lng: logLang });
              return;
            }
            
            // 调用进度回调
            const shouldContinue = onProgress(percent, downloadedBytes, totalBytes);
            if (shouldContinue === false) {
              // 如果回调返回false，则停止下载
              i18nLogger.info('download.file.canceled_by_callback', { url, lng: logLang });
              req.destroy();  // 主动销毁请求
              cleanup();
              safeReject(new Error(i18nLogger.translate('download.file.canceled', { url, lng: logLang })));
              return;
            }
          });
          
          // 不再使用pipe，而是手动管理流
          res.on('end', () => {
            if (abortController?.signal.aborted || isRejected) {
              i18nLogger.info('download.file.abort_at_end', { url, lng: logLang });
              cleanup();
              safeReject(new Error(i18nLogger.translate('download.file.canceled', { url, lng: logLang })));
              return;
            }
            
            i18nLogger.info('download.file.completed', { url, size: downloadedBytes, lng: logLang });
            
            // 添加此处：重命名临时文件为最终文件
            if (fs.existsSync(tempPath)) {
              try {
                fs.renameSync(tempPath, destPath);
                i18nLogger.info('download.file.renamed', { from: tempPath, to: destPath, lng: logLang });
              } catch (err) {
                i18nLogger.error('download.file.rename_failed', { message: err instanceof Error ? err.message : String(err), lng: logLang });
              }
            }
            
            cleanup();
            resolve(true);
          });
          
          res.on('error', (err) => {
            i18nLogger.error('download.file.response_error', { message: err.message, lng: logLang });
            cleanup();
            safeReject(err);
          });
          
        } catch (err) {
          i18nLogger.error('download.file.process_error', { message: err instanceof Error ? err.message : String(err), lng: logLang });
          if (fileStream) {
            fileStream.end();
          }
          safeReject(err as Error);
        }
      });
      
      // 请求错误处理
      req.on('error', (err) => {
        clearDataReceiveMonitor();
        // 检查是否是中止导致的错误
        if (abortController?.signal.aborted) {
          i18nLogger.info('download.file.get_canceled', { url: url.substring(0, 100), lng: logLang });
          safeReject(new Error(i18nLogger.translate('download.file.canceled', { url, lng: logLang })));
        } else {
          i18nLogger.error('download.file.get_error', { message: err.message, lng: logLang });
          safeReject(err);
        }
      });
      
      // Add request timeout handler
      req.on('timeout', () => {
        i18nLogger.error('download.file.request_timeout', { timeout: REQUEST_TIMEOUT, lng: logLang });
        clearDataReceiveMonitor();
        req.destroy();
        safeReject(new Error(i18nLogger.translate('download.file.request_timeout', { timeout: REQUEST_TIMEOUT, lng: logLang })));
      });
      
      // 结束请求
      req.end();
    }
  });
}

// 获取下载速度
export function calculateSpeed(bytesDownloaded: number, startTime: number): number {
  const elapsedSeconds = (Date.now() - startTime) / 1000;
  return elapsedSeconds > 0 ? bytesDownloaded / elapsedSeconds : 0;
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 实现下载模型队列取消机制
export async function downloadModels(models: ModelInfo[], options: DownloadOptions): Promise<void> {
  let aborted = false;
  
  // 在downloadModels级别添加对中止信号的检查
  const logLang = i18nLogger.getLocale();
  const abortHandler = () => {
    aborted = true;
    i18nLogger.info('download.models.global_abort', { lng: logLang });
  };
  
  // 添加中止事件监听器
  options.abortController.signal.addEventListener('abort', abortHandler);
  
  try {
    // 遍历模型列表
    for (let i = 0; i < models.length; i++) {
      // 每次循环开始时检查是否已中止
      if (aborted || options.abortController.signal.aborted) {
        i18nLogger.info('download.models.stopped', { remaining: models.length - i, lng: logLang });
        break; // 如果中止了，停止循环
      }
      
      const model = models[i];
      // ... 现有的下载单个模型的代码 ...
    }
  } finally {
    // 清理：移除事件监听器
    options.abortController.signal.removeEventListener('abort', abortHandler);
  }
} 