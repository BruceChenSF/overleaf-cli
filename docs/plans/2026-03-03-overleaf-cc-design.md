# Overleaf CC - 浏览器插件设计文档

**创建日期：** 2026-03-03
**状态：** 设计已批准

## 概述

一个浏览器扩展插件，为 Overleaf 网页注入模拟终端功能，使用 WebContainer 在浏览器中运行 Claude Code CLI 和通用 Shell 命令。

### 核心功能

1. 在 Overleaf `ide-redesign-toolbar` nav 中注入启动按钮
2. 独立窗口中显示 xterm.js 终端
3. WebContainer 提供隔离的 Node.js 环境
4. 通过 Overleaf API 实时同步项目文件
5. 复用用户 Overleaf 登录会话进行认证

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         浏览器扩展环境                            │
│  ┌─────────────────┐         ┌─────────────────────────────────┐│
│  │ Content Script  │         │      Background Service Worker  ││
│  │  ┌───────────┐  │         │  ┌──────────────────────────┐  ││
│  │  │ UI 注入    │  │         │  │  Overleaf API Manager    │  ││
│  │  │ - 按钮注入  │  │         │  │  - 文件同步               │  ││
│  │  │ - 窗口管理  │  │         │  │  - 会话管理               │  ││
│  │  └─────┬─────┘  │         │  └──────────┬───────────────┘  ││
│  │        │ Message│         │             │                  ││
│  │        │Passing │         │             │                  ││
│  └────────┼─────────┘         └─────────────┼──────────────────┘│
│           │                                │                     │
│           ▼                                ▼                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    独立终端窗口                            ││
│  │  ┌───────────────────────────────────────────────────────┐ ││
│  │  │              xterm.js Terminal UI                     │ ││
│  │  └─────────────────────┬─────────────────────────────────┘ ││
│  │                        │                                     ││
│  │                        ▼                                     ││
│  │  ┌───────────────────────────────────────────────────────┐ ││
│  │  │            WebContainer Runtime                       │ ││
│  │  │  - Node.js 环境                                        │ ││
│  │  │  - 文件系统 (虚拟 /home/workspace)                     │ ││
│  │  │  - claude-code CLI                                    │ ││
│  │  └───────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 组件设计

### 1. Content Script (`content/injector.ts`)

**职责：**
- 检测 Overleaf 页面加载完成
- 查找 `.ide-redesign-toolbar nav` 元素
- 注入启动按钮（图标 + 工具提示）
- 监听按钮点击事件，发送 `OPEN_TERMINAL` 消息
- 接收来自 background 的状态更新

### 2. Background Service Worker (`background/service-worker.ts`)

**职责：**
- 监听 `OPEN_TERMINAL` 消息，打开终端窗口
- 管理 Overleaf 会话
- 处理文件同步请求
- 与 WebContainer 通信

### 3. Overleaf API Manager (`background/overleaf-api.ts`)

**API 端点：**
- `GET /project/:id/docs` - 获取项目文件列表
- `GET /project/:id/doc/:doc_id` - 获取文件内容
- `POST /project/:id/doc` - 创建/更新文件
- `DELETE /project/:id/doc/:doc_id` - 删除文件

**功能：**
- 会话复用：从 cookie 获取 `overleaf_session_id`
- 文件差异检测：仅在文件变更时同步
- 冲突解决：后写优先策略

### 4. Terminal Window (`terminal/index.html`)

独立窗口页面，包含：
- xterm.js 终端容器
- WebContainer 桥接脚本

### 5. WebContainer Bridge (`terminal/web-container-bridge.ts`)

**职责：**
- 初始化 WebContainer
- 挂载项目文件到 `/home/workspace`
- 安装 `claude-code`
- 连接 xterm.js I/O 到 WebContainer shell
- 监听文件变更，触发同步到 Overleaf

### 文件结构

