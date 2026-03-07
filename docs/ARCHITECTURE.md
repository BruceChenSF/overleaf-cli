# 🏗️ Overleaf Mirror 项目架构

> **快速理解项目结构的核心设计文档**

**最后更新**: 2026-03-08
**详细文档**: 📄 [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md)

---

## ⚡ 核心架构（一句话）

**浏览器扩展直接连接 Overleaf 同步文件，然后发送给 Node.js 后端保存到本地。**

---

## 🔄 架构图

```
┌──────────────┐
│ Overleaf 网页 │
│  (用户编辑)   │
└───────┬──────┘
        │
        ↓
┌─────────────────────────────────────┐
│    浏览器扩展 (Chrome Extension)     │
│                                     │
│  1. 连接 Overleaf WebSocket ✅      │
│  2. 获取所有文件                     │
│  3. 发送到 Mirror Server             │
└───────┬───────────────┬─────────────┘
        │ WebSocket     │ WebSocket
        ↓               ↓
┌──────────────┐  ┌──────────────┐
│ Overleaf API │  │ Mirror Server│
│              │  │ (Node.js)    │
└──────────────┘  └───────┬──────┘
                          │
                          ↓
                  ┌───────────────┐
                  │  本地文件系统   │
                  │ overleaf-mirror│
                  └───────────────┘
```

---

## 🎯 为什么这样设计？

### ❌ 为什么不用 Node.js 后端直接同步？

```bash
# 尝试过的方案：
Node.js (ws 库) → Overleaf WebSocket
结果：❌ 连接被拒绝 (错误: 7:::1+0)

原因：
- Overleaf 检测到非浏览器 WebSocket
- Socket.io 协议兼容性问题
- 即使模拟所有 headers 仍然失败
```

### ✅ 为什么浏览器扩展可以？

```
✅ 原生浏览器 WebSocket - 100% 兼容
✅ 自动继承页面认证 (cookies + CSRF)
✅ 服务器无法区分扩展和浏览器本身
```

---

## 📂 关键代码文件

### 浏览器扩展

| 文件 | 功能 | 重要性 |
|------|------|--------|
| `src/content/overleaf-sync.ts` | Overleaf WebSocket 客户端 | ⭐⭐⭐ |
| `src/content/injector.ts` | 初始化和同步触发器 | ⭐⭐⭐ |
| `src/content/edit-monitor.ts` | 编辑事件监听 | ⭐⭐ |
| `src/client.ts` | Mirror Server WebSocket 客户端 | ⭐⭐ |

### 后端服务器

| 文件 | 功能 | 重要性 |
|------|------|--------|
| `src/server.ts` | 主服务器和文件接收 | ⭐⭐⭐ |
| `src/handlers/edit-monitor.ts` | 编辑事件处理 | ⭐⭐ |
| `src/filesystem/watcher.ts` | 文件监控 | ⭐ |

---

## 🔄 同步流程（30 秒理解）

### 初始同步（打开 Overleaf 项目时）

```typescript
// 1. 用户打开 Overleaf 项目
浏览器加载页面

// 2. 扩展初始化
injector.ts 启动
  ↓
连接到 Mirror Server
发送 cookies + CSRF token
  ↓
触发初始同步 requestInitialSync()
  ↓
// 3. 创建 Overleaf WebSocket 客户端
new OverleafWebSocketClient()
  ↓
连接到 Overleaf (原生 WebSocket) ✅
  ↓
接收 joinProjectResponse
获取文件列表（20 个文件）
  ↓
// 4. 同步每个文件
for each file:
  if 文本文件:
    joinDoc(id) → 获取内容 → leaveDoc(id)
  if 二进制文件:
    downloadFile(id) → 获取 ArrayBuffer
  ↓
发送到 Mirror Server (file_sync 消息)
  ↓
// 5. Mirror Server 保存
handleFileSync()
  创建目录
  写入文件
  ✅ 完成
```

