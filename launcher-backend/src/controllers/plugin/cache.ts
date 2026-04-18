import superagent from 'superagent';
import * as fs from 'fs';
import * as path from 'path';
import { PluginInfoManager } from './info';
import logger from '../../utils/logger';
import { i18nLogger } from '../../utils/logger';

// 确定环境和路径
const isDev = process.env.NODE_ENV !== 'production';

// 在开发环境中使用当前目录，生产环境使用配置路径
const COMFYUI_PATH = process.env.COMFYUI_PATH || 
  (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');

const CUSTOM_NODES_PATH = path.join(COMFYUI_PATH, 'custom_nodes');

// 确保有一个 .disabled 目录用于存放禁用的插件
const DISABLED_PLUGINS_PATH = path.join(CUSTOM_NODES_PATH, '.disabled');

// 缓存插件列表
let cachedPlugins: any[] = [];
let lastFetchTime = 0;
const CACHE_DURATION = 3600000; // 1小时缓存

// 缓存 GitHub 统计数据
let githubStatsCache: Record<string, { stars: number, updatedAt: number }> = {};
const GITHUB_STATS_CACHE_DURATION = 86400000; // 24小时缓存 GitHub 统计数据

// all_nodes.mirrored.json 更新相关配置
const ALL_NODES_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24小时更新一次
let updateTimer: NodeJS.Timeout | null = null;

// 模拟的插件列表 - 更新为新的数据结构
const mockPlugins = [
  {
    // Basic identification
    id: "comfyui-controlnet",
    name: "ComfyUI ControlNet",
    description: "ControlNet节点集合，帮助您通过预设条件精确控制图像生成",
    author: "ComfyUI Team",
    repository: "https://github.com/Comfy-Org/ComfyUI",
    
    // Version information
    version: "1.2.3",
    
    // Status and metadata
    status: "NodeStatusActive",
    rating: 0,
    downloads: 1240,
    github_stars: 1240,
    
    // Technical details
    tags: ["controlnet", "conditioning"],
    
    // Installation status (local state)
    installed: true,
    installedOn: "2023-10-15T10:30:00Z",
    
    // Legacy fields for backward compatibility
    github: "https://github.com/Comfy-Org/ComfyUI",
    stars: 1240,
    install_type: "git_clone",
    files: ["controlnet.py", "node.py"],
    require_restart: true
  },
  {
    // Basic identification
    id: "comfyui-impact-pack",
    name: "ComfyUI Impact Pack",
    description: "增强型节点集合，包含高级采样器、细节提升和特效处理",
    author: "ltdrdata",
    repository: "https://github.com/ltdrdata/ComfyUI-Impact-Pack",
    
    // Version information
    version: "2.0.1",
    
    // Status and metadata
    status: "NodeStatusActive",
    rating: 0,
    downloads: 0,
    github_stars: 0,
    
    // Installation status (local state)
    installed: true,
    installedOn: "2023-11-20T15:45:00Z",
    
    // Legacy fields for backward compatibility
    github: "https://github.com/ltdrdata/ComfyUI-Impact-Pack"
  },
  {
    // Basic identification
    id: "comfyui-sd-webui-scripts",
    name: "SD WebUI Scripts",
    description: "从Stable Diffusion WebUI移植的常用脚本和工作流",
    author: "SDWebUI Contributors",
    repository: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
    
    // Version information
    version: "0.9.5",
    
    // Status and metadata
    status: "NodeStatusActive",
    rating: 0,
    downloads: 0,
    github_stars: 0,
    
    // Installation status (local state)
    installed: false,
    
    // Legacy fields for backward compatibility
    github: "https://github.com/AUTOMATIC1111/stable-diffusion-webui"
  },
  {
    // Basic identification
    id: "comfyui-advanced-nodes",
    name: "Advanced Nodes",
    description: "提供高级图像处理功能的节点集，包括色彩校正、图层混合等",
    author: "ComfyUI Community",
    repository: "https://github.com/example/advanced-nodes",
    
    // Version information
    version: "1.3.0",
    
    // Status and metadata
    status: "NodeStatusActive",
    rating: 0,
    downloads: 0,
    github_stars: 0,
    
    // Installation status (local state)
    installed: false,
    
    // Legacy fields for backward compatibility
    github: "https://github.com/example/advanced-nodes"
  },
  {
    // Basic identification
    id: "comfyui-animatediff",
    name: "AnimateDiff Integration",
    description: "将AnimateDiff集成到ComfyUI中，轻松创建动画和视频效果",
    author: "guoyww",
    repository: "https://github.com/guoyww/AnimateDiff",
    
    // Version information
    version: "0.8.2",
    
    // Status and metadata
    status: "NodeStatusActive",
    rating: 0,
    downloads: 0,
    github_stars: 0,
    
    // Installation status (local state)
    installed: true,
    installedOn: "2023-12-05T08:20:00Z",
    
    // Legacy fields for backward compatibility
    github: "https://github.com/guoyww/AnimateDiff"
  },
  {
    // Basic identification
    id: "comfyui-upscalers",
    name: "Super Upscalers",
    description: "高级超分辨率节点集，整合多种AI放大算法",
    author: "AI Upscale Team",
    repository: "https://github.com/example/super-upscalers",
    
    // Version information
    version: "1.5.1",
    
    // Status and metadata
    status: "NodeStatusActive",
    rating: 0,
    downloads: 0,
    github_stars: 0,
    
    // Installation status (local state)
    installed: false,
    
    // Legacy fields for backward compatibility
    github: "https://github.com/example/super-upscalers"
  },
  {
    // Basic identification
    id: "comfyui-workflow-manager",
    name: "Workflow Manager",
    description: "工作流管理工具，保存、加载和共享您的ComfyUI工作流",
    author: "Workflow Developers",
    repository: "https://github.com/example/workflow-manager",
    
    // Version information
    version: "1.1.0",
    
    // Status and metadata
    status: "NodeStatusActive",
    rating: 0,
    downloads: 0,
    github_stars: 0,
    
    // Installation status (local state)
    installed: true,
    installedOn: "2024-01-10T14:15:00Z",
    
    // Legacy fields for backward compatibility
    github: "https://github.com/example/workflow-manager"
  },
  {
    // Basic identification
    id: "comfyui-prompts-library",
    name: "Prompts Library",
    description: "提示词库和模板集合，帮助用户快速创建高质量提示",
    author: "Prompt Engineers",
    repository: "https://github.com/example/prompts-library",
    
    // Version information
    version: "2.2.0",
    
    // Status and metadata
    status: "NodeStatusActive",
    rating: 0,
    downloads: 0,
    github_stars: 0,
    
    // Installation status (local state)
    installed: false,
    
    // Legacy fields for backward compatibility
    github: "https://github.com/example/prompts-library"
  }
];

// 添加代理URL作为备用方案
async function fetchWithFallback(url: string) {
  try {
    // 首先尝试直接获取
    const response = await superagent.get(url).timeout({ response: 5000, deadline: 15000 });
    return response;  // 返回完整的 response 对象，而不仅仅是 body
  } catch (error) {
    i18nLogger.info('plugin.cache.fetch_fallback', { url, lng: i18nLogger.getLocale() });
    
    // 如果直接获取失败，尝试使用gh-proxy代理
    const proxyUrl = `https://gh-proxy.com/${url}`;
    const proxyResponse = await superagent.get(proxyUrl);
    return proxyResponse;  // 返回完整的 response 对象
  }

}

export class PluginCacheManager {
  
  constructor() {
    // 初始化 - 启动时预加载插件数据
    this.initPluginsCache();
    // 启动定时更新 all_nodes.mirrored.json
    this.startPeriodicUpdate();
  }

  // 检查本地文件是否存在
  private checkLocalFileExists(): boolean {
    const localFilePath = path.join(__dirname, 'all_nodes.mirrored.json');
    return fs.existsSync(localFilePath);
  }

  // 从本地文件加载插件数据
  private async loadFromLocalFile(): Promise<void> {
    try {
      const localFilePath = path.join(__dirname, 'all_nodes.mirrored.json');
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.cache.load_from_local', { path: localFilePath, lng: logLang });
      
      if (!this.checkLocalFileExists()) {
        throw new Error(`本地插件文件不存在: ${localFilePath}`);
      }
      
      const fileContent = fs.readFileSync(localFilePath, 'utf-8');
      const localData = JSON.parse(fileContent);
      
      // 确保custom_nodes目录存在
      if (!fs.existsSync(CUSTOM_NODES_PATH)) {
        fs.mkdirSync(CUSTOM_NODES_PATH, { recursive: true });
      }
      
      // 获取已安装插件
      const installedPlugins = this.getInstalledPlugins();
      
      // 解析插件数据 - 使用本地文件数据
      const nodesData = localData.nodes || [];
      let plugins = nodesData.map((info: any) => {
        // 转换为标准格式
        const plugin = {
          // Basic identification
          id: info.id || '',
          name: info.name || '',
          description: info.description || '',
          author: info.author || '',
          repository: info.repository || '',
          
          // Version information
          version: info.latest_version?.version || 'nv-4',
          latest_version: info.latest_version,
          versions: info.versions || [],
          
          // Publisher information
          publisher: info.publisher,
          
          // Status and metadata
          status: info.status || 'NodeStatusActive',
          status_detail: info.status_detail || '',
          rating: info.rating || 0,
          downloads: info.downloads || 0,
          github_stars: info.github_stars || 0,
          
          // Visual elements
          icon: info.icon || '',
          banner_url: info.banner_url || '',
          category: info.category || '',
          
          // Technical details
          license: info.license || '{}',
          tags: info.tags || [],
          dependencies: info.latest_version?.dependencies || [],
          
          // Compatibility
          supported_accelerators: info.supported_accelerators,
          supported_comfyui_frontend_version: info.supported_comfyui_frontend_version || '',
          supported_comfyui_version: info.supported_comfyui_version || '',
          supported_os: info.supported_os,
          
          // Timestamps
          created_at: info.created_at || new Date().toISOString(),
          
          // Installation status (local state)
          installed: false,
          disabled: false,
          
          // Legacy fields for backward compatibility
          install_type: 'git_clone',
          stars: info.github_stars || 0,
          github: info.repository || ''
        };
        
        return plugin;
      });
      
      // 更新安装状态
      this.updatePluginsInstallStatus(plugins, installedPlugins);
      
      // 更新缓存
      cachedPlugins = plugins;
      lastFetchTime = Date.now();
      
      i18nLogger.info('plugin.cache.load_from_local_success', { count: plugins.length, lng: logLang });
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.cache.load_from_local_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      throw error;
    }
  }

  // 初始化插件缓存
  private async initPluginsCache() {
    try {
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.cache.init_start', { lng: logLang });
      setTimeout(async () => {
        try {
          // 优先使用本地镜像文件初始化插件缓存
          if (this.checkLocalFileExists()) {
            await this.loadFromLocalFile();
            i18nLogger.info('plugin.cache.init_completed', { count: cachedPlugins.length, lng: logLang });
          } else {
            i18nLogger.info('plugin.cache.init_use_network', { lng: logLang });
            cachedPlugins = await this.fetchComfyUIManagerPlugins(true);
            lastFetchTime = Date.now();
            i18nLogger.info('plugin.cache.init_completed', { count: cachedPlugins.length, lng: logLang });
          }
        } catch (error) {
          i18nLogger.error('plugin.cache.init_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
          // 如果本地文件加载失败，回退到网络获取
          try {
            cachedPlugins = await this.fetchComfyUIManagerPlugins(true);
            lastFetchTime = Date.now();
            i18nLogger.info('plugin.cache.init_fallback_network', { count: cachedPlugins.length, lng: logLang });
          } catch (networkError) {
            i18nLogger.error('plugin.cache.init_network_failed', { message: networkError instanceof Error ? networkError.message : String(networkError), lng: logLang });
          }
        }
      }, 1000);
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.cache.init_error', { message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }

  // 获取所有插件
  async getAllPlugins(forceRefresh: boolean = false): Promise<any[]> {
    try {
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.cache.get_all_plugins', { forceRefresh, cachedCount: cachedPlugins.length, lastFetchTime, lng: logLang });
      
      const currentTime = Date.now();
      
      // 如果缓存有效且不强制刷新，直接使用（但仍用本地已安装信息覆盖版本号等关键字段）
      if (!forceRefresh && cachedPlugins.length > 0 && (currentTime - lastFetchTime) < CACHE_DURATION) {
        i18nLogger.info('plugin.cache.use_cached', { lng: logLang });
        try {
          const installed = this.getInstalledPlugins();
          cachedPlugins = this.overlayInstalledInfo(cachedPlugins, installed);
        } catch (e) {
          i18nLogger.warn('plugin.cache.overlay_failed_cache', { message: e instanceof Error ? e.message : String(e), lng: logLang });
        }
        return cachedPlugins;
      }
      
      // 优先尝试从本地文件加载
      if (this.checkLocalFileExists()) {
        try {
          await this.loadFromLocalFile();
          i18nLogger.info('plugin.cache.load_from_local_success', { count: cachedPlugins.length, lng: logLang });
          // 覆盖一次本地安装信息，确保版本来自 pyproject
          try {
            const installed = this.getInstalledPlugins();
            cachedPlugins = this.overlayInstalledInfo(cachedPlugins, installed);
          } catch (e) {
            i18nLogger.warn('plugin.cache.overlay_failed_local', { message: e instanceof Error ? e.message : String(e), lng: logLang });
          }
          return cachedPlugins;
        } catch (localError) {
          i18nLogger.info('plugin.cache.load_local_fallback', { message: localError instanceof Error ? localError.message : String(localError), lng: logLang });
        }
      } else {
        i18nLogger.info('plugin.cache.local_not_exists', { lng: logLang });
      }
      
      // 如果本地文件不存在或加载失败，回退到网络获取
      const pluginsData = await this.fetchComfyUIManagerPlugins(forceRefresh);
      
      // 覆盖一次本地安装信息，确保版本来自 pyproject
      let overlaid = pluginsData;
      try {
        const installed = this.getInstalledPlugins();
        overlaid = this.overlayInstalledInfo(pluginsData, installed);
      } catch (e) {
        i18nLogger.warn('plugin.cache.overlay_failed_network', { message: e instanceof Error ? e.message : String(e), lng: logLang });
      }
      
      // 更新缓存
      cachedPlugins = overlaid;
      lastFetchTime = currentTime;
      
      return cachedPlugins;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.cache.get_all_plugins_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      throw error;
    }
  }

  // 覆盖已安装插件的信息（version/name/description/repository 优先使用本地）
  private overlayInstalledInfo(sourcePlugins: any[], installedPlugins: any[]): any[] {
    if (!Array.isArray(sourcePlugins) || !Array.isArray(installedPlugins)) return sourcePlugins;
    const installedById = new Map<string, any>();
    const installedByUrl = new Map<string, any>();
    const normalizeGithubUrl = (url: string): string => {
      return (url || '')
        .toLowerCase()
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/\.git$/, '')
        .replace(/\/$/, '');
    };
    installedPlugins.forEach(p => {
      installedById.set(String(p.id).toLowerCase(), p);
      const url = normalizeGithubUrl(p.repository || p.github || '');
      if (url) installedByUrl.set(url, p);
    });
    
    return sourcePlugins.map(p => {
      const key = String(p.id || '').toLowerCase();
      let local = installedById.get(key);
      if (!local) {
        const srcUrl = normalizeGithubUrl(p.repository || p.github || '');
        if (srcUrl) local = installedByUrl.get(srcUrl);
      }
      if (!local) return { ...p, github: p.repository || p.github };

      const merged: any = { ...p };
      merged.installed = true;
      merged.installedOn = local.installedOn || p.installedOn;
      merged.disabled = local.disabled ?? p.disabled ?? false;
      // 关键字段采用本地解析
      merged.version = local.version || p.version;
      merged.name = local.name || p.name;
      merged.description = local.description || p.description;
      merged.repository = local.repository || p.repository || p.github;
      // 兼容字段
      merged.github = merged.repository || p.github;
      merged.stars = p.github_stars || p.stars;
      return merged;
    });
  }

  // 从 ComfyUI-Manager 获取插件列表
  private async fetchComfyUIManagerPlugins(forceNetworkFetch: boolean = false): Promise<any[]> {
    try {
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.cache.fetch_list', { forceNetworkFetch, lng: logLang });
      
      // 如果不强制网络获取，且缓存中有数据，则仅更新本地状态
      if (!forceNetworkFetch && cachedPlugins.length > 0) {
        i18nLogger.info('plugin.cache.use_cached_update', { lng: logLang });
        
        // 获取本地安装的插件信息
        const installedPlugins = this.getInstalledPlugins();
        
        // 更新缓存中插件的安装状态
        this.updatePluginsInstallStatus(cachedPlugins, installedPlugins);
        
        return cachedPlugins;
      }
      
      // 强制网络获取或缓存为空时，从网络获取完整列表
      i18nLogger.info('plugin.cache.fetch_from_network', { lng: logLang });
      
      // 新的插件列表URL - 使用本地镜像文件
      // 注意：这里应该使用新的API端点，但为了向后兼容，暂时使用旧URL
      const url = 'https://raw.githubusercontent.com/ltdrdata/ComfyUI-Manager/main/custom-node-list.json';
      
      const response = await fetchWithFallback(url);
      const managerData = JSON.parse(response.text);
      
      // 确保custom_nodes目录存在
      if (!fs.existsSync(CUSTOM_NODES_PATH)) {
        fs.mkdirSync(CUSTOM_NODES_PATH, { recursive: true });
      }
      
      // 获取已安装插件
      const installedPlugins = this.getInstalledPlugins();
      
      // 解析插件数据 - 更新为新的数据结构
      // 检查数据结构，支持新的all_nodes.mirrored.json格式
      const nodesData = managerData.nodes || managerData.custom_nodes || [];
      let plugins = nodesData.map((info: any) => {
        // 转换为标准格式
        const plugin = {
          // Basic identification
          id: info.id || '',
          name: info.name || '',
          description: info.description || '',
          author: info.author || '',
          repository: info.repository || '',
          
          // Version information
          version: info.latest_version?.version || 'nv-3',
          latest_version: info.latest_version,
          versions: info.versions || [],
          
          // Publisher information
          publisher: info.publisher,
          
          // Status and metadata
          status: info.status || 'NodeStatusActive',
          status_detail: info.status_detail || '',
          rating: info.rating || 0,
          downloads: info.downloads || 0,
          github_stars: info.github_stars || 0,
          
          // Visual elements
          icon: info.icon || '',
          banner_url: info.banner_url || '',
          category: info.category || '',
          
          // Technical details
          license: info.license || '{}',
          tags: info.tags || [],
          dependencies: info.latest_version?.dependencies || [],
          
          // Compatibility
          supported_accelerators: info.supported_accelerators,
          supported_comfyui_frontend_version: info.supported_comfyui_frontend_version || '',
          supported_comfyui_version: info.supported_comfyui_version || '',
          supported_os: info.supported_os,
          
          // Timestamps
          created_at: info.created_at || new Date().toISOString(),
          
          // Installation status (local state)
          installed: false,
          disabled: false,
          
          // Legacy fields for backward compatibility
          install_type: 'git_clone',
          stars: info.github_stars || 0,
          github: info.repository || ''
        };
        
        return plugin;
      });
      
      // 更新安装状态
      this.updatePluginsInstallStatus(plugins, installedPlugins);
      
      return plugins;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.cache.fetch_manager_list_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      
      // 如果从网络获取失败，但有缓存数据，则使用缓存
      if (cachedPlugins.length > 0) {
        i18nLogger.info('plugin.cache.use_cached_fallback', { lng: logLang });
        return cachedPlugins;
      }
      
      // 缓存也没有，返回模拟数据
      i18nLogger.info('plugin.cache.no_cache_return_mock', { lng: logLang });
      return [...mockPlugins];
    }
  }

  // 辅助方法：更新插件的安装状态
  private updatePluginsInstallStatus(plugins: any[], installedPlugins: any[]): void {
    // 创建一个快速查找表
    const installedMap = new Map();
    installedPlugins.forEach(plugin => {
      // 统一转为小写键以便忽略大小写比较
      installedMap.set(plugin.id.toLowerCase(), {
        installedOn: plugin.installedOn,
        disabled: plugin.disabled,
        // 保存原始插件信息用于GitHub URL比较
        originalPlugin: plugin
      });
    });
    
    // 更新每个插件的安装状态
    plugins.forEach(plugin => {
      // 忽略大小写比较
      const installedInfo = installedMap.get(plugin.id.toLowerCase());
      if (installedInfo) {
        // 更新为本地数据优先，保留网络数据中本地没有的字段
        const originalPlugin = installedInfo.originalPlugin;
        Object.keys(originalPlugin).forEach(key => {
          plugin[key] = originalPlugin[key];
        });
        // 确保安装状态正确
        plugin.installed = true;
        plugin.installedOn = originalPlugin.installedOn;
        plugin.disabled = originalPlugin.disabled;
      } else {
        // 如果ID没匹配上，尝试匹配GitHub URL
        const matchByGithub = this.findPluginByGithubUrl(plugin, installedPlugins);
        if (matchByGithub) {
          // 用本地插件数据覆盖网络数据
          Object.keys(matchByGithub).forEach(key => {
            plugin[key] = matchByGithub[key];
          });
          // 确保安装状态正确
          plugin.installed = true;
          plugin.installedOn = matchByGithub.installedOn;
          plugin.disabled = matchByGithub.disabled;
          // 确保向后兼容性
          plugin.github = plugin.repository || plugin.github;
          plugin.stars = plugin.github_stars || plugin.stars;
        } else {
          plugin.installed = false;
          plugin.disabled = false;
          // 确保向后兼容性
          plugin.github = plugin.repository || plugin.github;
          plugin.stars = plugin.github_stars || plugin.stars;
        }
      }
    });
    
    // 添加本地安装但不在列表中的插件
    installedPlugins.forEach(localPlugin => {
      // 忽略大小写比较
      const exists = plugins.some(p => {
        const pUrl = p.repository || p.github;
        const localUrl = localPlugin.repository || localPlugin.github;
        return p.id.toLowerCase() === localPlugin.id.toLowerCase() || 
               this.isSameGithubRepo(pUrl, localUrl);
      });
      if (!exists) {
        // 确保向后兼容性
        const pluginWithLegacy = {
          ...localPlugin,
          github: localPlugin.repository || localPlugin.github,
          stars: localPlugin.github_stars || localPlugin.stars
        };
        plugins.push(pluginWithLegacy);
      }
    });
  }

  // 辅助方法：根据GitHub URL查找插件
  private findPluginByGithubUrl(plugin: any, installedPlugins: any[]): any {
    const pluginUrl = plugin.repository || plugin.github;
    if (!pluginUrl) return null;
    
    return installedPlugins.find(localPlugin => {
      const localUrl = localPlugin.repository || localPlugin.github;
      return this.isSameGithubRepo(pluginUrl, localUrl);
    });
  }
  
  // 辅助方法：判断两个GitHub URL是否指向同一仓库
  private isSameGithubRepo(url1: string, url2: string): boolean {
    if (!url1 || !url2) return false;
    
    // 标准化GitHub URL以进行比较
    const normalizeGithubUrl = (url: string): string => {
      return url.toLowerCase()
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/\.git$/, '')
        .replace(/\/$/, '');
    };
    
    const normalized1 = normalizeGithubUrl(url1);
    const normalized2 = normalizeGithubUrl(url2);
    
    // 直接比较标准化后的URL
    if (normalized1 === normalized2) return true;
    
    // 提取用户名和仓库名进行比较
    try {
      const match1 = normalized1.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
      const match2 = normalized2.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
      
      if (match1 && match2) {
        const [, user1, repo1] = match1;
        const [, user2, repo2] = match2;
        return user1.toLowerCase() === user2.toLowerCase() && 
               repo1.toLowerCase() === repo2.toLowerCase();
      }
    } catch (e) {
      // 如果解析失败，继续使用URL直接比较的结果
    }
    
    return false;
  }

  // 获取已安装的插件列表
  getInstalledPlugins(): any[] {
    try {
      const installedPlugins: any[] = [];
      
      // 确保目录存在
      if (!fs.existsSync(CUSTOM_NODES_PATH)) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.info('plugin.cache.create_custom_nodes_dir', { path: CUSTOM_NODES_PATH, lng: logLang });
        fs.mkdirSync(CUSTOM_NODES_PATH, { recursive: true });
        return [];
      }
      
      // 确保禁用插件目录存在
      if (!fs.existsSync(DISABLED_PLUGINS_PATH)) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.info('plugin.cache.create_disabled_dir', { path: DISABLED_PLUGINS_PATH, lng: logLang });
        fs.mkdirSync(DISABLED_PLUGINS_PATH, { recursive: true });
      }
      
      // 读取所有已启用插件目录（排除备份目录 *_backup_<timestamp>）
      const directories = fs.readdirSync(CUSTOM_NODES_PATH, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.') && !/_backup_\d+$/.test(dirent.name))
        .map(dirent => dirent.name);
      
      // 处理已启用的插件
      for (const dir of directories) {
        const pluginInfo = this.getPluginInfo(dir, false);
        if (pluginInfo) {
          installedPlugins.push(pluginInfo);
        }
      }
      
      // 读取所有禁用的插件目录
      if (fs.existsSync(DISABLED_PLUGINS_PATH)) {
        const disabledDirectories = fs.readdirSync(DISABLED_PLUGINS_PATH, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.') && !/_backup_\d+$/.test(dirent.name))
          .map(dirent => dirent.name);
        
        // 处理禁用的插件
        for (const dir of disabledDirectories) {
          const pluginInfo = this.getPluginInfo(dir, true);
          if (pluginInfo) {
            installedPlugins.push(pluginInfo);
          }
        }
      }
      
      return installedPlugins;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.cache.get_installed_list_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return [];
    }
  }
  
  // 获取单个插件的信息（委托给 PluginInfoManager，统一实现）
  private getPluginInfo(dir: string, isDisabled: boolean): any {
    try {
      const manager = new PluginInfoManager();
      const info = manager.getPluginInfo(dir, isDisabled);
      if (!info) return null;
      // 兼容旧字段：github/stars
      return {
        ...info,
        github: info.repository || '',
        stars: info.github_stars || 0
      };
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.cache.get_plugin_info_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return null;
    }
  }

  // 刷新插件缓存
  async refreshPluginsCache(): Promise<void> {
    // try {
    //   console.log('[API] 刷新插件缓存');
    //   // 只更新安装状态，不强制从网络获取
    //   cachedPlugins = await this.fetchComfyUIManagerPlugins(false);
    //   lastFetchTime = Date.now();
    //   console.log(`[API] 插件缓存刷新完成，当前有 ${cachedPlugins.length} 个插件`);
    // } catch (error) {
    //   console.error('[API] 刷新插件缓存失败:', error);
    // }
  }

  // 刷新已安装插件列表
  async refreshInstalledPlugins(): Promise<any[]> {
    try {
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.cache.refresh_installed', { lng: logLang });
      
      // 获取最新的已安装插件列表
      const installedPlugins = this.getInstalledPlugins();
      
      // 如果缓存为空或过期，先获取最新的ComfyUI-Manager插件列表
      if (cachedPlugins.length === 0 || (Date.now() - lastFetchTime) >= CACHE_DURATION) {
        await this.refreshPluginsCache();
      }
      
              // 更新缓存中已安装插件的状态
        if (cachedPlugins.length > 0) {
          // 创建一个映射以快速查找插件
          const installedMap = new Map();
          installedPlugins.forEach(plugin => {
            // 使用小写ID作为键
            installedMap.set(plugin.id.toLowerCase(), {
              installed: true,
              installedOn: plugin.installedOn,
              disabled: plugin.disabled,
              github: plugin.repository || plugin.github, // 保存GitHub URL用于后续比较
              repository: plugin.repository || plugin.github
            });
          });
        
        // 更新缓存中的插件状态（本地优先覆盖，包括 version 等关键字段）
        cachedPlugins = cachedPlugins.map(plugin => {
          // 优先通过ID匹配（忽略大小写）
          const installed = installedPlugins.find(p => p.id.toLowerCase() === plugin.id.toLowerCase());
          if (installed) {
            // 用本地信息覆盖网络信息（本地优先）
            const merged = {
              ...plugin,
              ...installed,
              installed: true,
              installedOn: installed.installedOn,
              disabled: installed.disabled,
              // 向后兼容字段
              github: (installed as any).repository || (installed as any).github || plugin.github,
              stars: plugin.github_stars || plugin.stars
            };
            // 明确确保 version/name/description/repository 采用本地解析
            merged.version = installed.version || plugin.version;
            merged.name = installed.name || plugin.name;
            merged.description = installed.description || plugin.description;
            merged.repository = installed.repository || plugin.repository || plugin.github;
            return merged;
          } else if (plugin.repository || plugin.github) {
            // 如果ID没匹配上但有GitHub URL，尝试用GitHub URL匹配
            const matchedByGithub = this.findPluginByGithubUrl(plugin, installedPlugins);
            if (matchedByGithub) {
              const merged = {
                ...plugin,
                ...matchedByGithub,
                installed: true,
                installedOn: matchedByGithub.installedOn,
                disabled: matchedByGithub.disabled,
                // 向后兼容字段
                github: (matchedByGithub as any).repository || (matchedByGithub as any).github || plugin.github,
                stars: plugin.github_stars || plugin.stars
              } as any;
              merged.version = matchedByGithub.version || plugin.version;
              merged.name = matchedByGithub.name || plugin.name;
              merged.description = matchedByGithub.description || plugin.description;
              merged.repository = matchedByGithub.repository || plugin.repository || plugin.github;
              return merged;
            }
          }
          
          return {
            ...plugin,
            installed: false,
            disabled: false,
            // 确保向后兼容性
            github: plugin.repository || plugin.github,
            stars: plugin.github_stars || plugin.stars
          };
        });
        
        // 也更新本地安装但不在缓存中的插件
        installedPlugins.forEach(plugin => {
          // 检查是否已存在（忽略大小写ID和GitHub URL）
          const exists = cachedPlugins.some(p => {
            const pUrl = p.repository || p.github;
            const pluginUrl = plugin.repository || plugin.github;
            return p.id.toLowerCase() === plugin.id.toLowerCase() || 
                   this.isSameGithubRepo(pUrl, pluginUrl);
          });
          
          if (!exists) {
            // 确保向后兼容性
            const pluginWithLegacy = {
              ...plugin,
              github: plugin.repository || plugin.github,
              stars: plugin.github_stars || plugin.stars
            };
            cachedPlugins.push(pluginWithLegacy);
          }
        });
      }
      
      return installedPlugins;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.cache.refresh_installed_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      throw error;
    }
  }

  // 获取缓存状态
  getCacheStatus(): { count: number, lastUpdate: number, isValid: boolean } {
    const currentTime = Date.now();
    return {
      count: cachedPlugins.length,
      lastUpdate: lastFetchTime,
      isValid: (currentTime - lastFetchTime) < CACHE_DURATION
    };
  }

  // 清空缓存
  clearCache(): void {
    cachedPlugins = [];
    lastFetchTime = 0;
    const logLang = i18nLogger.getLocale();
    i18nLogger.info('plugin.cache.cleared', { lng: logLang });
  }

  // 清除特定插件的缓存
  async clearPluginCache(pluginId: string): Promise<void> {
    try {
      const logLang = i18nLogger.getLocale();
      i18nLogger.info('plugin.cache.clear_plugin_start', { pluginId, beforeCount: cachedPlugins.length, beforeTime: lastFetchTime, lng: logLang });
      
      // 清除全局缓存，强制下次获取时重新计算
      cachedPlugins = [];
      lastFetchTime = 0;
      
      i18nLogger.info('plugin.cache.clear_plugin_completed', { pluginId, afterCount: cachedPlugins.length, afterTime: lastFetchTime, lng: logLang });
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.cache.clear_plugin_failed', { pluginId, message: error instanceof Error ? error.message : String(error), lng: logLang });
    }
  }

  /**
   * 启动定时更新 all_nodes.mirrored.json
   * Start periodic update for all_nodes.mirrored.json
   * 从 DOWNLOAD_CDN_URL/comfy/all_nodes.mirrored.json 下载最新版本，每天更新一次
   */
  private startPeriodicUpdate(): void {
    try {
      console.log('[API] Starting periodic update for all_nodes.mirrored.json');
      
      // 首次启动时立即尝试更新一次（延迟5秒，避免与初始化冲突）
      // Initial update after 5 seconds to avoid conflicts with initialization
      setTimeout(() => {
        this.updateAllNodesCache().catch(err => {
          console.error('[API] Initial update of all_nodes.mirrored.json failed:', err);
        });
      }, 5000);
      
      // 设置定时器，每24小时更新一次
      // Set timer to update every 24 hours
      updateTimer = setInterval(() => {
        this.updateAllNodesCache().catch(err => {
          console.error('[API] Periodic update of all_nodes.mirrored.json failed:', err);
        });
      }, ALL_NODES_UPDATE_INTERVAL);
      
      console.log(`[API] Periodic update scheduled: every ${ALL_NODES_UPDATE_INTERVAL / (60 * 60 * 1000)} hours`);
    } catch (error) {
      console.error('[API] Failed to start periodic update:', error);
    }
  }

  /**
   * 停止定时更新
   * Stop periodic update
   */
  public stopPeriodicUpdate(): void {
    if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
      console.log('[API] Periodic update stopped');
    }
  }

  /**
   * 更新 all_nodes.mirrored.json 文件
   * Update all_nodes.mirrored.json file from CDN
   * 从 DOWNLOAD_CDN_URL/comfy/all_nodes.mirrored.json 下载最新版本并替换本地文件
   */
  private async updateAllNodesCache(): Promise<void> {
    try {
      const cdnUrl = process.env.DOWNLOAD_CDN_URL || '';
      if (!cdnUrl) {
        console.log('[API] DOWNLOAD_CDN_URL not configured, skipping all_nodes.mirrored.json update');
        return;
      }

      const downloadUrl = `${cdnUrl}/comfy/all_nodes.mirrored.json`;
      const localFilePath = path.join(__dirname, 'all_nodes.mirrored.json');
      
      console.log(`[API] Updating all_nodes.mirrored.json from: ${downloadUrl}`);
      
      // 下载新版本
      const response = await superagent
        .get(downloadUrl)
        .timeout({ response: 30000, deadline: 60000 });
      
      // 验证响应是否为有效的 JSON
      const newData = JSON.parse(response.text);
      
      if (!newData.nodes || !Array.isArray(newData.nodes)) {
        throw new Error('Invalid all_nodes.mirrored.json format: missing nodes array');
      }
      
      console.log(`[API] Downloaded all_nodes.mirrored.json with ${newData.nodes.length} nodes`);
      
      // 备份旧文件（如果存在）
      if (fs.existsSync(localFilePath)) {
        const backupPath = `${localFilePath}.backup`;
        fs.copyFileSync(localFilePath, backupPath);
        console.log(`[API] Backup created: ${backupPath}`);
      }
      
      // 写入新文件
      fs.writeFileSync(localFilePath, JSON.stringify(newData, null, 2), 'utf-8');
      console.log(`[API] Successfully updated all_nodes.mirrored.json at ${new Date().toISOString()}`);
      
      // 清除缓存，强制重新加载
      cachedPlugins = [];
      lastFetchTime = 0;
      
      // 重新加载插件缓存
      await this.loadFromLocalFile();
      
    } catch (error) {
      console.error('[API] Failed to update all_nodes.mirrored.json:', error);
      // 更新失败不影响正常运行，继续使用现有文件
    }
  }

  /**
   * 手动触发更新 all_nodes.mirrored.json（可供API调用）
   * Manually trigger update of all_nodes.mirrored.json (for API calls)
   * 可通过 POST /api/plugins/update-cache 端点调用
   */
  public async manualUpdateAllNodesCache(): Promise<{ success: boolean; message: string; nodesCount?: number }> {
    try {
      await this.updateAllNodesCache();
      return {
        success: true,
        message: 'all_nodes.mirrored.json updated successfully',
        nodesCount: cachedPlugins.length
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

} 