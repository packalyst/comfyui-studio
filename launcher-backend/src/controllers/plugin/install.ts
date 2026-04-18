import { v4 as uuidv4 } from 'uuid';
import superagent from 'superagent';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import * as util from 'util';
import * as os from 'os';
import * as zlib from 'zlib';
import logger from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';
import * as TOML from '@iarna/toml';
import { SystemController } from '../system/system.controller';
import { PluginHistoryManager, PluginOperationHistory } from './history';

// 将exec转换为Promise
const execPromise = util.promisify(exec);

// 确定环境和路径
const isDev = process.env.NODE_ENV !== 'production';

// 在开发环境中使用当前目录，生产环境使用配置路径
const COMFYUI_PATH = process.env.COMFYUI_PATH || 
  (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');

const CUSTOM_NODES_PATH = path.join(COMFYUI_PATH, 'custom_nodes');

// 添加代理URL作为备用方案
async function fetchWithFallback(url: string) {
  try {
    // 首先尝试直接获取
    const response = await superagent.get(url).timeout({ response: 5000, deadline: 15000 });
    return response;  // 返回完整的 response 对象，而不仅仅是 body
  } catch (error) {
    i18nLogger.info('plugin.install.fetch_fallback', { url, lng: i18nLogger.getLocale() });
    
    // 如果直接获取失败，尝试使用gh-proxy代理
    const proxyUrl = `https://gh-proxy.com/${url}`;
    const proxyResponse = await superagent.get(proxyUrl);
    return proxyResponse;  // 返回完整的 response 对象
  }
}

// 获取CDN URL前缀
function getCdnUrlPrefix(): string {
  return process.env.DOWNLOAD_CDN_URL || '';
}

// 下载并解压release包
async function downloadAndExtractRelease(
  downloadUrl: string, 
  targetDir: string, 
  taskId: string,
  logOperation: (taskId: string, message: string) => void
): Promise<void> {
  try {
    // 确保目标目录存在
    fs.mkdirSync(targetDir, { recursive: true });
    
    // 构建完整的下载URL
    const cdnPrefix = getCdnUrlPrefix();
    let fullDownloadUrl = downloadUrl;
    
    if (!downloadUrl.startsWith('http')) {
      if (cdnPrefix) {
        fullDownloadUrl = `${cdnPrefix}${downloadUrl}`;
      } else {
        throw new Error('下载地址无效：既不是完整的HTTP URL，也没有配置CDN前缀');
      }
    }
    
    logOperation(taskId, `开始下载release包: ${fullDownloadUrl}`);
    
    // 下载文件
    const response = await superagent.get(fullDownloadUrl).timeout({ response: 30000, deadline: 60000 });
    
    // 创建临时文件
    const tempZipPath = path.join(os.tmpdir(), `plugin_${taskId}_${Date.now()}.zip`);
    fs.writeFileSync(tempZipPath, response.body);
    
    logOperation(taskId, `下载完成，开始解压到: ${targetDir}`);
    
    // 解压文件
    await extractZipFile(tempZipPath, targetDir, taskId, logOperation);
    
    // 清理临时文件
    fs.unlinkSync(tempZipPath);
    
    logOperation(taskId, 'Release包解压完成');
  } catch (error) {
    logOperation(taskId, `下载或解压release包失败: ${error}`);
    throw error;
  }
}

// 解压ZIP文件
async function extractZipFile(
  zipPath: string, 
  targetDir: string, 
  taskId: string,
  logOperation: (taskId: string, message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const AdmZip = require('adm-zip');
    
    try {
      const zip = new AdmZip(zipPath);
      const entries = zip.getEntries();
      
      logOperation(taskId, `找到 ${entries.length} 个文件需要解压`);
      
      // 解压所有文件
      zip.extractAllTo(targetDir, true);
      
      logOperation(taskId, '文件解压完成');
      resolve();
    } catch (error) {
      logOperation(taskId, `解压失败: ${error}`);
      reject(error);
    }
  });
}

// 比较版本号的辅助函数
function compareVersions(version1: string, version2: string): number {
  const v1Parts = version1.split('.').map(Number);
  const v2Parts = version2.split('.').map(Number);
  
  const maxLength = Math.max(v1Parts.length, v2Parts.length);
  
  for (let i = 0; i < maxLength; i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;
    
    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }
  
  return 0;
}

// 获取插件的最新版本信息
function getLatestVersionInfo(pluginInfo: any): { version: string, downloadUrl?: string } | null {
  // 优先使用latest_version
  if (pluginInfo.latest_version) {
    return {
      version: pluginInfo.latest_version.version,
      downloadUrl: pluginInfo.latest_version.downloadUrl
    };
  }
  
  // 如果没有latest_version，从versions数组中找最新的
  if (pluginInfo.versions && Array.isArray(pluginInfo.versions) && pluginInfo.versions.length > 0) {
    // 过滤出有效的版本
    const validVersions = pluginInfo.versions.filter((v: any) => 
      !v.deprecated && 
      v.status === 'NodeVersionStatusActive' && 
      v.version && 
      v.downloadUrl
    );
    
    if (validVersions.length === 0) {
      return null;
    }
    
    // 按版本号排序，获取最新的版本
    const sortedVersions = validVersions.sort((a: any, b: any) => 
      compareVersions(b.version, a.version) // 降序排列，最新的在前
    );
    
    return {
      version: sortedVersions[0].version,
      downloadUrl: sortedVersions[0].downloadUrl
    };
  }
  
  return null;
}

// 获取系统控制器单例
const systemController = new SystemController();

export class PluginInstallManager {
  private historyManager: PluginHistoryManager;
  private progressManager?: any; // 进度管理器实例
  private cacheManager?: any; // 缓存管理器实例

  constructor(historyManager: PluginHistoryManager, progressManager?: any, cacheManager?: any) {
    this.historyManager = historyManager;
    this.progressManager = progressManager;
    this.cacheManager = cacheManager;
  }

