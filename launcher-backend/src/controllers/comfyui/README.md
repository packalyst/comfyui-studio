# ComfyUI Controller 模块拆分

## 概述

原始的 `comfyui.controller.ts` 文件已经成功拆分为多个小文件，提高了代码的可维护性和可读性。

## 文件结构

### 核心文件

- **`comfyui.controller.ts`** (192 行) - 主控制器，负责处理 HTTP 请求
- **`index.ts`** (22 行) - 模块导出文件，提供统一的导入接口

### 服务类

- **`process.service.ts`** (554 行) - 进程管理服务，处理 ComfyUI 的启动、停止、重置等操作
- **`log.service.ts`** (294 行) - 日志服务，处理日志记录和本地化
- **`version.service.ts`** (130 行) - 版本信息服务，获取 ComfyUI 和前端版本信息

### 工具和类型

- **`utils.ts`** (170 行) - 工具函数，包含通用功能
- **`types.ts`** (79 行) - 类型定义文件
- **`proxy.service.ts`** (46 行) - 代理服务器创建
- **`html-generator.ts`** (175 行) - HTML 页面生成器

## 拆分效果

### 原始文件
- 单个文件：约 1400+ 行代码

### 拆分后
- 主控制器：192 行（减少 86%）
- 总文件数：9 个文件
- 总代码行数：1662 行（包含注释和空行）

## 模块职责

### ComfyUIController
- 处理 HTTP 请求路由
- 协调各个服务
- 返回响应数据

### ProcessService
- ComfyUI 进程管理
- 启动/停止/重置操作
- 插件清理功能

### LogService
- 日志记录和管理
- 多语言日志本地化
- 日志文件操作

### VersionService
- 版本信息获取
- 版本缓存管理

### Utils
- 通用工具函数
- 网络检查
- 语言检测

## 使用方式

```typescript
// 导入主控制器
import { ComfyUIController } from './comfyui.controller';

// 或者导入特定服务
import { ProcessService, LogService, VersionService } from './index';

// 创建控制器实例
const controller = new ComfyUIController();
```

## 优势

1. **可维护性**：每个文件职责单一，易于理解和修改
2. **可测试性**：各个服务可以独立测试
3. **可重用性**：服务类可以在其他地方重用
4. **代码组织**：相关功能集中在一起
5. **团队协作**：不同开发者可以同时修改不同文件

## 注意事项

- 所有导入路径已更新为相对路径
- 类型定义统一在 `types.ts` 中
- 服务类之间通过依赖注入进行协作
- 保持了原有的 API 接口不变
