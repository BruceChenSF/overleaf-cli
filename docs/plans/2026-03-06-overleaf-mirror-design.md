# Overleaf Mirror - 双向文件同步系统设计文档

**创建日期：** 2026-03-06
**状态：** 设计已批准
**作者：** Claude Code + User

---

## 概述

一个轻量级的 API 转发器和本地后端服务系统，实现 Overleaf 与本地文件系统的实时双向同步，为 Claude Code 提供完整的论文项目上下文。

### 核心目标

- **实时协作工具**：Claude Code 能够实时感知 Overleaf 中的变化并做出响应
- **复制镜像模式**：浏览器扩展复制 API 请求到本地，原始请求继续发送到 Overleaf
- **直接文件访问**：后端服务将文件写入本地磁盘，Claude Code 直接访问
- **增量同步**：首次全量拉取，后续对比版本差异进行增量更新

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Overleaf 网页                            │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │         Content Script (API 拦截器 + 双向同步)            │ │
│  │  ┌─────────────────┐         ┌─────────────────┐         │ │
│  │  │   API 拦截器    │         │   同步执行器    │         │ │
│  │  │ (Overleaf→本地) │         │ (本地→Overleaf) │         │ │
│  │  └─────────────────┘         └─────────────────┘         │ │
│  └───────────────────┬─────────────────────┬─────────────────┘ │
└──────────────────────┼─────────────────────┼───────────────────┘
                       │ WebSocket           │ WebSocket
                       │ (镜像请求)          │ (同步指令)
                       ▼                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                  本地后端服务 (localhost:3456)                 │
│  ┌───────────────┴─────────────────────────────────────────┐   │
│  │                    WebSocket 服务器                     │   │
│  │     - 接收镜像请求（Overleaf→本地）                      │   │
│  │     - 接收同步指令（本地→Overleaf）                      │   │
│  └───────────────────────┬─────────────────────────────────┘   │
│                          │                                      │
│          ┌───────────────┴───────────────┐                     │
│          ▼                               ▼                     │
│  ┌─────────────────────┐    ┌─────────────────────────────┐   │
│  │   文件系统管理器     │    │    本地变更监视器           │   │
│  │ - Overleaf→本地镜像 │    │ - chokidar 监听文件变化     │   │
│  │ - 版本缓存管理      │    │ - 检测 Claude Code 的修改   │   │
│  └──────────┬──────────┘    └──────────┬──────────────────┘   │
│             │                          │                        │
│             └──────────┬───────────────┘                        │
│                        ▼                                        │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                   同步协调器                              │ │
│  │  - 冲突检测（比较本地/云端版本）                          │ │
│  │  - 同步队列（待上传变更）                                 │ │
│  │  - 重试机制（失败后自动重试）                             │ │
│  └───────────────────┬───────────────────────────────────────┘ │
│                      ▼                                         │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │              本地磁盘存储                                  │ │
│  │  ~/overleaf-mirror/{project_id}/                          │ │
│  │    ├── main.tex                                            │ │
│  │    ├── chapters/                                           │ │
│  │    └── .overleaf-state.json                               │ │
│  │        - localVersion: {文件路径: 版本号}                  │ │
│  │        - remoteVersion: {文件路径: 版本号}                  │ │
│  │        - pendingSync: [待同步任务]                         │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Claude Code                                │
│  - 直接读取/编辑 ~/overleaf-mirror/{project_id}/                │
│  - 修改被 chokidar 检测到                                      │
│  - 自动同步到 Overleaf                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心组件

### 1. 浏览器扩展 - Content Script

**职责：**
- 拦截 Overleaf 的所有 API 请求
- 复制请求到本地后端
- 执行从本地到 Overleaf 的同步

**需要拦截的 Overleaf API：**
- `GET /project/:id/docs` - 获取文件列表
- `GET /project/:id/doc/:doc_id` - 获取文件内容
- `POST /project/:id/doc` - 创建/更新文件
- `DELETE /project/:id/doc/:doc_id` - 删除文件
- `POST /project/:id/doc/:doc_id/rename` - 重命名文件
- `POST /project/:id/folder` - 创建文件夹

