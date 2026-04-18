import * as fs from 'fs';
import * as path from 'path';
import * as TOML from '@iarna/toml';
import { i18nLogger } from '../../utils/logger';

// 确定环境和路径
const isDev = process.env.NODE_ENV !== 'production';

// 在开发环境中使用当前目录，生产环境使用配置路径
const COMFYUI_PATH = process.env.COMFYUI_PATH || 
  (isDev ? path.join(process.cwd(), 'comfyui') : '/root/ComfyUI');

const CUSTOM_NODES_PATH = path.join(COMFYUI_PATH, 'custom_nodes');

// 确保有一个 .disabled 目录用于存放禁用的插件
const DISABLED_PLUGINS_PATH = path.join(CUSTOM_NODES_PATH, '.disabled');

// Publisher information interface
export interface PublisherInfo {
  id: string;
  name: string;
  description?: string;
  logo?: string;
  website?: string;
  support?: string;
  source_code_repo?: string;
  status: string;
  createdAt: string;
  members: Array<{
    user: {
      name: string;
    };
  }>;
}

// Version information interface
export interface VersionInfo {
  id: string;
  version: string;
  changelog?: string;
  createdAt: string;
  deprecated: boolean;
  downloadUrl?: string;
  node_id: string;
  status: string;
  dependencies?: string[];
  supported_accelerators?: string[] | null;
  supported_comfyui_frontend_version?: string;
  supported_comfyui_version?: string;
  supported_os?: string[] | null;
}

// Updated PluginMetadata interface to match new plugin list structure
export interface PluginMetadata {
  // Basic identification
  id: string;
  name: string;
  description: string;
  author: string;
  repository: string; // GitHub repository URL
  
  // Version information
  version: string;
  latest_version?: VersionInfo;
  versions?: VersionInfo[];
  
  // Publisher information
  publisher?: PublisherInfo;
  
  // Status and metadata
  status: string;
  status_detail?: string;
  rating: number;
  downloads: number;
  github_stars: number;
  
  // Visual elements
  icon?: string;
  banner_url?: string;
  category?: string;
  
  // Technical details
  license?: string;
  tags?: string[];
  dependencies?: string[];
  requirements?: string[];
  
  // Compatibility
  supported_accelerators?: string[] | null;
  supported_comfyui_frontend_version?: string;
  supported_comfyui_version?: string;
  supported_os?: string[] | null;
  
  // Timestamps
  created_at: string;
  lastModified?: string;
  
  // Installation status (local state)
  installed: boolean;
  installedOn?: string;
  disabled: boolean;
  
  // File system info
  hasInstallScript?: boolean;
  hasRequirementsFile?: boolean;
  size?: number;
}

export class PluginInfoManager {
  
  constructor() {}

  // 获取插件的Git信息
  getGitInfo(pluginPath: string): { repoUrl: string; branch: string; commit: string } | null {
    try {
      const gitConfig = path.join(pluginPath, '.git', 'config');
      if (!fs.existsSync(gitConfig)) {
        return null;
      }

      const configContent = fs.readFileSync(gitConfig, 'utf-8');
      const urlMatch = configContent.match(/url\s*=\s*(.+)/i);
      
      if (!urlMatch) {
        return null;
      }

      const repoUrl = urlMatch[1].trim();
      
      // 尝试获取分支信息
      let branch = 'main';
      try {
        const headFile = path.join(pluginPath, '.git', 'HEAD');
        if (fs.existsSync(headFile)) {
          const headContent = fs.readFileSync(headFile, 'utf-8').trim();
          const branchMatch = headContent.match(/ref: refs\/heads\/(.+)/);
          if (branchMatch) {
            branch = branchMatch[1];
          }
        }
      } catch (e) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.error('plugin.info.read_branch_failed', { message: String(e), lng: logLang });
      }

      // 尝试获取提交信息
      let commit = '';
      try {
        const headFile = path.join(pluginPath, '.git', 'HEAD');
        if (fs.existsSync(headFile)) {
          const headContent = fs.readFileSync(headFile, 'utf-8').trim();
          if (headContent.length === 40) {
            // 直接是commit hash
            commit = headContent;
          } else {
            // 是ref，需要读取对应的commit
            const refMatch = headContent.match(/ref: refs\/heads\/(.+)/);
            if (refMatch) {
              const refFile = path.join(pluginPath, '.git', 'refs', 'heads', refMatch[1]);
              if (fs.existsSync(refFile)) {
                commit = fs.readFileSync(refFile, 'utf-8').trim();
              }
            }
          }
        }
      } catch (e) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.error('plugin.info.read_commit_failed', { message: String(e), lng: logLang });
      }

