# Overleaf Mirror - 当前进度报告

**更新日期**: 2026-03-06
**状态**: Phase 3-4 之间（基础设施完成，核心逻辑待实现）

---

## 📊 总体进度

### 完成度：约 40%

```
████████████░░░░░░░░░░░░░░░░░░░░░ 40% 完成度
```

| 阶段 | 计划任务 | 完成任务 | 状态 |
|------|---------|---------|------|
| Phase 1: API 研究和文档 | 5 | 5 | ✅ 100% |
| Phase 2: 项目设置 | 8 | 8 | ✅ 100% |
| Phase 3: Mirror Server | 13 | 7 | ⚠️ 54% |
| Phase 4: Browser Extension | 11 | 3 | ⚠️ 27% |
| Phase 5: 集成测试 | 0 | 0 | ⏳ 0% |
| Phase 6: 文档和最终打磨 | 0 | 0 | ⏳ 0% |

---

## ✅ 已完成的核心功能

### 1. 基础架构（100%）

#### 1.1 Monorepo 结构
```
overleaf-cc/
├── packages/
│   ├── extension/          # Chrome 扩展
│   ├── mirror-server/      # 本地服务器
│   └── shared/             # 共享类型
├── docs/
└── docs/plans/
```

#### 1.2 Chrome Extension 基础设施
- ✅ Manifest V3 配置
- ✅ Content Script（项目 ID 提取）
- ✅ Background Service Worker
- ✅ WebSocket 客户端连接
- ✅ SVG 图标

#### 1.3 Mirror Server 基础设施
- ✅ WebSocket 服务器（端口 3456）
- ✅ HTTP API 端点（`/api/mirror`）
- ✅ 文件监听器（chokidar）
- ✅ 自动重连机制

### 2. API 拦截（100%）

#### 2.1 使用 Chrome webRequest API

**关键设计决策**：
- ❌ 放弃：Content Script Proxy 拦截（时机太晚）
- ❌ 放弃：Object.defineProperty 锁定（无效）
- ✅ 采用：Background webRequest API（浏览器层面拦截）

**实现的拦截模式**：
```typescript
// webRequest URL Filter
urls: [
  'https://*.overleaf.com/project/*/doc*',
  'https://*.cn.overleaf.com/project/*/doc*',
  'https://*.overleaf.com/project/*/file*',
  'https://*.cn.overleaf.com/project/*/file*',
  'https://*.overleaf.com/project/*/folder*',
  'https://*.cn.overleaf.com/project/*/folder*',
  // + 备用 /api/* 模式
]
```

**可拦截的 API**：
- ✅ `POST /project/{id}/doc` - 创建文档
- ✅ `PUT /project/{id}/file/*` - 更新文件
- ✅ `DELETE /project/{id}/file/*` - 删除文件
- ✅ `POST /project/{id}/folder` - 创建文件夹
- ✅ `DELETE /project/{id}/folder` - 删除文件夹

#### 2.2 拦截流程

```
Overleaf Page 创建文件
  ↓
webRequest API 拦截（浏览器层面）
  ↓
Background Script 提取请求信息
  ↓
HTTP POST → localhost:3456/api/mirror
  ↓
Mirror Server 接收（目前仅打印日志）
```

**当前输出示例**：
```
[Background] Intercepted: POST https://cn.overleaf.com/project/69a6f132d255a33e681501a5/doc
[HTTP] Received: POST /project/69a6f132d255a33e681501a5/doc
```

---

## ⚠️ 部分完成的功能

### 3. Mirror Server 核心逻辑（54%）

#### 3.1 ✅ 已实现

- **HTTP 端点**：`POST /api/mirror`
  - 接收来自 background script 的拦截请求
  - 解析请求体（method, url, body）
  - 当前：仅打印日志

- **文件监听器**：基于 chokidar
  - 监听 `~/overleaf-mirror/{project_id}/` 目录
  - 检测：add, change, unlink 事件
  - 当前：仅打印日志

- **WebSocket 连接管理**
  - 接受扩展连接
  - 处理消息（类型：mirror, sync）
  - 当前：未实现业务逻辑

#### 3.2 ❌ 未实现（核心功能）

**缺少的组件**：

