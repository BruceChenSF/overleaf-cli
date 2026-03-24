# Overleaf Mirror

> **Overleaf ↔ 本地文件系统的实时双向同步工具**

**当前状态**: ✅ Overleaf → 本地同步已完成 | ✅ 本地 → Overleaf 同步已完成

---

## 🎯 项目概述

Overleaf Mirror 是一个浏览器扩展 + 本地服务器的解决方案，能够实现 Overleaf 与本地文件系统的**实时双向同步**。这使得开发者可以在本地使用熟悉的工具（如 VS Code、Vim、Emacs）编辑 LaTeX 项目，同时保持与 Overleaf 的完全同步。

### 核心功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 📥 **初始同步** | ✅ 完成 | 打开 Overleaf 项目时自动同步所有文件 |
| ✏️ **Overleaf → 本地实时同步** | ✅ 完成 | 监听 Overleaf 编辑操作，实时更新本地文件 |
| ➕ **文件创建同步** | ✅ 完成 | Overleaf 中新建文件自动同步到本地 |
| 🗑️ **文件删除同步** | ✅ 完成 | Overleaf 中删除文件自动同步到本地 |
| ✏️ **文件重命名同步** | ✅ 完成 | Overleaf 中重命名文件自动同步到本地 |
| 📤 **本地 → Overleaf 实时同步** | ✅ 完成 | 本地编辑自动同步到 Overleaf，支持自动切换文件 |
| 🔄 **循环同步防护** | ✅ 完成 | 智能 syncId 机制避免循环同步 |

---

## 🏗️ 架构设计

### 核心原理

**双向同步架构**：
- **Overleaf → 本地**：浏览器扩展监听 Overleaf WebSocket，获取文件内容
- **本地 → Overleaf**：本地文件变化通过 DOM 操作更新 Overleaf 编辑器

```
┌──────────────┐
│ Overleaf 网页 │
│  (用户编辑)   │
└───────┬──────┘
        │
        ↓ WebSocket 消息监听
┌─────────────────────────────────┐
│    浏览器扩展 (Chrome Extension)  │
│                                 │
│  Overleaf → 本地:                │
│  • OverleafWebSocketClient       │
│  • 监听文件操作 (创建/删除/编辑)  │
│  • EditMonitor                   │
│                                 │
│  本地 → Overleaf:                │
│  • OverleafAPIHandler            │
│  • EditorUpdater (DOM操作)       │
│  • 自动文件切换                   │
│  • 编辑器就绪检测                 │
└───────┬─────────────────────────┘
        │ WebSocket
        ↓
┌──────────────┐
│ Mirror Server│
│  (Node.js)   │
│  • FileWatcher│
│  • 同步管理    │
└───────┬──────┘
        │
        ↓
┌───────────────┐
│ 本地文件系统   │
│ ~/overleaf-   │
│ mirror/{id}/  │
└───────────────┘
```

### 为什么不用 Node.js 直接连接？

❌ **Node.js → Overleaf WebSocket** - 连接被拒绝（错误码 `7:::1+0`）
✅ **浏览器扩展 → Overleaf WebSocket** - 100% 兼容，继承页面认证

---

## 🚀 快速开始

### 1. 安装依赖

```bash
# 克隆项目
git clone https://gitee.com/WHUBruceChen/claude-leaf.git
cd claude-leaf

# 安装依赖
npm install
# 或使用 pnpm
pnpm install
```

### 2. 构建项目

```bash
# 构建所有包
npm run build
# 或分别构建
cd packages/extension && npm run build
cd packages/mirror-server && npm run build
```

### 3. 启动 Mirror Server

```bash
cd packages/mirror-server
npm start
```

服务器将在 `ws://localhost:3456` 启动。

### 4. 加载浏览器扩展

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 启用"开发者模式"（右上角开关）
4. 点击"加载已解压的扩展程序"
5. 选择 `packages/extension/dist` 目录

### 5. 测试同步

1. 打开任何 Overleaf 项目（如 `https://cn.overleaf.com/project/xxxxx`）
2. 查看服务器终端，应该看到同步日志
3. 检查本地目录：`~/overleaf-mirror/{project-id}/`
4. 所有文件应该已经同步到本地

---

## 📂 项目结构