### 实时编辑同步（用户编辑时）

```typescript
// 1. 用户在 Overleaf 编辑
用户输入文字

// 2. EditMonitor 检测
edit-monitor.ts 拦截 WebSocket 消息
  ↓
检测到 applyOtUpdate 事件
  ↓
发送 edit_event 到 Mirror Server
  ↓
// 3. Mirror Server 处理
更新本地文件
通知 FileWatcher
```

---

## 🔐 认证机制

### CSRF Token 获取

```typescript
// 从 HTML meta 标签提取
function extractCSRFToken(): string | null {
  const metaTag = document.querySelector('meta[name="ol-csrfToken"]');
  return metaTag?.content || null;
}

// HTML 源码示例
// <meta name="ol-csrfToken" content="XHm99bjK-91XfwTsdW_z...">
```

### Cookies 获取

```typescript
// 使用 Chrome Extension API
const cookies = await chrome.cookies.getAll({ url: window.location.href });

// 关键 cookies
{
  overleaf_session2: "s%3A...",
  GCLB: "..."
}
```

---

## 📦 消息格式

### 文件同步消息（浏览器 → Mirror Server）

```typescript
{
  type: 'file_sync',
  project_id: '69a6f132d255a33e681501a5',
  path: 'main.tex',
  content_type: 'doc',  // 'doc' | 'file'
  content: '\\documentclass{article}...',  // 文本或 Base64
  timestamp: 1709876543210
}
```

### 编辑事件消息（浏览器 → Mirror Server）

```typescript
{
  type: 'edit_event',
  project_id: '69a6f132d255a33e681501a5',
  doc_id: '69aa979e8f6420a3b4774d2d',
  doc_name: 'main.tex',
  data: {
    ops: [...],
    version: 123
  }
}
```

---

## ⚙️ 配置

### Mirror Server 配置

```typescript
// 默认本地路径
C:\Users\pc\overleaf-mirror\{projectId}\

// WebSocket 端口
3456

// 项目配置存储
~/.overleaf-cc/projects.json
```

---

## 🚀 快速开始

### 1. 构建项目

```bash
# 构建扩展
cd packages/extension
npm run build

# 构建后端
cd packages/mirror-server
npm run build
```

### 2. 启动服务器

```bash
cd packages/mirror-server
npm start
```

### 3. 加载扩展

1. 打开 `chrome://extensions/`
2. 启用"开发者模式"
3. 加载 `packages/extension/dist`

### 4. 测试

1. 打开任何 Overleaf 项目
2. 查看 `C:\Users\pc\overleaf-mirror\{projectId}\`
3. 应该看到所有文件已同步

---

## 🐛 常见问题

### Q: 为什么 Node.js 后端不能直接连接 Overleaf？

**A**: Overleaf 使用特定的 Socket.io 协议，并且会检测和拒绝非浏览器的 WebSocket 连接。即使完全模拟浏览器的 headers，仍然会被拒绝（错误码 `7:::1+0`）。

### Q: 浏览器扩展会影响 Overleaf 性能吗？

**A**: 不会。所有同步操作在后台进行，不阻塞用户界面。初始同步可能需要几秒到几十秒，但只执行一次。

### Q: 如何查看同步日志？

**A**:
- **浏览器**: 打开开发者工具 → Console 标签
- **服务器**: 查看终端输出

### Q: 同步失败怎么办？

**A**:
1. 检查浏览器控制台是否有错误
2. 确认已登录 Overleaf
3. 刷新页面重新同步
4. 查看详细文档 [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md)

---

## 📚 相关文档

- 📄 [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) - 详细架构文档
- 📄 [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) - 测试指南
- 📄 [PROGRESS-REPORT.md](./PROGRESS-REPORT.md) - 项目进度

---

**维护提醒**: 本文档与代码实现同步更新。如有架构变更，请及时更新。

**最后更新**: 2026-03-08
**维护者**: Claude Code Assistant