```
overleaf-cc/
├── manifest.json              # Chrome 扩展配置
├── package.json
├── vite.config.ts            # Vite 配置
├── background/
│   ├── service-worker.ts     # 主服务
│   ├── overleaf-api.ts       # API 封装
│   └── sync-manager.ts       # 文件同步逻辑
├── content/
│   └── injector.ts           # UI 注入脚本
├── terminal/
│   ├── index.html            # 终端窗口页面
│   ├── terminal-ui.ts        # xterm.js 初始化
│   └── web-container-bridge.ts
├── shared/
│   └── types.ts              # 共享类型定义
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 数据流设计

### 启动流程

```
用户点击按钮
    │
    ▼
Content Script: 发送 OPEN_TERMINAL 消息
    │
    ▼
Background: 创建新窗口 (chrome.windows.create)
    │
    ▼
Terminal Window: 加载并初始化
    │
    ├──► WebContainer Bridge: 初始化 WebContainer
    │        │
    │        ├──► 请求项目文件 (Background → Overleaf API)
    │        │
    │        └──► 挂载到 /home/workspace
    │
    └──► xterm.js: 创建终端并连接 shell
             │
             └──► 启动 bash + claude-code
```

### 文件同步流程

**初始拉取（Overleaf → WebContainer）：**

```
WebContainer 启动
    │
    ▼
Background: 解析 URL 获取 project_id
    │
    ▼
Overleaf API: GET /project/:id/docs
    │
    ▼
Background: 递归获取所有文件内容
    │
    ▼
WebContainer: 写入到 /home/workspace
```

**实时同步（WebContainer → Overleaf）：**

```
Claude Code 修改文件
    │
    ▼
WebContainer: fs.watch() 监听文件变更
    │
    ▼
启动防抖定时器（2秒）
    │
    ├──► 如果2秒内还有修改：重置定时器
    │
    └──► 2秒无新修改：触发同步
             │
             ├──► 读取变更文件内容
             ├──► 计算文件哈希
             │
             ▼
             发送 SYNC_FILE 消息到 Background
                    │
                    ▼
             Background: Overleaf API 更新
```

## 认证设计

### 会话复用机制

```typescript
class OverleafSessionManager {
  async getSessionCookies(): Promise<string> {
    const cookies = await chrome.cookies.getAll({
      domain: 'overleaf.com'
    });

    const sessionCookie = cookies.find(c => c.name === 'overleaf_session_id');

    if (!sessionCookie) {
      throw new Error('User not logged in to Overleaf');
    }

    return sessionCookie.value;
  }
}
```

### 权限声明

```json
{
  "permissions": ["cookies", "storage", "tabs"],
  "host_permissions": ["https://*.overleaf.com/*"]
}
```

## 错误处理

### 错误分类

| 类别 | 处理策略 |
|------|----------|
| 网络错误 | 重试机制（最多3次），显示离线提示 |
| 认证错误 | 显示通知，引导用户登录 |
| 同步错误 | 保留本地副本，记录错误日志 |
| WebContainer 错误 | 显示详细错误，提供重启选项 |

### 重试机制

```typescript
class SyncManager {
  private MAX_RETRIES = 3;
  private RETRY_DELAYS = [1000, 3000, 5000];

  async syncFileWithRetry(filepath: string, content: string, attempt = 0) {
    try {
      await this.overleafAPI.updateFile(filepath, content);
    } catch (error) {
      if (attempt < this.MAX_RETRIES) {
        await sleep(this.RETRY_DELAYS[attempt]);
        return this.syncFileWithRetry(filepath, content, attempt + 1);
      } else {
        await this.saveToLocalBackup(filepath, content);
        this.showSyncError(filepath, error);
      }
    }
  }
}
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 扩展框架 | Chrome Extension Manifest V3 |
| 终端 UI | xterm.js |
| 执行环境 | Stackblitz WebContainer |
| 编译语言 | TypeScript |
| 构建工具 | Vite |
| API 通信 | Fetch API + Chrome Messaging |

## 安全考虑

1. **Cookies 仅存储在浏览器**：扩展不保存用户的会话凭证
2. **HTTPS only**：所有 API 通信必须通过 HTTPS
3. **最小权限原则**：只请求必要的权限
4. **同源策略**：Content Script 仅在 overleaf.com 域名下运行