**关键方法：**
```typescript
class OverleafAPIInterceptor {
  setupFetchInterception(): void
  shouldMirrorRequest(url: string, method: string): boolean
  mirrorToBackend(request: APIRequest): Promise<void>
}

class SyncExecutor {
  executeSync(task: SyncTask): Promise<void>
  callOverleafAPI(endpoint: string, data: any): Promise<void>
}
```

### 2. 本地后端 - WebSocket 服务器

**职责：**
- WebSocket 服务器（端口 3456）
- 解析 Overleaf API 格式
- 与扩展双向通信

**WebSocket 消息类型：**
```typescript
// 扩展 → 后端（镜像 Overleaf 请求）
type MirrorRequest = {
  type: 'mirror'
  project_id: string
  api_endpoint: string
  method: string
  data: any
}

// 后端 → 扩展（同步到 Overleaf）
type SyncCommand = {
  type: 'sync'
  project_id: string
  operation: 'create' | 'update' | 'delete' | 'rename'
  path: string
  content?: string
  new_path?: string
}
```

### 3. 本地后端 - 文件系统管理器

**职责：**
- 初始化项目（全量/增量）
- 执行文件 CRUD 操作
- 维护版本缓存

**核心方法：**
```typescript
class FileSystemManager {
  async initializeProject(projectId: string): Promise<void>
  async incrementalSync(projectId: string): Promise<void>
  async createFile(path: string, content: string): Promise<void>
  async updateFile(path: string, content: string): Promise<void>
  async deleteFile(path: string): Promise<void>
  async renameFile(path: string, newPath: string): Promise<void>
  getLocalVersion(path: string): string
  updateLocalVersion(path: string, version: string): void
}
```

### 4. 本地后端 - 本地变更监视器

**职责：**
- 监听文件系统变化
- 区分变更来源（Overleaf vs Claude Code）

**核心方法：**
```typescript
class LocalChangeWatcher {
  private isApplyingOverleafChange = false

  async watch(projectPath: string): void

  onFileChange(path: string): void {
    if (this.isApplyingOverleafChange) {
      return // 这是 Overleaf 的修改
    }
    // 这是 Claude Code 的修改，加入同步队列
    this.syncCoordinator.enqueue({
      operation: 'update',
      path,
      timestamp: Date.now()
    })
  }
}
```

### 5. 本地后端 - 同步协调器

**职责：**
- 冲突检测
- 同步队列管理
- 重试机制

**核心方法：**
```typescript
class SyncCoordinator {
  private queue: SyncTask[] = []

  enqueue(task: SyncTask): void
  async processQueue(): Promise<void>
  detectConflict(path: string): boolean
  async resolveConflict(task: SyncTask): Promise<void>
}
```

### 6. 状态管理

**`.overleaf-state.json` 结构：**
```json
{
  "projectId": "abc123",
  "lastSync": 1709876543210,
  "localVersion": {
    "main.tex": "v3",
    "chapters/intro.tex": "v1"
  },
  "remoteVersion": {
    "main.tex": "v3",
    "chapters/intro.tex": "v1"
  },
  "pendingSync": [
    {
      "operation": "update",
      "path": "main.tex",
      "attempts": 0,
      "lastAttempt": 1709876540000
    }
  ]
}
```

---

## 关键流程

### 流程 1：项目初始化（首次打开）

```
用户在 Overleaf 打开项目
    ↓
扩展检测到项目 ID
    ↓
扩展请求后端初始化项目
    ↓
后端检查本地是否存在
    ↓
不存在 → 触发全量拉取
    ↓
后端向扩展请求：GET /project/{id}/docs
    ↓
扩展：正常请求 Overleaf（被拦截）
    ↓
原始请求继续 → Overleaf
复制到后端
    ↓
后端接收文件列表
    ↓
过滤：仅同步可编辑文件
    ↓
后端递归请求所有文件内容
    ↓
写入本地磁盘
    ↓
初始化 .overleaf-state.json
```

### 流程 2：增量初始化（非首次打开）