```
overleaf-cc/
├── packages/
│   ├── extension/           # Chrome 浏览器扩展
│   │   ├── src/
│   │   │   ├── background/  # 后台脚本（cookies 处理）
│   │   │   └── content/     # 内容脚本
│   │   │       ├── overleaf-sync.ts  # Overleaf WebSocket 客户端
│   │   │       ├── injector.ts       # 初始化和同步逻辑
│   │   │       ├── edit-monitor.ts    # 编辑事件监听
│   │   │       └── client.ts          # Mirror Server WebSocket 客户端
│   │   └── dist/            # 构建输出
│   │
│   └── mirror-server/       # Node.js 后端服务器
│       ├── src/
│       │   ├── server.ts    # 主服务器
│       │   ├── handlers/    # 消息处理器
│       │   ├── sync/        # 同步管理器
│       │   └── filesystem/  # 文件系统操作
│       └── dist/            # 构建输出
│
└── docs/                    # 项目文档
    ├── FILE-OPERATIONS-SYNC.md  # 文件操作同步详细说明
    ├── ARCHITECTURE.md           # 架构设计
    ├── FILE-SYNC-ARCHITECTURE.md # 文件同步架构
    ├── overleaf-api-reference.md # Overleaf API 参考
    └── MANUAL-TESTING-GUIDE.md   # 手动测试指南
```

---

## 📚 文档

### 核心文档（必读）

| 文档 | 描述 | 阅读时间 |
|------|------|---------|
| **[FILE-OPERATIONS-SYNC.md](docs/FILE-OPERATIONS-SYNC.md)** | 文件操作同步完整方案 ⭐ | 15 分钟 |
| **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** | 项目架构概览 | 5 分钟 |
| **[FILE-SYNC-ARCHITECTURE.md](docs/FILE-SYNC-ARCHITECTURE.md)** | 文件同步详细架构 | 15 分钟 |

### API 和测试

| 文档 | 描述 |
|------|------|
| [overleaf-api-reference.md](docs/overleaf-api-reference.md) | Overleaf API 参考 |
| [MANUAL-TESTING-GUIDE.md](docs/MANUAL-TESTING-GUIDE.md) | 手动测试指南 |
| [api-documentation.md](docs/api-documentation.md) | 本项目 API 文档 |

### 其他

| 文档 | 描述 |
|------|------|
| [INSTALLATION.md](docs/INSTALLATION.md) | 详细安装指南 |
| [troubleshooting.md](docs/troubleshooting.md) | 故障排查 |
| [known-issues.md](docs/known-issues.md) | 已知问题 |

---

## 🔧 配置

### Mirror Server 配置

默认配置（在 `packages/mirror-server/src/config.ts`）：

```typescript
{
  host: 'localhost',
  port: 3456,
  mirrorBasePath: '~/overleaf-mirror',  // Windows: 'C:/Users/{user}/overleaf-mirror'
}
```

### 项目配置

项目配置存储在：`~/.overleaf-cc/projects.json`

```json
{
  "projects": [
    {
      "projectId": "69a6f132d255a33e681501a5",
      "localPath": "C:/Users/pc/overleaf-mirror/69a6f132d255a33e681501a5",
      "lastSync": 1709876543210
    }
  ]
}
```

---

## 🔍 工作原理

### Overleaf → 本地同步

#### 初始同步流程

1. 用户打开 Overleaf 项目页面
2. 扩展初始化，连接到 Mirror Server
3. 创建 `OverleafWebSocketClient` 连接到 Overleaf
4. 接收 `joinProjectResponse` 获取文件列表
5. 遍历所有文件：
   - 文本文件：调用 `joinDoc()` → 获取内容 → `leaveDoc()`
   - 二进制文件：调用 `downloadFile()` → 获取 ArrayBuffer
6. 发送到 Mirror Server 保存到本地

#### 实时编辑同步

1. 用户在 Overleaf 编辑文档
2. `EditMonitor` 拦截 WebSocket 消息
3. 检测 `applyOtUpdate` 事件（OT 操作）
4. 提取操作列表（`ops`）和版本号
5. 发送到 Mirror Server
6. Mirror Server 应用操作到本地文件

#### 文件操作同步

| 操作 | Overleaf 事件 | 处理流程 |
|------|--------------|----------|
| **创建** | `reciveNewDoc` | 更新映射 → 获取内容 → 创建本地文件 |
| **删除** | `removeEntity` | 从映射获取路径 → 删除本地文件 |
| **重命名** | `reciveEntityRename` | 获取旧路径 → 更新映射 → 重命名本地文件 |