  // 安装插件
  async installPlugin(ctx: any, pluginId: string, githubProxy?: string, pluginInfo?: any): Promise<string> {
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('plugin.install.request', { pluginId, lng: logLang });
    
    const taskId = uuidv4();
    
    // 从系统控制器获取 GitHub 代理配置
    const systemEnvConfig = systemController['environmentConfigurator']?.envConfig || {};
    const systemGithubProxy = systemEnvConfig.GITHUB_PROXY || process.env.GITHUB_PROXY || '';
    
    // 确定实际使用的代理:
    // 1. 如果系统配置的代理是 github.com，不使用代理
    // 2. 否则优先使用系统配置的代理，如果没有则使用客户端提供的代理
    let actualGithubProxy = '';
    if (systemGithubProxy && systemGithubProxy !== 'https://github.com') {
      actualGithubProxy = systemGithubProxy;
      i18nLogger.info('plugin.install.use_system_proxy', { proxy: actualGithubProxy, lng: logLang });
    } else if (githubProxy) {
      actualGithubProxy = githubProxy;
      i18nLogger.info('plugin.install.use_client_proxy', { proxy: actualGithubProxy, lng: logLang });
    } else {
      i18nLogger.info('plugin.install.no_proxy', { lng: logLang });
    }
    
    // 添加到历史记录
    this.historyManager.addHistoryItem(taskId, pluginId, 'install', actualGithubProxy);
    
    // 实际安装插件任务
    this.installPluginTask(taskId, pluginId, actualGithubProxy, pluginInfo);
    
    return taskId;
  }

