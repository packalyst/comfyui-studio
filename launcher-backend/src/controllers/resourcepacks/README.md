# 资源包管理模块

这个模块负责管理和安装包含多种资源类型的资源包。原始的大型控制器文件已被拆分为多个更小、更专注的模块。

## 文件结构

### 核心文件

- **`resource-packs.controller.ts`** - 主控制器，继承自基础控制器，提供公共API接口
- **`base-controller.ts`** - 基础控制器，包含核心逻辑和公共方法
- **`index.ts`** - 模块导出文件

### 安装器模块

- **`model-installer.ts`** - 模型资源安装器，处理模型下载和安装
- **`plugin-installer.ts`** - 插件资源安装器，处理插件安装
- **`workflow-installer.ts`** - 工作流资源安装器，处理工作流下载
- **`custom-installer.ts`** - 自定义资源安装器，处理自定义资源下载

### 工具模块

- **`progress-manager.ts`** - 进度管理器，负责跟踪和管理安装进度

### 类型定义

- **`../../types/resource-packs.types.ts`** - 所有相关的类型定义和接口

## 模块职责

### ResourcePacksController
- 提供HTTP API接口
- 处理请求参数验证
- 协调各个安装器的工作

### BaseResourcePacksController
- 资源包加载和验证
- 安装流程协调
- 公共方法实现

### ModelInstaller
- 模型文件下载
- 模型目录管理
- Hugging Face端点配置处理

### PluginInstaller
- 插件GitHub仓库克隆
- 插件依赖检查
- 插件安装进度跟踪

### WorkflowInstaller
- 工作流文件下载
- 工作流目录管理

### CustomInstaller
- 自定义资源下载
- 自定义路径处理

### ProgressManager
- 安装进度跟踪
- 任务状态管理
- 取消操作处理

## 使用方式

```typescript
import { ResourcePacksController } from './resourcepacks';

const controller = new ResourcePacksController();

// 获取资源包列表
await controller.getResourcePacks(ctx);

// 安装资源包
await controller.installResourcePack(ctx);

// 获取安装进度
await controller.getInstallProgress(ctx);

// 取消安装
await controller.cancelInstallation(ctx);
```

## 优势

1. **模块化** - 每个文件专注于特定功能
2. **可维护性** - 代码更易理解和修改
3. **可测试性** - 每个模块可以独立测试
4. **可扩展性** - 易于添加新的资源类型
5. **代码复用** - 公共逻辑在基类中实现