```
用户打开项目
    ↓
后端发现本地已存在
    ↓
读取 .overleaf-state.json
    ↓
扩展请求：GET /project/{id}/docs
    ↓
获取当前云端文件列表
    ↓
对比差异：
  - 云端有，本地没有 → 下载
  - 云端版本新 → 下载
  - 本地有，云端没有 → 删除本地
  - 版本相同 → 跳过
    ↓
更新差异文件
    ↓
更新 localVersion 和 remoteVersion
```

### 流程 3：Overleaf 修改同步到本地（实时）

```
用户在 Overleaf 编辑 main.tex
    ↓
Overleaf 发送请求：POST /project/{id}/doc
    ↓
扩展拦截请求
    ↓
原始请求继续 → Overleaf 服务器
复制到后端（异步，不阻塞）
    ↓
后端设置标志：isApplyingOverleafChange = true
    ↓
更新本地文件：main.tex
    ↓
更新版本：remoteVersion['main.tex'] = newVersion
    ↓
清除标志：isApplyingOverleafChange = false
```

### 流程 4：Claude Code 修改同步到 Overleaf（实时）

```
Claude Code 修改 main.tex
    ↓
chokidar 检测到变化
    ↓
检查标志：isApplyingOverleafChange?
    ↓
是 → 忽略
否 → 继续
    ↓
读取文件内容
    ↓
加入同步队列
    ↓
同步协调器处理队列
    ↓
检测冲突：localVersion === remoteVersion?
    ↓
有冲突 → 比较时间戳 → 决定策略
无冲突 → 继续
    ↓
通过 WebSocket 发送同步指令到扩展
    ↓
扩展调用 Overleaf API：POST /project/{id}/doc
    ↓
Overleaf 更新成功
    ↓
扩展通知后端：成功
    ↓
后端更新：remoteVersion['main.tex'] = newVersion
    ↓
从队列移除
```

### 流程 5：冲突解决

```
检测到冲突：
  localVersion['main.tex'] = 'v3'
  remoteVersion['main.tex'] = 'v4'
    ↓
策略选择（用户配置）
    ↓
策略 A：本地优先 → 强制上传
策略 B：云端优先 → 下载覆盖
策略 C：时间戳优先 → 较新的胜出
    ↓
执行同步
    ↓
同步双方版本号
```

---

## 文件过滤策略

### 白名单模式

**原则：同步模型可能需要理解的所有文件**

#### ✅ 同步（包括二进制）
```
📝 文本文件：
  - *.tex, *.bib, *.sty, *.cls, *.def
  - *.txt, *.md, *.markdown, *.json, *.yaml, *.yml, *.toml
  - *.c, *.cpp, *.h, *.hpp, *.py, *.js, *.ts, *.java
  - *.sh, *.bat, *.ps1, *.r, *.m, *.jl

🖼️ 图片文件（模型可理解）：
  - *.png, *.jpg, *.jpeg, *.gif, *.svg, *.eps, *.bmp, *.tiff

📄 PDF 文件（参考文献）：
  - *.pdf
```

#### ❌ 忽略（不可编辑且无理解价值）
```
📦 压缩文件：
  - *.zip, *.tar, *.gz, *.7z, *.rar

📊 办公文档（二进制格式）：
  - *.docx, *.xlsx, *.pptx

🔧 可执行文件/库：
  - *.exe, *.dll, *.so, *.dylib
  - *.o, *.a

🎵 音视频：
  - *.mp3, *.mp4, *.avi, *.mov
```

### 实现代码

```typescript
const SYNCABLE_EXTENSIONS = new Set([
  // 文本文件
  '.tex', '.bib', '.sty', '.cls', '.def',
  '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml',
  '.c', '.cpp', '.h', '.hpp', '.py', '.js', '.ts', '.java',
  '.sh', '.bat', '.ps1', '.r', '.m', '.jl',
  // 图片文件（模型可理解）
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.eps', '.bmp', '.tiff',
  // PDF 文件（参考文献）
  '.pdf'
])

function shouldSyncFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return SYNCABLE_EXTENSIONS.has(ext)
}
```

---

## 错误处理

### 错误分类

#### 网络错误
```typescript
class NetworkErrorHandler {
  async handle(error: Error, attempt: number): Promise<void> {
    if (attempt < MAX_RETRIES) {
      const delay = Math.pow(2, attempt) * 1000 // 指数退避
      await sleep(delay)
      return this.retry()
    }
    await this.notifyUser('同步失败，请检查网络连接')
    await this.saveToOfflineQueue()
  }
}
```