1. **Overleaf API 调用器** (`packages/mirror-server/src/overleaf-api/`)
   - ❌ 获取项目文件列表：`GET /project/{id}/docs`
   - ❌ 获取文件内容：`GET /project/{id}/doc/{doc_id}`
   - ❌ 创建文档：`POST /project/{id}/doc`
   - ❌ 更新文件：`PUT /project/{id}/doc/{doc_id}`
   - ❌ 删除文件：`DELETE /project/{id}/doc/{doc_id}`

2. **文件系统管理器** (`packages/mirror-server/src/filesystem/manager.ts`)
   - ❌ 创建镜像目录：`~/overleaf-mirror/{project_id}/`
   - ❌ 写入文件到磁盘
   - ❌ 文件扩展名过滤（`.tex`, `.bib`, `.cls` 等）

3. **同步协调器** (`packages/mirror-server/src/sync/coordinator.ts`)
   - ❌ 处理拦截到的 API 请求
   - ❌ 调用 Overleaf API
   - ❌ 写入本地文件
   - ❌ 冲突检测

### 4. Browser Extension 核心逻辑（27%）

#### 4.1 ✅ 已实现

- **项目 ID 提取**：从 URL 中提取
- **WebSocket 连接**：自动连接到本地服务器
- **API 拦截**：通过 webRequest API
- **消息传递**：content ↔ background 通信

#### 4.2 ❌ 未实现

- ❌ 反向同步（本地 → Overleaf）
- ❌ 冲突提示 UI
- ❌ 同步状态指示器

---

## 🚧 与原计划的出入

### 计划 vs 实际

| 方面 | 原计划 | 实际实现 | 原因 |
|------|--------|----------|------|
| **API 拦截方式** | Content Script Proxy | Background webRequest API | 调试发现 Proxy 时机太晚 |
| **拦截策略** | 劫持 `window.fetch` | 浏览器层面拦截 | 更可靠，无法被绕过 |
| **文件监听** | 在 Phase 3 实现 | 提前完成 | 使用 chokidar 简化了实现 |
| **HTTP API** | 仅 WebSocket | WebSocket + HTTP | Background script 无法直接发 WebSocket |
| **调试周期** | 2-3 天 | 实际 1 周 | URL filter 配置错误导致的调试 |

### 关键发现

**根本问题**：URL filter 不匹配（不是代码问题）
```typescript
// 错误假设
'https://*.cn.overleaf.com/api/project/*'

// 实际 URL
'https://cn.overleaf.com/project/69a6f132d255a33e681501a5/doc'
//                        ↑ 没有前缀 /api/
```

**影响**：所有早期的拦截方案（Proxy, Object.defineProperty）都可能是有效的，如果 URL filter 正确的话。

**教训**：先诊断根因，再实现解决方案。参见 `docs/postmortem-api-interception.md`

---

## 📂 当前代码结构

### packages/extension/

```
src/
├── background/
│   └── index.ts              # ✅ webRequest API 拦截器
├── content/
│   └── injector.ts           # ✅ 项目 ID 提取 + WebSocket 连接
│   └── interceptor.ts        # ❌ 已删除（用 webRequest 替代）
├── client.ts                 # ✅ WebSocket 客户端
└── shared/
    └── types.ts              # ✅ 共享类型定义

manifest.json                 # ✅ 配置完成
icons/                        # ✅ SVG 图标

dist/                         # ✅ 构建输出
├── background.js (2.23 kB)   # 比之前减少 8.6%
└── content.js (2.99 kB)      # 比之前减少 47.5%
```

### packages/mirror-server/

```
src/
├── server.ts                 # ⚠️ HTTP + WebSocket 服务器
│   ├── setupHTTPServer()     # ✅ 完成
│   ├── handleMirrorRequest() # ❌ 仅打印日志
│   └── setupWebSocketServer() # ✅ 完成
├── client-connection.ts      # ✅ WebSocket 连接管理
├── filesystem/
│   └── watcher.ts            # ⚠️ 文件监听（仅日志）
└── types.ts                  # ✅ 类型定义

cli.ts                        # ✅ CLI 工具

dist/                         # ✅ 构建输出
```

---

## 🔄 当前数据流

### Overleaf → 本地（单向，部分实现）