  // 实际安装插件任务
  private async installPluginTask(taskId: string, pluginId: string, githubProxy: string, pluginInfo?: any): Promise<void> {
    try {
      // 更新进度
      this.logOperation(taskId, '正在查找插件信息...');
      
      
      if (!pluginInfo) {
        this.logOperation(taskId, `未找到插件: ${pluginId}`);
        throw new Error(`未找到插件: ${pluginId}`);
      }

      this.logOperation(taskId, `找到插件: ${JSON.stringify(pluginInfo)}`);
      i18nLogger.info('plugin.install.found_plugin', { pluginInfo: JSON.stringify(pluginInfo), lng: i18nLogger.getLocale() });

      this.logOperation(taskId, '准备安装...');
      
      // 确定安装方法
      const installType = pluginInfo.install_type || 'git_clone';
      
      // 确定安装路径
      const targetDir = path.join(CUSTOM_NODES_PATH, pluginId);
      
      // 检查目录是否已存在
      if (fs.existsSync(targetDir)) {
        // 如果存在，备份并删除
        this.logOperation(taskId, '检测到已有安装，正在备份...');
        const backupDir = `${targetDir}_backup_${Date.now()}`;
        fs.renameSync(targetDir, backupDir);
        this.logOperation(taskId, `已将现有目录备份到: ${backupDir}`);
      }
      
      this.logOperation(taskId, '正在下载插件...');
      
      // 检查插件是否可用
      if (pluginInfo.deprecated || pluginInfo.status === 'NodeStatusBanned' || 
          (pluginInfo.latest_version && pluginInfo.latest_version.deprecated) ||
          (pluginInfo.latest_version && pluginInfo.latest_version.status === 'NodeVersionStatusBanned')) {
        this.logOperation(taskId, '插件已被弃用或封禁，无法安装');
        throw new Error('插件已被弃用或封禁，无法安装');
      }
      
      // 根据安装类型执行安装
      if ((installType === 'git_clone' || installType === 'git-clone') && (pluginInfo.github || pluginInfo.repository)) {
        // 优先尝试release包下载
        const versionInfo = getLatestVersionInfo(pluginInfo);
        let installSuccess = false;
        
        if (versionInfo && versionInfo.downloadUrl) {
          try {
            this.logOperation(taskId, `尝试使用release包安装 (版本: ${versionInfo.version})`);
            await downloadAndExtractRelease(versionInfo.downloadUrl, targetDir, taskId, this.logOperation.bind(this));
            installSuccess = true;
            this.logOperation(taskId, 'Release包安装成功');
          } catch (releaseError) {
            this.logOperation(taskId, `Release包安装失败，回退到Git安装: ${releaseError}`);
            // 日志已通过 logOperation 记录，这里不再重复记录
          }
        }
        
        // 如果release包安装失败或没有release包，使用git clone
        if (!installSuccess) {
          const githubUrl = pluginInfo.repository || pluginInfo.github;
          try {
            const proxyUrl = this.applyGitHubProxy(githubUrl, githubProxy);
            this.logOperation(taskId, `执行: git clone "${proxyUrl}" "${targetDir}"`);
            const { stdout, stderr } = await execPromise(`git clone "${proxyUrl}" "${targetDir}"`);
            if (stdout) this.logOperation(taskId, `Git输出: ${stdout}`);
            if (stderr) this.logOperation(taskId, `Git错误: ${stderr}`);
            
            // 如果通过git安装，需要检出对应版本
            if (versionInfo && versionInfo.version) {
              this.logOperation(taskId, `检出版本: ${versionInfo.version}`);
              try {
                const { stdout: checkoutStdout, stderr: checkoutStderr } = await execPromise(
                  `cd "${targetDir}" && git checkout ${versionInfo.version}`
                );
                if (checkoutStdout) this.logOperation(taskId, `检出输出: ${checkoutStdout}`);
                if (checkoutStderr) this.logOperation(taskId, `检出错误: ${checkoutStderr}`);
              } catch (checkoutError) {
                this.logOperation(taskId, `检出版本失败，使用主分支: ${checkoutError}`);
                // 如果检出特定版本失败，继续使用主分支
              }
            }
          } catch (cloneError) {
            this.logOperation(taskId, `Git克隆失败: ${cloneError}`);
            i18nLogger.error('plugin.install.git_clone_failed', { message: cloneError instanceof Error ? cloneError.message : String(cloneError), lng: i18nLogger.getLocale() });
            
            // 尝试使用HTTPS替代可能的SSH或HTTP2
            const convertedUrl = githubUrl
              .replace('git@github.com:', 'https://github.com/')
              .replace(/\.git$/, '');
            
            const proxyConvertedUrl = this.applyGitHubProxy(convertedUrl, githubProxy);
            this.logOperation(taskId, `尝试备用方式: git clone "${proxyConvertedUrl}" "${targetDir}"`);
            
            try {
              const { stdout, stderr } = await execPromise(`git clone "${proxyConvertedUrl}" "${targetDir}"`);
              if (stdout) this.logOperation(taskId, `Git输出: ${stdout}`);
              if (stderr) this.logOperation(taskId, `Git错误: ${stderr}`);
              
              // 如果通过git安装，需要检出对应版本
              if (versionInfo && versionInfo.version) {
                this.logOperation(taskId, `检出版本: ${versionInfo.version}`);
                try {
                  const { stdout: checkoutStdout, stderr: checkoutStderr } = await execPromise(
                    `cd "${targetDir}" && git checkout ${versionInfo.version}`
                  );
                  if (checkoutStdout) this.logOperation(taskId, `检出输出: ${checkoutStdout}`);
                  if (checkoutStderr) this.logOperation(taskId, `检出错误: ${checkoutStderr}`);
                } catch (checkoutError) {
                  this.logOperation(taskId, `检出版本失败，使用主分支: ${checkoutError}`);
                  // 如果检出特定版本失败，继续使用主分支
                }
              }
            } catch (retryError) {
              this.logOperation(taskId, `备用方式也失败: ${retryError}`);
              throw new Error(`git克隆失败: ${cloneError instanceof Error ? cloneError.message : String(cloneError)}. 备用方式也失败: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
            }
          }
        }
      } else if (installType === 'copy' && Array.isArray(pluginInfo.files)) {
        // 创建目标目录
        fs.mkdirSync(targetDir, { recursive: true });
        this.logOperation(taskId, `创建目录: ${targetDir}`);
        
        // 依次下载文件
        for (const file of pluginInfo.files) {
          const fileName = path.basename(file);
          this.logOperation(taskId, `下载文件: ${file}`);
          const response = await superagent.get(file);
          const targetPath = path.join(targetDir, fileName);
          fs.writeFileSync(targetPath, response.text);
          this.logOperation(taskId, `文件已保存到: ${targetPath}`);
        }
      } else {
        this.logOperation(taskId, `不支持的安装类型: ${installType}`);
        throw new Error(`不支持的安装类型: ${installType}`);
      }
      
      // 安装依赖
      // 在开发环境下跳过依赖安装
      if (isDev) {
        this.logOperation(taskId, '开发环境：跳过依赖安装');
        i18nLogger.info('plugin.install.skip_deps_dev', { lng: i18nLogger.getLocale() });
      } else {
        this.logOperation(taskId, '检查依赖文件...');
        
        const requirementsPath = path.join(targetDir, 'requirements.txt');
        if (fs.existsSync(requirementsPath)) {
          this.logOperation(taskId, `发现requirements.txt，执行: pip install --user -r "${requirementsPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`pip install --user -r "${requirementsPath}"`);
            if (stdout) this.logOperation(taskId, `依赖安装输出: ${stdout}`);
            if (stderr) this.logOperation(taskId, `依赖安装警告: ${stderr}`);
          } catch (pipError) {
            this.logOperation(taskId, `依赖安装失败，但继续安装流程: ${pipError}`);
          }
        } else {
          this.logOperation(taskId, '未找到requirements.txt文件');
        }
        
        // 执行安装脚本
        const installScriptPath = path.join(targetDir, 'install.py');
        if (fs.existsSync(installScriptPath)) {
          this.logOperation(taskId, `发现install.py，执行: cd "${targetDir}" && python3 "${installScriptPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`cd "${targetDir}" && python3 "${installScriptPath}"`);
            if (stdout) this.logOperation(taskId, `安装脚本输出: ${stdout}`);
            if (stderr) this.logOperation(taskId, `安装脚本警告: ${stderr}`);
          } catch (scriptError) {
            this.logOperation(taskId, `安装脚本执行失败，但继续安装流程: ${scriptError}`);
          }
        } else {
          this.logOperation(taskId, '未找到install.py脚本');
        }
      }
      
      // 完成安装
      const now = new Date();
      const successMessage = `安装完成于 ${now.toLocaleString()}`;
      this.logOperation(taskId, successMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'success',
        result: successMessage
      });
      
      // 更新进度管理器 - 标记任务完成
      const logLang = i18nLogger.getLocale();
      if (this.progressManager) {
        this.progressManager.completeTask(taskId, true, successMessage);
        i18nLogger.info('plugin.install.success', { taskId, lng: logLang });
      }
      
      // 清除插件缓存，确保下次获取时重新计算状态
      if (this.cacheManager) {
        await this.cacheManager.clearPluginCache(pluginId);
        i18nLogger.info('plugin.install.cache_cleared', { pluginId, lng: logLang });
        try {
          await this.cacheManager.refreshInstalledPlugins();
          i18nLogger.info('plugin.install.refresh_after_install', { pluginId, lng: logLang });
        } catch (e) {
          i18nLogger.error('plugin.install.refresh_failed', { message: e instanceof Error ? e.message : String(e), lng: logLang });
        }
      }
      
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.install.failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      const errorMessage = `安装失败: ${error instanceof Error ? error.message : '未知错误'}`;
      this.logOperation(taskId, errorMessage);
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'failed',
        result: errorMessage
      });
      
      // 更新进度管理器 - 标记任务失败
      if (this.progressManager) {
        this.progressManager.completeTask(taskId, false, errorMessage);
        i18nLogger.info('plugin.install.failed_task', { taskId, lng: logLang });
      }
      
      // 清理可能部分创建的目录
      const targetDir = path.join(CUSTOM_NODES_PATH, pluginId);
      if (fs.existsSync(targetDir)) {
        try {
          // 直接删除失败的安装目录
          await fs.promises.rm(targetDir, { recursive: true, force: true });
          this.logOperation(taskId, `已删除失败的安装目录: ${targetDir}`);
          i18nLogger.info('plugin.install.cleanup_failed_dir', { path: targetDir, lng: logLang });
        } catch (cleanupError) {
          this.logOperation(taskId, `清理失败的安装目录失败: ${cleanupError}`);
          i18nLogger.error('plugin.install.cleanup_failed', { message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), lng: logLang });
        }
      }
      // 无论成功失败，都刷新一次本地插件列表，确保前端读取的是最新的 pyproject 信息
      if (this.cacheManager) {
        try {
          await this.cacheManager.refreshInstalledPlugins();
          i18nLogger.info('plugin.install.refresh_after_flow', { lng: logLang });
        } catch (e) {
          i18nLogger.error('plugin.install.refresh_after_flow_failed', { message: e instanceof Error ? e.message : String(e), lng: logLang });
        }
      }
    }
  }

  // 记录操作日志
  private logOperation(taskId: string, message: string): void {
    // 获取当前时间
    const timestamp = new Date().toLocaleString();
    const logMessage = `[${timestamp}] ${message}`;
    
    // 添加到历史记录
    const historyItem = this.historyManager.getHistory().find(item => item.id === taskId);
    if (historyItem) {
      historyItem.logs.push(logMessage);
      // 更新历史记录
      this.historyManager.setHistory([...this.historyManager.getHistory()]);
    }
    
    // 操作日志已通过 logOperation 记录，这里不再重复记录
  }

  // 修改 GitHub URL 使用代理的辅助方法
  private applyGitHubProxy(githubUrl: string, githubProxy: string): string {
    if (!githubProxy || !githubUrl) {
      return githubUrl;
    }

    // Normalize proxy URL - ensure it ends with '/'
    let normalizedProxy = githubProxy.trim();
    if (normalizedProxy.endsWith('github.com') || normalizedProxy.endsWith('github.com/')) {
      // If proxy is github.com itself, no need to apply
      // 代理是 github.com 本身，跳过代理应用
      return githubUrl;
    }

    // Ensure proxy URL ends with '/'
    if (!normalizedProxy.endsWith('/')) {
      normalizedProxy += '/';
    }

    // Replace https://github.com/ with the proxy URL
    const replacedUrl = githubUrl.replace('https://github.com/', normalizedProxy);
    // 代理URL已应用
    
    return replacedUrl;
  }

  // 添加一个新的公共方法，用于从其他控制器直接调用安装插件
  public async installPluginFromGitHub(
    githubUrl: string, 
    branch: string = 'main',
    progressCallback: (progress: any) => boolean,
    operationId: string
  ): Promise<void> {
    try {
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.install.from_github_start', { url: githubUrl, branch, operationId, lng: logLang });
      
      // 从GitHub URL解析插件ID
      const githubUrlParts = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!githubUrlParts) {
        throw new Error(`无效的GitHub URL: ${githubUrl}`);
      }
      
      const repo = githubUrlParts[2].replace('.git', '');
      const pluginId = repo;
      
      // 从系统控制器获取 GitHub 代理配置
      const systemEnvConfig = systemController['environmentConfigurator']?.envConfig || {};
      const systemGithubProxy = systemEnvConfig.GITHUB_PROXY || process.env.GITHUB_PROXY || '';
      
      // 确定实际使用的代理
      let actualGithubProxy = '';
      if (systemGithubProxy && systemGithubProxy !== 'https://github.com') {
        actualGithubProxy = systemGithubProxy;
        i18nLogger.info('plugin.install.use_system_proxy', { proxy: actualGithubProxy, lng: logLang });
      } else {
        i18nLogger.info('plugin.install.no_proxy', { lng: logLang });
      }
      
      // 记录操作开始
      this.logOperation(operationId, `开始从资源包安装插件: ${githubUrl} (分支: ${branch})`);
      this.logOperation(operationId, `GitHub代理配置: ${actualGithubProxy || '未配置'}`);
      
      // 确定安装路径
      const targetDir = path.join(CUSTOM_NODES_PATH, pluginId);
      
      // 检查目录是否已存在
      if (fs.existsSync(targetDir)) {
        // 如果存在，备份并删除
        this.logOperation(operationId, '检测到已有安装，正在备份...');
        const backupDir = `${targetDir}_backup_${Date.now()}`;
        fs.renameSync(targetDir, backupDir);
        this.logOperation(operationId, `已将现有目录备份到: ${backupDir}`);
      }
      
      this.logOperation(operationId, '正在下载插件...');
      
      // 优先尝试release包下载（需要从插件信息中获取）
      // 这里暂时跳过release包下载，因为我们需要插件信息
      // 在实际使用中，应该从缓存中获取插件信息
      
      // 使用git clone安装
      try {
        const proxyUrl = this.applyGitHubProxy(githubUrl, actualGithubProxy);
        const cloneCommand = `git clone --branch ${branch} "${proxyUrl}" "${targetDir}"`;
        this.logOperation(operationId, `执行: ${cloneCommand}`);
        
        const { stdout, stderr } = await execPromise(cloneCommand);
        if (stdout) {
          this.logOperation(operationId, `Git输出: ${stdout}`);
        }
        if (stderr) {
          this.logOperation(operationId, `Git错误: ${stderr}`);
        }
      } catch (cloneError) {
        const errorMsg = cloneError instanceof Error ? cloneError.message : String(cloneError);
        const logLang = i18nLogger.getLocale();
        i18nLogger.error('plugin.install.git_clone_failed', { message: errorMsg, lng: logLang });
        this.logOperation(operationId, `Git克隆失败: ${errorMsg}`);
        
        // 尝试使用HTTPS替代可能的SSH或HTTP2
        const convertedUrl = githubUrl
          .replace('git@github.com:', 'https://github.com/')
          .replace(/\.git$/, '');
        
        const proxyConvertedUrl = this.applyGitHubProxy(convertedUrl, actualGithubProxy);
        const retryCommand = `git clone --branch ${branch} "${proxyConvertedUrl}" "${targetDir}"`;
        this.logOperation(operationId, `尝试备用方式: ${retryCommand}`);
        
        try {
          const { stdout, stderr } = await execPromise(retryCommand);
          if (stdout) {
            this.logOperation(operationId, `Git输出: ${stdout}`);
          }
          if (stderr) {
            this.logOperation(operationId, `Git错误: ${stderr}`);
          }
        } catch (retryError) {
          const retryErrorMsg = retryError instanceof Error ? retryError.message : String(retryError);
          const logLang = i18nLogger.getLocale();
          i18nLogger.error('plugin.install.retry_failed', { message: retryErrorMsg, lng: logLang });
          this.logOperation(operationId, `备用方式也失败: ${retryErrorMsg}`);
          throw new Error(`git克隆失败: ${errorMsg}. 备用方式也失败: ${retryErrorMsg}`);
        }
      }
      
      // 安装依赖
      // 在开发环境下跳过依赖安装
      if (isDev) {
        this.logOperation(operationId, '开发环境：跳过依赖安装');
        // 日志已通过 logOperation 记录，这里不再重复记录
      } else {
        this.logOperation(operationId, '检查依赖文件...');
        
        const requirementsPath = path.join(targetDir, 'requirements.txt');
        if (fs.existsSync(requirementsPath)) {
          this.logOperation(operationId, `发现requirements.txt，执行: pip install --user -r "${requirementsPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`pip install --user -r "${requirementsPath}"`);
            if (stdout) this.logOperation(operationId, `依赖安装输出: ${stdout}`);
            if (stderr) this.logOperation(operationId, `依赖安装警告: ${stderr}`);
          } catch (pipError) {
            this.logOperation(operationId, `依赖安装失败，但继续安装流程: ${pipError}`);
          }
        } else {
          this.logOperation(operationId, '未找到requirements.txt文件');
        }
        
        // 执行安装脚本
        const installScriptPath = path.join(targetDir, 'install.py');
        if (fs.existsSync(installScriptPath)) {
          this.logOperation(operationId, `发现install.py，执行: cd "${targetDir}" && python3 "${installScriptPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`cd "${targetDir}" && python3 "${installScriptPath}"`);
            if (stdout) this.logOperation(operationId, `安装脚本输出: ${stdout}`);
            if (stderr) this.logOperation(operationId, `安装脚本警告: ${stderr}`);
          } catch (scriptError) {
            this.logOperation(operationId, `安装脚本执行失败，但继续安装流程: ${scriptError}`);
          }
        } else {
          this.logOperation(operationId, '未找到install.py脚本');
        }
      }
      
      // 完成安装
      const now = new Date();
      const successMessage = `插件安装完成于 ${now.toLocaleString()}`;
      i18nLogger.info('plugin.install.from_github_completed', { operationId, lng: logLang });
      this.logOperation(operationId, successMessage);
      
      // 调用进度回调
      if (progressCallback) {
        progressCallback({
          progress: 100,
          status: 'completed'
        });
      }
      
    } catch (error) {
      const errorMessage = `安装失败: ${error instanceof Error ? error.message : '未知错误'}`;
      const logLang = i18nLogger.getLocale();
      
      i18nLogger.error('plugin.install.from_github_failed', { operationId, message: errorMessage, lng: logLang });
      this.logOperation(operationId, errorMessage);
      
      // 调用进度回调报告错误
      if (progressCallback) {
        try {
          progressCallback({
            progress: 0,
            status: 'error',
            error: errorMessage
          });
        } catch (callbackError) {
          i18nLogger.error('plugin.install.progress_callback_error', { message: callbackError instanceof Error ? callbackError.message : String(callbackError), lng: logLang });
        }
      }
      
      // 重新抛出错误
      throw error;
    }
  }

  // 安装后刷新插件列表
  private async refreshPluginsAfterInstall(pluginId: string): Promise<void> {
    try {
      // 等待一段时间确保安装完成
      setTimeout(async () => {
        try {
          const logLang = i18nLogger.getLocale();
          i18nLogger.info('plugin.install.refresh_after_install', { pluginId, lng: logLang });
          if (this.cacheManager) {
            await this.cacheManager.refreshInstalledPlugins();
            i18nLogger.info('plugin.install.refresh_completed', { lng: logLang });
          }
        } catch (error) {
          const logLang = i18nLogger.getLocale();
          i18nLogger.error('plugin.install.refresh_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
        }
      }, 1000); // 等待1秒
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.install.schedule_refresh_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }

  // 添加一个新的API端点，用于自定义插件安装
  async installCustomPlugin(ctx: any, githubUrl: string, branch: string = 'main'): Promise<string> {
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('plugin.install.custom_url_request', { url: githubUrl, branch, lng: logLang });
    
    // 验证GitHub URL格式
    const githubRegex = /^(https?:\/\/)?(www\.)?github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?$/;
    if (!githubRegex.test(githubUrl)) {
      throw new Error('无效的GitHub URL格式');
    }
    
    // 规范化URL (确保使用https://，移除可能的.git后缀)
    let normalizedUrl = githubUrl
      .replace(/^(http:\/\/)?(www\.)?github\.com/, 'https://github.com')
      .replace(/\.git$/, '');
    
    // 生成任务ID
    const taskId = uuidv4();
    
    // 从GitHub URL解析插件ID
    const githubUrlParts = normalizedUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!githubUrlParts) {
      throw new Error(`无法从URL解析仓库信息: ${normalizedUrl}`);
    }
    
    const repoName = githubUrlParts[2];
    const pluginId = repoName;

    // 添加到历史记录
    this.historyManager.addHistoryItem(taskId, pluginId, 'install');
    
    // 创建进度任务
    if (this.progressManager) {
      this.progressManager.createTask(taskId, pluginId, 'install');
    }
    
    // 异步执行安装
    (async () => {
      try {
        console.log(`[installCustomPlugin] Starting installation for task ${taskId}, plugin ${pluginId}, URL: ${normalizedUrl}, branch: ${branch}`);
        
        // 创建一个进度回调函数
        const progressCallback = (progress: any): boolean => {
          // Update progress manager if available
          if (this.progressManager && progress.progress !== undefined) {
            this.progressManager.updateProgress(taskId, progress.progress, progress.status);
            console.log(`[installCustomPlugin] Progress update for task ${taskId}: ${progress.progress}%, status: ${progress.status}`);
          }
          return true;
        };
        
        // 调用现有方法执行安装
        await this.installPluginFromGitHub(
          normalizedUrl,
          branch,
          progressCallback,
          taskId
        );
        
        console.log(`[installCustomPlugin] Installation completed for task ${taskId}`);
        
        // 安装完成后，更新历史记录
        this.historyManager.updateHistoryItem(taskId, {
          endTime: Date.now(),
          status: 'success',
          result: `从GitHub安装完成: ${normalizedUrl}`
        });
        
        // 更新进度管理器 - 标记任务完成
        if (this.progressManager) {
          this.progressManager.completeTask(taskId, true, `Custom plugin installed: ${pluginId}`);
          console.log(`[installCustomPlugin] Task ${taskId} marked as completed successfully`);
        } else {
          console.error(`[installCustomPlugin] WARNING: progressManager is not available for task ${taskId}`);
        }
        
        // 清除插件缓存并刷新列表
        if (this.cacheManager) {
          try {
            await this.cacheManager.clearPluginCache(pluginId);
            await this.cacheManager.refreshInstalledPlugins();
            console.log(`[installCustomPlugin] Plugin cache cleared and list refreshed for ${pluginId}`);
          } catch (e) {
            console.error(`[installCustomPlugin] Failed to refresh plugin cache: ${e}`);
          }
        }
        
      } catch (error) {
        console.error(`[installCustomPlugin] Installation failed for task ${taskId}, error:`, error);
        
        const errorMessage = `安装失败: ${error instanceof Error ? error.message : '未知错误'}`;
        const errorStack = error instanceof Error ? error.stack : '';
        
        console.error(`[installCustomPlugin] Error details - Message: ${errorMessage}, Stack: ${errorStack}`);
        
        // 更新历史记录
        try {
          this.historyManager.updateHistoryItem(taskId, {
            endTime: Date.now(),
            status: 'failed',
            result: errorMessage
          });
        } catch (historyError) {
          console.error(`[installCustomPlugin] Failed to update history: ${historyError}`);
        }
        
        // 更新进度管理器 - 标记任务失败 (critical: must ensure this executes)
        if (this.progressManager) {
          try {
            this.progressManager.completeTask(taskId, false, errorMessage);
            console.log(`[installCustomPlugin] Task ${taskId} marked as failed`);
          } catch (progressError) {
            console.error(`[installCustomPlugin] CRITICAL: Failed to mark task as failed: ${progressError}`);
          }
        } else {
          console.error(`[installCustomPlugin] CRITICAL: progressManager is not available, cannot mark task ${taskId} as failed`);
        }
        
        // 刷新插件列表确保前端显示最新状态
        if (this.cacheManager) {
          try {
            await this.cacheManager.refreshInstalledPlugins();
            console.log(`[installCustomPlugin] Plugin list refreshed after failure`);
          } catch (e) {
            console.error(`[installCustomPlugin] Failed to refresh plugin list after failure: ${e}`);
          }
        }
      }
    })();
    
    return taskId;
  }

  // 切换插件版本
  async switchPluginVersion(ctx: any, pluginId: string, targetVersion: any, githubProxy?: string): Promise<string> {
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('plugin.install.switch_version_request', { pluginId, version: targetVersion.version, lng: logLang });
    
    const taskId = uuidv4();
    
    // 从系统控制器获取 GitHub 代理配置
    const systemEnvConfig = systemController['environmentConfigurator']?.envConfig || {};
    const systemGithubProxy = systemEnvConfig.GITHUB_PROXY || process.env.GITHUB_PROXY || '';
    
    // 确定实际使用的代理
    let actualGithubProxy = '';
    if (systemGithubProxy && systemGithubProxy !== 'https://github.com') {
      actualGithubProxy = systemGithubProxy;
      i18nLogger.info('plugin.install.use_system_proxy', { proxy: actualGithubProxy, lng: logLang });
    } else if (githubProxy) {
      actualGithubProxy = githubProxy;
      i18nLogger.info('plugin.install.use_client_proxy', { proxy: actualGithubProxy, lng: logLang });
    } else {
      i18nLogger.info('plugin.install.no_proxy', { lng: logLang });
    }
    
    // 添加到历史记录
    this.historyManager.addHistoryItem(taskId, pluginId, 'switch-version', actualGithubProxy);
    
    // 实际切换版本任务
    this.switchPluginVersionTask(taskId, pluginId, targetVersion, actualGithubProxy);
    
    return taskId;
  }

  // 实际切换插件版本任务
  private async switchPluginVersionTask(taskId: string, pluginId: string, targetVersion: any, githubProxy: string): Promise<void> {
    const logLang = i18nLogger.getLocale();
    try {
      // 更新进度
      this.logOperation(taskId, `正在切换到版本 ${targetVersion.version}...`);
      
      // 确定安装路径
      const targetDir = path.join(CUSTOM_NODES_PATH, pluginId);
      
      // 检查目录是否存在
      if (!fs.existsSync(targetDir)) {
        // 未安装时，直接按所选版本执行安装
        this.logOperation(taskId, '检测到插件未安装，按所选版本执行安装...');

        // 检查目标版本是否可用
        if (targetVersion.deprecated || targetVersion.status === 'NodeVersionStatusBanned') {
          this.logOperation(taskId, '目标版本已被弃用或封禁，无法安装');
          throw new Error('目标版本已被弃用或封禁，无法安装');
        }

        // 根据版本信息选择安装方法
        if (targetVersion.downloadUrl) {
          try {
            this.logOperation(taskId, `使用release包安装版本 ${targetVersion.version}`);
            await downloadAndExtractRelease(targetVersion.downloadUrl, targetDir, taskId, this.logOperation.bind(this));
            this.logOperation(taskId, 'Release包安装成功');
            await this.waitForPyprojectVersion(targetDir, taskId);
          } catch (releaseError) {
            this.logOperation(taskId, `Release包安装失败，回退到Git安装: ${releaseError}`);
            await this.installFromGit(targetVersion, targetDir, taskId, githubProxy);
          }
        } else {
          await this.installFromGit(targetVersion, targetDir, taskId, githubProxy);
        }

        // 直接跳过后续备份步骤，转入缓存刷新与完成逻辑
        this.logOperation(taskId, '版本安装完成');

        // Install dependencies
        // Skip dependency installation in development environment
        if (isDev) {
          this.logOperation(taskId, 'Development environment: skipping dependency installation');
          console.log('[API] Development environment: skipping dependency installation');
        } else {
          this.logOperation(taskId, 'Checking dependency files...');
          
          const requirementsPath = path.join(targetDir, 'requirements.txt');
          if (fs.existsSync(requirementsPath)) {
            this.logOperation(taskId, `Found requirements.txt, executing: pip install --user -r "${requirementsPath}"`);
            try {
              const { stdout, stderr } = await execPromise(`pip install --user -r "${requirementsPath}"`);
              if (stdout) this.logOperation(taskId, `Dependency installation output: ${stdout}`);
              if (stderr) this.logOperation(taskId, `Dependency installation warning: ${stderr}`);
            } catch (pipError) {
              this.logOperation(taskId, `Dependency installation failed, but continuing installation process: ${pipError}`);
            }
          } else {
            this.logOperation(taskId, 'requirements.txt file not found');
          }
          
          // Execute installation script
          const installScriptPath = path.join(targetDir, 'install.py');
          if (fs.existsSync(installScriptPath)) {
            this.logOperation(taskId, `Found install.py, executing: cd "${targetDir}" && python3 "${installScriptPath}"`);
            try {
              const { stdout, stderr } = await execPromise(`cd "${targetDir}" && python3 "${installScriptPath}"`);
              if (stdout) this.logOperation(taskId, `Installation script output: ${stdout}`);
              if (stderr) this.logOperation(taskId, `Installation script warning: ${stderr}`);
            } catch (scriptError) {
              this.logOperation(taskId, `Installation script execution failed, but continuing installation process: ${scriptError}`);
            }
          } else {
            this.logOperation(taskId, 'install.py script not found');
          }
        }

        if (this.cacheManager) {
          try {
            await this.cacheManager.clearPluginCache(pluginId);
            await this.cacheManager.refreshInstalledPlugins();
            i18nLogger.info('plugin.install.refresh_cache_after_install', { pluginId, lng: logLang });
            await this.waitUntilPluginVersionReady(pluginId, String(targetVersion.version || ''));
          } catch (cacheError) {
            i18nLogger.error('plugin.install.refresh_cache_failed', { message: cacheError instanceof Error ? cacheError.message : String(cacheError), lng: logLang });
          }
        }

        this.historyManager.updateHistoryItem(taskId, {
          endTime: Date.now(),
          status: 'success',
          result: `成功安装版本 ${targetVersion.version}`
        });

        if (this.progressManager) {
          this.progressManager.completeTask(taskId, true, `Installed ${targetVersion.version}`);
        }

        return;
      }
      
      // 备份当前版本
      this.logOperation(taskId, '正在备份当前版本...');
      const backupDir = `${targetDir}_backup_${Date.now()}`;
      fs.renameSync(targetDir, backupDir);
      this.logOperation(taskId, `已将当前版本备份到: ${backupDir}`);
      
      // 检查目标版本是否可用
      if (targetVersion.deprecated || targetVersion.status === 'NodeVersionStatusBanned') {
        this.logOperation(taskId, '目标版本已被弃用或封禁，无法切换');
        throw new Error('目标版本已被弃用或封禁，无法切换');
      }
      
      this.logOperation(taskId, '正在下载目标版本...');
      
      // 根据版本信息选择安装方法
      if (targetVersion.downloadUrl) {
        // 使用release包下载
        try {
          this.logOperation(taskId, `使用release包安装版本 ${targetVersion.version}`);
          await downloadAndExtractRelease(targetVersion.downloadUrl, targetDir, taskId, this.logOperation.bind(this));
          this.logOperation(taskId, 'Release包安装成功');
          // 等待 pyproject.toml 可读并包含 version，避免后续读取到空值
          await this.waitForPyprojectVersion(targetDir, taskId);
        } catch (releaseError) {
          this.logOperation(taskId, `Release包安装失败，回退到Git安装: ${releaseError}`);
          // 回退到Git安装
          await this.installFromGit(targetVersion, targetDir, taskId, githubProxy);
        }
      } else {
        // 使用Git安装
        await this.installFromGit(targetVersion, targetDir, taskId, githubProxy);
      }
      
      // Install dependencies after version switch
      // Skip dependency installation in development environment
      if (isDev) {
        this.logOperation(taskId, 'Development environment: skipping dependency installation');
        console.log('[API] Development environment: skipping dependency installation');
      } else {
        this.logOperation(taskId, 'Checking dependency files...');
        
        const requirementsPath = path.join(targetDir, 'requirements.txt');
        if (fs.existsSync(requirementsPath)) {
          this.logOperation(taskId, `Found requirements.txt, executing: pip install --user -r "${requirementsPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`pip install --user -r "${requirementsPath}"`);
            if (stdout) this.logOperation(taskId, `Dependency installation output: ${stdout}`);
            if (stderr) this.logOperation(taskId, `Dependency installation warning: ${stderr}`);
          } catch (pipError) {
            this.logOperation(taskId, `Dependency installation failed, but continuing installation process: ${pipError}`);
          }
        } else {
          this.logOperation(taskId, 'requirements.txt file not found');
        }
        
        // Execute installation script
        const installScriptPath = path.join(targetDir, 'install.py');
        if (fs.existsSync(installScriptPath)) {
          this.logOperation(taskId, `Found install.py, executing: cd "${targetDir}" && python3 "${installScriptPath}"`);
          try {
            const { stdout, stderr } = await execPromise(`cd "${targetDir}" && python3 "${installScriptPath}"`);
            if (stdout) this.logOperation(taskId, `Installation script output: ${stdout}`);
            if (stderr) this.logOperation(taskId, `Installation script warning: ${stderr}`);
          } catch (scriptError) {
            this.logOperation(taskId, `Installation script execution failed, but continuing installation process: ${scriptError}`);
          }
        } else {
          this.logOperation(taskId, 'install.py script not found');
        }
      }
      
      // 安装完成后，删除备份目录
      this.logOperation(taskId, '版本切换完成，正在清理备份目录...');
      try {
        if (fs.existsSync(backupDir)) {
          await fs.promises.rm(backupDir, { recursive: true, force: true });
          this.logOperation(taskId, `已删除备份目录: ${backupDir}`);
        }
      } catch (cleanupError) {
        i18nLogger.error('plugin.install.delete_backup_failed', { message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), lng: logLang });
        this.logOperation(taskId, `删除备份目录失败，但版本切换已成功: ${cleanupError}`);
      }
      
      // 先刷新后宣布完成，避免前端在"完成"瞬间读到旧缓存
      if (this.cacheManager) {
        try {
          await this.cacheManager.clearPluginCache(pluginId);
          await this.cacheManager.refreshInstalledPlugins();
          i18nLogger.info('plugin.install.refresh_cache_after_switch', { pluginId, lng: logLang });
          // 等待缓存可被 getAllPlugins 返回目标版本后再通知前端
          await this.waitUntilPluginVersionReady(pluginId, String(targetVersion.version || ''));
        } catch (cacheError) {
          i18nLogger.error('plugin.install.refresh_cache_after_switch_failed', { message: cacheError instanceof Error ? cacheError.message : String(cacheError), lng: logLang });
        }
      }
      
      // 更新历史记录（放在刷新之后）
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'success',
        result: `成功切换到版本 ${targetVersion.version}`
      });
      
      // 最后再标记任务完成（前端据此停止轮询并立刻刷新）
      if (this.progressManager) {
        this.progressManager.completeTask(taskId, true, `Switched to ${targetVersion.version}`);
      }
      
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.install.switch_version_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      
      // 恢复备份
      try {
        const targetDir = path.join(CUSTOM_NODES_PATH, pluginId);
        const backupDirs = fs.readdirSync(CUSTOM_NODES_PATH)
          .filter(dir => dir.startsWith(`${pluginId}_backup_`))
          .sort()
          .reverse();
        
        if (backupDirs.length > 0) {
          const latestBackup = path.join(CUSTOM_NODES_PATH, backupDirs[0]);
          if (fs.existsSync(latestBackup)) {
            fs.renameSync(latestBackup, targetDir);
            this.logOperation(taskId, '已恢复备份版本');
            
            // 恢复成功后，删除其他旧的备份目录
            for (let i = 1; i < backupDirs.length; i++) {
              const oldBackup = path.join(CUSTOM_NODES_PATH, backupDirs[i]);
              try {
                if (fs.existsSync(oldBackup)) {
                  await fs.promises.rm(oldBackup, { recursive: true, force: true });
                  this.logOperation(taskId, `已清理旧备份目录: ${backupDirs[i]}`);
                }
              } catch (cleanupError) {
                i18nLogger.error('plugin.install.cleanup_old_backup_failed', { message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError), lng: logLang });
              }
            }
          }
        }
      } catch (restoreError) {
        i18nLogger.error('plugin.install.restore_backup_failed', { message: restoreError instanceof Error ? restoreError.message : String(restoreError), lng: logLang });
      }
      