### 本地 → Overleaf 同步

#### 核心机制

- **文件监控**：Chokidar 监控本地文件变化
- **DOM 操作**：直接更新 Overleaf 的 CodeMirror 6 编辑器
- **自动切换**：智能切换到目标文件并等待就绪
- **循环防护**：syncId 机制防止循环同步

#### 同步流程

```
本地文件修改
    ↓
FileWatcher 检测变化
    ↓
OverleafSyncManager 查找 docId
    ↓
发送 sync_to_overleaf 消息
    ↓
OverleafAPIHandler 接收
    ↓
EditorUpdater 处理：
    ├─ 检查当前文档是否是目标文档
    ├─ 如果不是，自动切换文件
    │  ├─ 通过 docId 精确匹配（优先）
    │  └─ 通过文件名匹配（备用）
    ├─ 监听 joinDoc 事件确认加载
    ├─ 主动轮询检查编辑器就绪
    ├─ 设置 syncId 标记（使用实际 docId）
    └─ 直接更新 .cm-content DOM
    ↓
Overleaf 自动保存到服务器
    ↓
EditMonitor 监听到 edit 事件
    ↓
检查 syncId，过滤我们的更新 ✅
```

#### 关键技术点

1. **文档切换**
   - 优先使用 `data-entity-id` 精确匹配
   - 备用方案：在文件树中查找文件名
   - 监听 `joinDoc` WebSocket 事件

2. **编辑器就绪检测**
   - 不使用固定等待时间
   - 主动轮询检查多个指标：
     - `.cm-content` 元素存在
     - `.cm-line` 元素已渲染
     - 内容长度 > 0
     - 没有加载状态
     - Overleaf editor 状态可访问

3. **循环同步防护**
   - 生成唯一的 syncId
   - 使用**实际打开的 docId** 设置 syncId
   - EditMonitor 检查 syncId.docId === edit.doc_id
   - 匹配则过滤，不匹配则转发

---

## 🐛 故障排查

### 扩展无法连接到服务器

**检查清单**：
- [ ] Mirror Server 是否运行在 `localhost:3456`？
- [ ] 浏览器控制台是否有错误？
- [ ] 防火墙是否阻止了 WebSocket 连接？

**解决方法**：
```bash
# 重启服务器
cd packages/mirror-server
npm start

# 重新加载扩展
# 在 chrome://extensions/ 点击刷新按钮
```

### 文件没有同步

**检查清单**：
- [ ] 是否已登录 Overleaf？
- [ ] 浏览器控制台是否有 `[Mirror]` 日志？
- [ ] 本地目录权限是否正确？

**解决方法**：
```bash
# 检查服务器日志
# 应该看到 "[Server] 📥 Received file sync: xxx.tex"

# 手动触发重新同步
# 刷新 Overleaf 页面
```

### 查看详细日志

**浏览器日志**：
- 打开开发者工具（F12）
- 查看 Console 标签
- 筛选 `[Mirror]` 或 `[Overleaf WS]`

**服务器日志**：
- 查看 Mirror Server 终端输出
- 所有日志都有前缀标记

---

## 🧪 测试

### 手动测试

详细的测试指南请参考：[MANUAL-TESTING-GUIDE.md](docs/MANUAL-TESTING-GUIDE.md)

**快速测试**：
1. 创建新 Overleaf 项目
2. 添加一些文件（`.tex`, `.bib`, 图片）
3. 编辑文件内容
4. 删除/重命名文件
5. 检查本地目录是否正确同步

---

## 🚧 开发路线图

### Phase 1: Overleaf → 本地同步 ✅
- [x] 初始文件同步
- [x] 实时编辑同步
- [x] 文件创建同步
- [x] 文件删除同步
- [x] 文件重命名同步

### Phase 2: 本地 → Overleaf 同步 ✅
- [x] 本地文件变化监控
- [x] 文件编辑推送到 Overleaf
- [x] 文件创建推送到 Overleaf
- [x] 文件删除推送到 Overleaf
- [x] 网络重试机制

### Phase 3: 增强功能（未来）
- [ ] 多项目支持
- [ ] 选择性同步（忽略特定文件）
- [ ] 同步历史记录
- [ ] 性能优化（大文件、二进制文件）

---

## 📄 许可证

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

---

**最后更新**: 2026-03-09
**维护者**: Overleaf Mirror Team