```
┌─────────────────────────────────────────────────────────────┐
│ 用户在 Overleaf 创建文件                                      │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Background webRequest API 拦截                                │
│ - 提取：URL, method, body, project_id                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓ HTTP POST
┌─────────────────────────────────────────────────────────────┐
│ Mirror Server: /api/mirror 端点                               │
│ - 接收请求                                                    │
│ - 打印日志 ✅                                                 │
│ - ❌ 未调用 Overleaf API 获取文件内容                         │
│ - ❌ 未写入本地磁盘                                           │
└─────────────────────────────────────────────────────────────┘
```

### 本地 → Overleaf（未实现）

```
┌─────────────────────────────────────────────────────────────┐
│ 用户修改本地文件                                              │
└─────────────────────────────────────────────────────────────┘
                          │
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ FileWatcher (chokidar) 检测变化                              │
│ - 打印日志 ✅                                                 │
│ - ❌ 未读取文件内容                                           │
│ - ❌ 未调用 Overleaf API 更新                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 下一步任务（优先级排序）

### 优先级 1：完成 Overleaf → 本地同步

#### Task 1: 实现 Overleaf API 调用器

**文件**: `packages/mirror-server/src/overleaf-api/client.ts`

```typescript
export class OverleafAPIClient {
  async getProjectFiles(projectId: string): Promise<ProjectFile[]>
  async getFileContent(projectId: string, docId: string): Promise<string>
  async createDocument(projectId: string, name: string, parentFolderId: string): Promise<Doc>
  async updateFile(projectId: string, docId: string, content: string): Promise<void>
  async deleteDocument(projectId: string, docId: string): Promise<void>
}
```

**依赖**: 需要从浏览器获取 Overleaf session cookie

#### Task 2: 实现文件系统管理器

**文件**: `packages/mirror-server/src/filesystem/manager.ts`

```typescript
export class FileSystemManager {
  async ensureProjectDir(projectId: string): Promise<string>
  async writeFile(projectId: string, path: string, content: string): Promise<void>
  async deleteFile(projectId: string, path: string): Promise<void>
  shouldSyncFile(filename: string): boolean  // 扩展名过滤
}
```

**扩展名白名单**：
```
.tex, .bib, .cls, .sty, .bst, .pdf, .png, .jpg, .json
```

#### Task 3: 实现同步协调器

**文件**: `packages/mirror-server/src/sync/coordinator.ts`

```typescript
export class SyncCoordinator {
  async handleOverleafRequest(request: MirrorRequest): Promise<void> {
    // 1. 解析请求
    // 2. 调用 Overleaf API 获取文件内容
    // 3. 写入本地磁盘
  }
}
```

### 优先级 2：实现本地 → Overleaf 同步

#### Task 4: 扩展 FileWatcher

**修改**: `packages/mirror-server/src/filesystem/watcher.ts`

**当前**：仅打印日志
**目标**：读取文件 → 调用 Overleaf API → 更新

#### Task 5: 实现反向同步客户端

**文件**: `packages/mirror-server/src/overleaf-api/uploader.ts`

```typescript
export class OverleafUploader {
  async uploadFile(projectId: string, path: string, content: string): Promise<void>
  async createFolder(projectId: string, name: string, parentId: string): Promise<void>
}
```

### 优先级 3：测试和优化

#### Task 6: 集成测试
- 创建测试项目
- 测试 Overleaf → 本地
- 测试本地 → Overleaf
- 测试冲突检测

#### Task 7: 性能优化
- 增量同步（仅同步变更的文件）
- 防抖（避免频繁调用 API）
- 错误重试机制

---

## ⚙️ 技术约束和注意事项

### 1. Overleaf Session Cookie

**问题**: Mirror Server 需要用户的 Overleaf session 才能调用 API

**可能的解决方案**：
1. **方案 A**: 扩展读取 cookie 并发送到 server（安全性高）
2. **方案 B**: 用户手动配置 cookie（简单但不安全）
3. **方案 C**: 使用 Overleaf API Token（需要 Overleaf 支持）

**推荐**: 方案 A - 通过 Chrome Extension API 读取 cookie

```typescript
// Background script
chrome.cookies.get({
  url: 'https://cn.overleaf.com',
  name: 'overleaf_session2'
}, (cookie) => {
  // 发送到 mirror server
});
```

### 2. CORS 限制

**问题**: Overleaf API 可能不允许跨域请求

**解决方案**: 在 Mirror Server 中使用 `fetch` 并带上 cookie

### 3. 文件编码

**问题**: Windows 系统可能使用 GBK 编码

**解决方案**: 统一使用 UTF-8

---

## 📚 相关文档

### 核心文档
- **本文件**: 当前进度报告
- **实施计划**: `docs/plans/2026-03-06-overleaf-mirror-implementation.md`
- **设计文档**: `docs/plans/2026-03-06-overleaf-mirror-design.md`
- **API 参考**: `docs/overleaf-api-reference.md`

### 调试文档
- **API 拦截复盘**: `docs/postmortem-api-interception.md` ⭐ 必读
- **快速测试指南**: `docs/quick-test.md`
- **故障排查**: `docs/troubleshooting.md`

### Overleaf 源码
- **本地路径**: `C:\Home\CodeProjects\overleaf`
- **Router**: `services/web/app/src/Router.js`
- **Project Controller**: `services/web/app/src/Project/`

---

## 🚀 快速启动指南

### 测试当前功能

```bash
# 1. 启动 Mirror Server
cd packages/mirror-server
npm run build
node dist/cli.js start