      return { repoUrl, branch, commit };
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.info.read_git_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return null;
    }
  }

  // 从pyproject.toml获取元数据
  getPyprojectMetadata(pluginPath: string): Partial<PluginMetadata> {
    try {
      // 支持 release 压缩包在插件根目录下解压出顶层子目录的情况
      // 先在根目录找, 若不存在则在第一/二级子目录中搜索
      const findPyproject = (root: string, maxDepth: number = 2): string | null => {
        const candidate = path.join(root, 'pyproject.toml');
        if (fs.existsSync(candidate)) return candidate;
        if (maxDepth <= 0) return null;
        try {
          const entries = fs.readdirSync(root, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const sub = path.join(root, entry.name);
              const result = findPyproject(sub, maxDepth - 1);
              if (result) return result;
            }
          }
        } catch {
          // ignore
        }
        return null;
      };

      const pyprojectPath = findPyproject(pluginPath);
      if (!pyprojectPath) return {};

      const pyprojectContent = fs.readFileSync(pyprojectPath, 'utf-8');
      const metadata: Partial<PluginMetadata> = {};

      // 使用 TOML 解析器解析文件
      const pyprojectData = TOML.parse(pyprojectContent);
      // 解析 pyproject 文件
      
      // 解析基本信息
      if (pyprojectData.project) {
        const project = pyprojectData.project as any;
        
        if (project.name) metadata.name = project.name;
        if (project.version) metadata.version = project.version;
        if (project.description) metadata.description = project.description;
        
        // 处理作者信息
        if (project.authors && Array.isArray(project.authors)) {
          // 如果 authors 是对象数组
          if (project.authors.length > 0) {
            const firstAuthor = project.authors[0];
            if (typeof firstAuthor === 'string') {
              metadata.author = firstAuthor;
            } else if (firstAuthor.name) {
              metadata.author = firstAuthor.name;
            } else if (firstAuthor.email) {
              metadata.author = firstAuthor.email;
            }
          }
        } else if (project.author) {
          // 如果 author 是字符串
          metadata.author = project.author;
        }
        
        // 处理依赖信息
        if (project.dependencies && Array.isArray(project.dependencies)) {
          metadata.dependencies = project.dependencies;
        }
        
        // 处理许可证信息
        if (project.license) {
          if (typeof project.license === 'string') {
            metadata.license = project.license;
          } else if (project.license.file) {
            metadata.license = project.license.file;
          }
        }
      }

      // 处理 [tool.comfy] 部分（ComfyUI 特定配置）
      if (pyprojectData.tool && typeof pyprojectData.tool === 'object' && pyprojectData.tool !== null) {
        const toolSection = pyprojectData.tool as any;
        if (toolSection.comfy && typeof toolSection.comfy === 'object') {
          const comfyTool = toolSection.comfy;
          if (comfyTool.DisplayName) {
            metadata.name = comfyTool.DisplayName;
          }
        }
      }

      // 解析完成

      return metadata;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.info.read_pyproject_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return {};
    }
  }

  // 从setup.py获取元数据
  getSetupPyMetadata(pluginPath: string): Partial<PluginMetadata> {
    try {
      const setupPath = path.join(pluginPath, 'setup.py');
      if (!fs.existsSync(setupPath)) {
        return {};
      }

      const setupContent = fs.readFileSync(setupPath, 'utf-8');
      const metadata: Partial<PluginMetadata> = {};

      // 解析基本信息
      const nameMatch = setupContent.match(/name\s*=\s*["']([^"']+)["']/);
      const versionMatch = setupContent.match(/version\s*=\s*["']([^"']+)["']/);
      const descriptionMatch = setupContent.match(/description\s*=\s*["']([^"']+)["']/);
      const authorMatch = setupContent.match(/author\s*=\s*["']([^"']+)["']/);

      if (nameMatch) metadata.name = nameMatch[1];
      if (versionMatch) metadata.version = versionMatch[1];
      if (descriptionMatch) metadata.description = descriptionMatch[1];
      if (authorMatch) metadata.author = authorMatch[1];

      return metadata;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.info.read_setup_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return {};
    }
  }

  // 检查插件文件结构
  getPluginFileStructure(pluginPath: string): {
    hasInstallScript: boolean;
    hasRequirementsFile: boolean;
    hasReadme: boolean;
    hasLicense: boolean;
    pythonFiles: string[];
    requirements: string[];
  } {
    try {
      const files = fs.readdirSync(pluginPath);
      
      const result = {
        hasInstallScript: false,
        hasRequirementsFile: false,
        hasReadme: false,
        hasLicense: false,
        pythonFiles: [] as string[],
        requirements: [] as string[]
      };

      // 检查各种文件
      result.hasInstallScript = files.some(f => 
        f === 'install.py' || f === 'setup.py' || f === 'install.sh'
      );
      
      result.hasRequirementsFile = files.some(f => 
        f === 'requirements.txt' || f === 'requirements-dev.txt'
      );
      
      result.hasReadme = files.some(f => 
        f.toLowerCase().includes('readme') || f.toLowerCase().includes('说明')
      );
      
      result.hasLicense = files.some(f => 
        f.toLowerCase().includes('license') || f.toLowerCase().includes('licence')
      );

      // 获取Python文件
      result.pythonFiles = files.filter(f => 
        f.endsWith('.py') && !f.startsWith('__')
      );

      // 读取requirements.txt
      if (result.hasRequirementsFile) {
        try {
          const requirementsPath = path.join(pluginPath, 'requirements.txt');
          if (fs.existsSync(requirementsPath)) {
            const content = fs.readFileSync(requirementsPath, 'utf-8');
            result.requirements = content
              .split('\n')
              .map(line => line.trim())
              .filter(line => line && !line.startsWith('#'))
              .map(line => line.split('==')[0].split('>=')[0].split('<=')[0].split('~=')[0]);
          }
        } catch (e) {
          const logLang = i18nLogger.getLocale();
          i18nLogger.error('plugin.info.read_requirements_failed', { message: String(e), lng: logLang });
        }
      }

      return result;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.info.check_structure_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return {
        hasInstallScript: false,
        hasRequirementsFile: false,
        hasReadme: false,
        hasLicense: false,
        pythonFiles: [],
        requirements: []
      };
    }
  }

  // 获取插件的完整信息
  getPluginInfo(dir: string, isDisabled: boolean = false): PluginMetadata | null {
    try {
      const pluginPath = isDisabled 
        ? path.join(DISABLED_PLUGINS_PATH, dir)
        : path.join(CUSTOM_NODES_PATH, dir);
      
      if (!fs.existsSync(pluginPath)) {
        return null;
      }

      // 获取Git信息
      const gitInfo = this.getGitInfo(pluginPath);
      
      // 获取元数据（优先从pyproject.toml，然后是setup.py）
      let metadata = this.getPyprojectMetadata(pluginPath);
      if (!metadata.name) {
        metadata = this.getSetupPyMetadata(pluginPath);
      }
      
      // 获取文件结构信息
      const fileStructure = this.getPluginFileStructure(pluginPath);
      
      // 获取文件统计信息
      let size = 0;
      let lastModified = '';
      try {
        const stats = fs.statSync(pluginPath);
        size = stats.size;
        lastModified = stats.mtime.toISOString();
      } catch (e) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.error('plugin.info.get_stats_failed', { message: String(e), lng: logLang });
      }

      // 获取安装日期（使用目录创建时间）
      let installedOn;
      try {
        const stats = fs.statSync(pluginPath);
        installedOn = stats.birthtime.toISOString();
      } catch (e) {
        installedOn = new Date().toISOString();
      }

      // 如果版本尚未可用，不抛错，使用安全兜底并记录警告，避免时序竞争造成失败
      if (metadata.version === undefined) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.warn('plugin.info.version_undefined', { plugin: dir, lng: logLang });
        metadata.version = 'nv-1';
      }

      // 构建完整的插件信息 - 更新为新的数据结构
      const pluginInfo: PluginMetadata = {
        // Basic identification
        id: dir,
        name: metadata.name || dir,
        description: metadata.description || ``,
        author: metadata.author || '',
        repository: gitInfo?.repoUrl || '',
        
        // Version information
        version: metadata.version || 'nv-1',
        
        // Status and metadata
        status: 'NodeStatusActive',
        status_detail: '',
        rating: 0,
        downloads: 0,
        github_stars: 0,
        
        // Visual elements
        icon: '',
        banner_url: '',
        category: '',
        
        // Technical details
        license: '{}',
        tags: [],
        dependencies: metadata.dependencies || [],
        requirements: fileStructure.requirements,
        
        // Compatibility
        supported_accelerators: null,
        supported_comfyui_frontend_version: '',
        supported_comfyui_version: '',
        supported_os: null,
        
        // Timestamps
        created_at: installedOn,
        lastModified,
        
        // Installation status (local state)
        installed: true,
        installedOn,
        disabled: isDisabled,
        
        // File system info
        hasInstallScript: fileStructure.hasInstallScript,
        hasRequirementsFile: fileStructure.hasRequirementsFile,
        size
      };

      return pluginInfo;
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.info.get_info_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return null;
    }
  }

  // 获取所有已安装插件的详细信息
  getAllInstalledPluginsInfo(): PluginMetadata[] {
    try {
      const installedPlugins: PluginMetadata[] = [];
      
      // 确保目录存在
      if (!fs.existsSync(CUSTOM_NODES_PATH)) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.info('plugin.info.create_custom_nodes_dir', { path: CUSTOM_NODES_PATH, lng: logLang });
        fs.mkdirSync(CUSTOM_NODES_PATH, { recursive: true });
        return [];
      }
      
      // 确保禁用插件目录存在
      if (!fs.existsSync(DISABLED_PLUGINS_PATH)) {
        const logLang = i18nLogger.getLocale();
        i18nLogger.info('plugin.info.create_disabled_dir', { path: DISABLED_PLUGINS_PATH, lng: logLang });
        fs.mkdirSync(DISABLED_PLUGINS_PATH, { recursive: true });
      }
      
      // 读取所有已启用插件目录
      const directories = fs.readdirSync(CUSTOM_NODES_PATH, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
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
          .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
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
      i18nLogger.error('plugin.info.get_installed_list_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return [];
    }
  }

  // 验证插件完整性
  validatePlugin(pluginPath: string): {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  } {
    const result = {
      isValid: true,
      issues: [] as string[],
      warnings: [] as string[]
    };

    try {
      if (!fs.existsSync(pluginPath)) {
        result.isValid = false;
        result.issues.push('插件目录不存在');
        return result;
      }

      const files = fs.readdirSync(pluginPath);
      
      // 检查必要的文件
      if (!files.some(f => f.endsWith('.py'))) {
        result.warnings.push('未找到Python文件');
      }

      if (!files.some(f => f === 'requirements.txt')) {
        result.warnings.push('未找到requirements.txt文件');
      }

      if (!files.some(f => f === 'README.md' || f.toLowerCase().includes('readme'))) {
        result.warnings.push('未找到README文件');
      }

      // 检查目录结构
      const hasValidStructure = files.some(f => 
        f === 'nodes' || f === 'custom_nodes' || f === 'scripts' || f === 'workflows'
      );
      
      if (!hasValidStructure) {
        result.warnings.push('目录结构可能不符合ComfyUI插件标准');
      }

    } catch (error) {
      result.isValid = false;
      result.issues.push(`读取插件目录失败: ${error}`);
    }

    return result;
  }

  // 获取插件的依赖关系
  getPluginDependencies(pluginPath: string): {
    direct: string[];
    indirect: string[];
    conflicts: string[];
  } {
    try {
      const requirementsPath = path.join(pluginPath, 'requirements.txt');
      if (!fs.existsSync(requirementsPath)) {
        return { direct: [], indirect: [], conflicts: [] };
      }

      const content = fs.readFileSync(requirementsPath, 'utf-8');
      const requirements = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));

      // 这里可以添加更复杂的依赖分析逻辑
      // 目前只返回直接依赖
      return {
        direct: requirements,
        indirect: [],
        conflicts: []
      };
    } catch (error) {
      const logLang = i18nLogger.getLocale();
      i18nLogger.error('plugin.info.get_dependencies_failed', { message: error instanceof Error ? error.message : String(error), lng: logLang });
      return { direct: [], indirect: [], conflicts: [] };
    }
  }
} 