#### 认证错误
```typescript
if (response.status === 401) {
  await this.notifyUser('Overleaf 会话已过期，请重新登录')
  await this.pauseSync()
  return
}
```

#### 冲突错误
```typescript
if (localVersion[path] !== remoteVersion[path]) {
  switch (userConfig.conflictStrategy) {
    case 'local-win':
      await this.forceUpload(path)
      break
    case 'remote-win':
      await this.downloadRemote(path)
      break
    case 'timestamp':
      const localTime = fs.statSync(path).mtime
      const remoteTime = remoteVersion[path].timestamp
      localTime > remoteTime
        ? await this.forceUpload(path)
        : await this.downloadRemote(path)
      break
  }
}
```

### 边界情况

#### 大文件处理
```typescript
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

if (fileSize > MAX_FILE_SIZE) {
  await this.notifyUser(`文件过大 (${fileSize} bytes)，跳过同步`)
  return
}
```

#### 并发修改
```typescript
class FileLock {
  private locks = new Map<string, Promise<void>>()

  async acquire(path: string): Promise<void> {
    while (this.locks.has(path)) {
      await this.locks.get(path)
    }
    this.locks.set(path, this.pendingOperation)
  }

  release(path: string): void {
    this.locks.delete(path)
  }
}
```

#### 断点续传
```typescript
async recoverPendingSync(): Promise<void> {
  const state = await this.loadState()
  for (const task of state.pendingSync) {
    if (task.attempts < MAX_RETRIES) {
      this.syncCoordinator.enqueue(task)
    }
  }
}
```

---

## 测试策略

### 单元测试

**文件系统管理器测试**
```typescript
describe('FileSystemManager', () => {
  it('应该正确创建文件', async () => {
    const manager = new FileSystemManager('/tmp/test')
    await manager.createFile('test.tex', 'content')
    expect(fs.existsSync('/tmp/test/test.tex')).toBe(true)
  })

  it('应该正确检测版本差异', async () => {
    const manager = new FileSystemManager('/tmp/test')
    const diff = await manager.compareWithRemote({
      'main.tex': 'v2',
      'intro.tex': 'v1'
    })
    expect(diff.toDownload).toEqual(['main.tex'])
  })
})
```

**同步协调器测试**
```typescript
describe('SyncCoordinator', () => {
  it('应该正确检测冲突', () => {
    const coordinator = new SyncCoordinator()
    coordinator.updateLocalVersion('main.tex', 'v3')
    coordinator.updateRemoteVersion('main.tex', 'v4')
    expect(coordinator.detectConflict('main.tex')).toBe(true)
  })
})
```

### 集成测试

```typescript
describe('E2E Sync Flow', () => {
  it('应该完整同步 Overleaf 修改到本地', async () => {
    const server = new MirrorServer()
    await server.start()

    await server.mirrorRequest({
      type: 'mirror',
      api_endpoint: '/project/123/doc',
      method: 'POST',
      data: { doc_id: 'xyz', content: 'new content' }
    })

    const content = await fs.readFile('/tmp/mirror/123/main.tex', 'utf-8')
    expect(content).toBe('new content')
  })
})
```

### 手动测试场景

| 场景 | 步骤 | 预期结果 |
|------|------|----------|
| 首次初始化 | 打开新的 Overleaf 项目 | 本地创建完整文件树 |
| 增量同步 | 重新打开已同步项目 | 仅更新变化文件 |
| Overleaf 编辑 | 在 Overleaf 修改文件 | 1秒内本地文件更新 |
| Claude Code 编辑 | Claude Code 修改文件 | 2秒内同步到 Overleaf |
| 冲突解决 | 同时修改同一文件 | 根据策略自动解决 |
| 网络断开 | 断网后修改文件 | 恢复网络后自动重试 |

---

## 性能指标