# 2. 构建并加载扩展
cd packages/extension
npm run build
# 然后在 chrome://extensions/ 加载

# 3. 测试拦截
# 打开 Overleaf 项目，创建文件
# 查看 Background Console 和服务器日志
```

### 预期输出

```
[Background] Intercepted: POST https://cn.overleaf.com/project/.../doc
[HTTP] Received: POST /project/.../doc
```

---

## 📝 待修复的问题

### 高优先级
1. ❌ `handleMirrorRequest()` 仅打印日志，需要实现实际逻辑
2. ❌ FileWatcher 仅打印日志，需要实现反向同步
3. ❌ 没有创建镜像目录 `~/overleaf-mirror/{project_id}/`

### 中优先级
4. ⚠️ 缺少 Overleaf API 客户端
5. ⚠️ 缺少文件系统管理器
6. ⚠️ 缺少同步协调器

### 低优先级
7. ⚠️ 没有错误重试机制
8. ⚠️ 没有性能优化（增量同步）
9. ⚠️ 没有冲突检测

---

## 💡 架构亮点

### ✅ 做得好的地方

1. **webRequest API 选择**
   - 比页面脚本更早执行
   - 无法被绕过
   - 干净、简单、可维护

2. **Monorepo 结构**
   - 清晰的关注点分离
   - 共享类型定义
   - 独立的包管理

3. **TypeScript 全栈**
   - 类型安全
   - 开发体验好
   - 易于维护

### ⚠️ 需要改进

1. **缺少模块化**
   - Overleaf API 调用逻辑未抽取
   - 文件操作逻辑分散

2. **缺少错误处理**
   - 没有 try-catch 包装
   - 没有错误重试

3. **缺少测试**
   - 没有单元测试
   - 没有集成测试

---

## 🎓 学到的经验

### 调试方面
1. **先诊断，后实现** - URL filter 问题浪费了很多时间
2. **使用合适的工具** - Network 标签 > 猜测
3. **记录过程** - postmortem 文档很有价值

### 架构方面
1. **平台 API > 页面 Hack** - webRequest 比 Proxy 可靠
2. **YAGNI 原则** - 不需要过度设计（Proxy, defineProperty）
3. **简单即美** - 最终方案最简单也最有效

---

## 📞 联系和协作

### 代码仓库
- **路径**: `C:\Home\CodeProjects\overleaf-cc`
- **Git**: 已初始化，提交历史完整

### 关键提交
- `c69af7d`: refactor: clean up API interception implementation（最新）
- `1012598`: feat: use Proxy for stealthy fetch interception
- `ced6448`: refactor: remove all file sync code to start fresh

### 分支策略
- `master`: 主分支，稳定代码
- 建议为功能开发创建新分支

---

**最后更新**: 2026-03-06
**下次更新**: 完成 Phase 3 核心功能后