      // 更新历史记录
      this.historyManager.updateHistoryItem(taskId, {
        endTime: Date.now(),
        status: 'failed',
        result: `版本切换失败: ${error instanceof Error ? error.message : '未知错误'}`
      });
      
      // 更新进度管理器 - 标记任务失败
      if (this.progressManager) {
        this.progressManager.completeTask(taskId, false, `Switch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      // 最终确保刷新一次本地插件列表与缓存状态
      if (this.cacheManager) {
        try {
          await this.cacheManager.refreshInstalledPlugins();
          const logLang = i18nLogger.getLocale();
          i18nLogger.info('plugin.install.refresh_after_switch_flow', { lng: logLang });
        } catch (e) {
          const logLang = i18nLogger.getLocale();
          i18nLogger.error('plugin.install.refresh_after_switch_flow_failed', { message: e instanceof Error ? e.message : String(e), lng: logLang });
        }
      }
    }
  }

  // 等待 pyproject.toml 出现并包含 version 字段，以避免立即刷新时读到默认值
  private async waitForPyprojectVersion(targetDir: string, taskId: string): Promise<void> {
    const maxAttempts = 20; // 最长约2秒
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
    const path = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const pyPath = path.join(targetDir, 'pyproject.toml');
        if (fs.existsSync(pyPath)) {
          const content = fs.readFileSync(pyPath, 'utf-8');
          const data = TOML.parse(content) as any;
          const version = data?.project?.version;
          if (typeof version === 'string' && version.trim().length > 0) {
            this.logOperation(taskId, `检测到 pyproject.version=${version}`);
            return;
          }
        }
      } catch {
        // ignore and retry
      }
      await delay(100);
    }
    this.logOperation(taskId, '未能及时检测到 pyproject.version，继续刷新，但版本可能稍后才可见');
  }

  // 轮询缓存直至 getAllPlugins 返回的目标插件版本等于期望版本（最多2秒）
  private async waitUntilPluginVersionReady(pluginId: string, expectedVersion: string): Promise<void> {
    if (!this.cacheManager?.getAllPlugins) return;
    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
    const maxAttempts = 20;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const list = await this.cacheManager.getAllPlugins(true);
        const item = Array.isArray(list) ? list.find((p: any) => p?.id?.toLowerCase?.() === pluginId.toLowerCase()) : null;
        if (item && typeof item.version === 'string' && item.version.trim().length > 0) {
          if (expectedVersion && item.version.trim() === expectedVersion.trim()) {
            return;
          }
          // 如果拿到的是非空但不等于期望版本，继续等待直到一致（不要返回）
        }
      } catch {}
      await delay(100);
    }
  }

  // 从Git安装特定版本
  private async installFromGit(targetVersion: any, targetDir: string, taskId: string, githubProxy: string): Promise<void> {
    this.logOperation(taskId, '使用Git安装目标版本...');

    // 解析仓库URL：优先从缓存中获得对应插件的 repository/github 字段
    let repoUrl: string | undefined;
    try {
      if (this.cacheManager?.getAllPlugins) {
        const list = await this.cacheManager.getAllPlugins(false);
        // targetVersion 旁边通常会有 node_id 或 version，可由调用方上下文确定 pluginId
        // 本方法没有 pluginId 参数，这里根据目标目录名推断
        const pluginId = path.basename(targetDir);
        const pluginInfo = Array.isArray(list) ? list.find((p: any) => p?.id === pluginId) : undefined;
        repoUrl = pluginInfo?.repository || pluginInfo?.github;
      }
    } catch {}

    if (!repoUrl) {
      throw new Error('无法确定Git仓库地址，无法通过Git安装目标版本');
    }

    // 应用代理
    const proxyUrl = this.applyGitHubProxy(repoUrl, githubProxy);

    // 克隆仓库
    try {
      this.logOperation(taskId, `执行: git clone "${proxyUrl}" "${targetDir}"`);
      const { stdout, stderr } = await execPromise(`git clone "${proxyUrl}" "${targetDir}"`);
      if (stdout) this.logOperation(taskId, `Git输出: ${stdout}`);
      if (stderr) this.logOperation(taskId, `Git错误: ${stderr}`);
    } catch (cloneError) {
      this.logOperation(taskId, `Git克隆失败: ${cloneError}`);
      // 尝试将可能的 SSH/短链接转为 HTTPS
      const convertedUrl = repoUrl
        .replace('git@github.com:', 'https://github.com/')
        .replace(/\.git$/, '');
      const proxyConvertedUrl = this.applyGitHubProxy(convertedUrl, githubProxy);
      this.logOperation(taskId, `尝试备用方式: git clone "${proxyConvertedUrl}" "${targetDir}"`);
      const { stdout: stdout2, stderr: stderr2 } = await execPromise(`git clone "${proxyConvertedUrl}" "${targetDir}"`);
      if (stdout2) this.logOperation(taskId, `Git输出: ${stdout2}`);
      if (stderr2) this.logOperation(taskId, `Git错误: ${stderr2}`);
    }

    // 检出目标版本（按标签或分支名等于版本号尝试）
    if (targetVersion?.version) {
      try {
        this.logOperation(taskId, `检出版本: ${targetVersion.version}`);
        const { stdout, stderr } = await execPromise(`cd "${targetDir}" && git fetch --all --tags && git checkout ${targetVersion.version}`);
        if (stdout) this.logOperation(taskId, `检出输出: ${stdout}`);
        if (stderr) this.logOperation(taskId, `检出错误: ${stderr}`);
      } catch (checkoutError) {
        this.logOperation(taskId, `检出版本失败，继续使用默认分支: ${checkoutError}`);
      }
    }

    // 依赖安装（与主安装流程一致）
    if (isDev) {
      this.logOperation(taskId, '开发环境：跳过依赖安装');
    } else {
      this.logOperation(taskId, '检查依赖文件...');
      const requirementsPath = path.join(targetDir, 'requirements.txt');
      if (fs.existsSync(requirementsPath)) {
        try {
          const { stdout, stderr } = await execPromise(`pip install --user -r "${requirementsPath}"`);
          if (stdout) this.logOperation(taskId, `依赖安装输出: ${stdout}`);
          if (stderr) this.logOperation(taskId, `依赖安装警告: ${stderr}`);
        } catch (pipError) {
          this.logOperation(taskId, `依赖安装失败，但继续安装流程: ${pipError}`);
        }
      } else {
        this.logOperation(taskId, '未找到requirements.txt文件');
      }

      const installScriptPath = path.join(targetDir, 'install.py');
      if (fs.existsSync(installScriptPath)) {
        try {
          const { stdout, stderr } = await execPromise(`cd "${targetDir}" && python3 "${installScriptPath}"`);
          if (stdout) this.logOperation(taskId, `安装脚本输出: ${stdout}`);
          if (stderr) this.logOperation(taskId, `安装脚本警告: ${stderr}`);
        } catch (scriptError) {
          this.logOperation(taskId, `安装脚本执行失败，但继续安装流程: ${scriptError}`);
        }
      } else {
        this.logOperation(taskId, '未找到install.py脚本');
      }
    }

    // 等待 pyproject 版本可读
    await this.waitForPyprojectVersion(targetDir, taskId);
  }
}