| 指标 | 目标 | 说明 |
|------|------|------|
| **初始化时间** | <5秒（含图片/PDF） | 仅过滤压缩包和可执行文件 |
| **同步延迟** | <1秒（Overleaf→本地） | 实时感知 Overleaf 变化 |
| **上传延迟** | <2秒（本地→Overleaf） | Claude Code 修改快速同步 |
| **文件监听延迟** | <200ms | chokidar 监听响应速度 |

---

## 实施阶段

### 阶段 1：API 研究和文档汇总

**目标：** 理解 Overleaf API，编写完整的 API 文档

**任务：**
1. 研究 Overleaf 开源仓库 (`C:\Home\CodeProjects\overleaf`)
2. 识别所有文件操作相关的 API 端点
3. 分析请求/响应格式
4. 编写 API 使用文档

**输出：** `docs/overleaf-api-reference.md`

### 阶段 2：本地后端服务（MVP）

**目标：** 实现基础的后端服务，支持文件系统镜像

**核心功能：**
- [ ] WebSocket 服务器（端口 3456）
- [ ] 文件系统管理器
- [ ] 状态持久化（`.overleaf-state.json`）
- [ ] 项目初始化（全量拉取）
- [ ] Overleaf API 解析器

### 阶段 3：浏览器扩展（API 拦截器）

**目标：** 实现 Content Script，拦截并复制 API 请求

**核心功能：**
- [ ] Fetch API 拦截
- [ ] WebSocket 客户端（连接到后端）
- [ ] 请求过滤逻辑
- [ ] 项目 ID 提取

### 阶段 4：双向同步（本地 → Overleaf）

**目标：** 实现本地变更检测和上传

**新增功能：**
- [ ] chokidar 文件监听
- [ ] 同步协调器
- [ ] 同步执行器（扩展端）
- [ ] 冲突检测
- [ ] 重试机制

### 阶段 5：优化和测试

**目标：** 提升稳定性和性能

**任务：**
- [ ] 单元测试
- [ ] 集成测试
- [ ] 错误处理完善
- [ ] 性能优化
- [ ] 用户文档

---

## 技术栈

| 技术 | 选择 | 理由 |
|------|------|------|
| **后端框架** | Express.js | 轻量、成熟、与现有代码兼容 |
| **WebSocket** | ws | 最流行的 Node.js WebSocket 库 |
| **文件监听** | chokidar | 跨平台、稳定、被 webpack 使用 |
| **文件操作** | fs-extra | fs 的增强版，API 更友好 |
| **构建工具** | Vite | 快速、热重载、已在使用 |
| **Monorepo** | pnpm workspace | 简单、高效、无额外配置 |

---

## 目录结构

```
overleaf-cc/
├── packages/
│   ├── mirror-server/              # 本地后端服务
│   │   ├── src/
│   │   │   ├── server.ts           # WebSocket 服务器入口
│   │   │   ├── api/
│   │   │   │   ├── receiver.ts     # 接收扩展请求
│   │   │   │   └── parser.ts       # 解析 Overleaf API
│   │   │   ├── filesystem/
│   │   │   │   ├── manager.ts      # 文件系统管理器
│   │   │   │   ├── initializer.ts  # 项目初始化
│   │   │   │   └── state.ts        # 状态管理
│   │   │   ├── sync/
│   │   │   │   ├── coordinator.ts  # 同步协调器
│   │   │   │   ├── watcher.ts      # 文件监听
│   │   │   │   └── queue.ts        # 同步队列
│   │   │   └── types.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── extension/                  # 浏览器扩展
│       ├── src/
│       │   ├── content/
│       │   │   ├── interceptor.ts  # API 拦截器
│       │   │   ├── sync-executor.ts # 同步执行器
│       │   │   └── injector.ts     # 脚本注入
│       │   ├── background/
│       │   │   └── service-worker.ts
│       │   ├── shared/
│       │   │   └── types.ts        # 共享类型
│       │   └── client.ts           # WebSocket 客户端
│       ├── manifest.json
│       ├── package.json
│       └── vite.config.ts
│
├── docs/
│   ├── plans/
│   │   └── 2026-03-06-overleaf-mirror-design.md
│   ├── overleaf-api-reference.md   # API 参考文档
│   └── implementation-guide.md
│
├── package.json                    # Monorepo 根配置
└── tsconfig.json
```
