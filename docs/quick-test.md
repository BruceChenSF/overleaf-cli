# 快速测试指南

## 环境准备

### 1. 启动 Mirror Server

```bash
cd packages/mirror-server
npm run build
node dist/cli.js start
```

预期输出：
```
Starting Overleaf Mirror Server...
Mirror server listening on port 3456
```

### 2. 构建并加载扩展

```bash
cd packages/extension
npm run build
```

然后在 Chrome 中加载：
1. 打开 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `packages/extension/` 目录

## 架构说明

```
┌─────────────────────────────────────────────────────────────┐
│                      Overleaf Page                          │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  Content Script  │         │  Overleaf Code   │         │
│  │  - Extract ID    │         │  - Original API  │         │
│  │  - WebSocket     │         │    calls         │         │
│  └──────────────────┘         └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
            │                           │
            │ chrome.runtime.sendMessage │
            ▼                           │
┌─────────────────────────────────────────────────────────────┐
│              Background Service Worker                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  chrome.webRequest.onBeforeRequest                   │  │
│  │  - Listen to POST/PUT/DELETE on /project/*          │  │
│  │  - Forward to local server via HTTP                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ HTTP POST
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Mirror Server (Local)                     │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  HTTP Endpoint   │         │  File Watcher    │         │
│  │  /api/mirror     │         │  (chokidar)      │         │
│  └──────────────────┘         └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## 测试场景

### 测试 1: 扩展连接测试

**目的：** 验证扩展能成功连接到本地服务器

**步骤：**
1. 确保服务器正在运行
2. 打开任何 Overleaf 项目页面（例如：https://www.overleaf.com/project/xxxxx）
3. 打开浏览器 DevTools (F12) → Console

**预期输出（浏览器 Console）：**
```
[Mirror] Project ID: xxxxx
[Mirror] Project ID sent to background script
[Mirror] Initializing WebSocket connection...
[MirrorClient] Connected to server
[Mirror] Initialization complete
```

**预期输出（Background Console）**：
```
[Background] Overleaf Mirror extension loaded
[Background] webRequest listener registered
[Background] Project ID: xxxxx
```

**服务器端预期输出：**
```
New client connected
```

---

### 测试 2: API 拦截测试 ✅

**目的：** 验证 webRequest API 能拦截 Overleaf API 调用

**步骤：**
1. 在 Overleaf 编辑器中创建一个新文件（例如：`test.tex`）
2. 查看 Background Console 和服务器日志

**预期输出（Background Console）：**
```
[Background] Intercepted: POST https://cn.overleaf.com/project/xxxxx/doc
```

**服务器端预期输出：**
```
[HTTP] Received: POST /project/xxxxx/doc
```

**说明：** webRequest API 在浏览器层面拦截，比页面代码更早执行，无法被绕过。

---

### 测试 3: 文件监听测试

**目的：** 验证文件监听器能检测本地文件变更

**步骤：**
1. 打开 Overleaf 项目（触发连接）
2. 在另一个终端，进入镜像目录：
   ```bash
   cd ~/overleaf-mirror/<project-id>/
   ```
3. 创建一个测试文件：
   ```bash
   echo "test content" > test.txt
   ```
4. 修改测试文件：
   ```bash
   echo "modified content" > test.txt
   ```
5. 删除测试文件：
   ```bash
   rm test.txt
   ```

**预期输出（服务器端）：**
```
[FileWatcher] File added: /Users/<username>/overleaf-mirror/<project-id>/test.txt
[FileWatcher] File modified: /Users/<username>/overleaf-mirror/<project-id>/test.txt
[FileWatcher] File deleted: /Users/<username>/overleaf-mirror/<project-id>/test.txt
```

---

### 测试 4: 连接恢复测试

**目的：** 验证扩展能自动重连

**步骤：**
1. 确保扩展已连接到服务器
2. 停止服务器 (Ctrl+C)
3. 等待 3 秒
4. 重新启动服务器：
   ```bash
   node dist/cli.js start
   ```

**预期输出（浏览器 Console）：**
```
[MirrorClient] Disconnected from server
[MirrorClient] Attempting to reconnect...
[MirrorClient] Connected to server
```

---

## 故障排查

### 问题：扩展无法连接到服务器

**检查：**
1. 服务器是否正在运行？
   ```bash
   netstat -an | grep 3456
   ```
   应该看到端口 3456 在监听

2. 浏览器控制台是否有错误？
   - 检查是否有 WebSocket 连接错误
   - 检查是否有 CORS 错误

3. manifest.json 中是否配置了正确的 host_permissions？
   ```json
   "host_permissions": [
     "https://*.overleaf.com/*",
     "https://*.cn.overleaf.com/*",
     "ws://localhost:3456/*",
     "http://localhost:3456/*"
   ]
   ```

### 问题：API 拦截没有日志输出

**检查：**
1. Background Console 是否有日志？
   - 打开 `chrome://extensions/`
   - 找到 Overleaf Mirror
   - 点击 "service worker" 查看后台日志

2. 确认 URL filter 是否匹配
   - Overleaf API URL 格式：`/project/xxxxx/doc`
   - 我们的 filter：`https://*.overleaf.com/project/*/doc*`
   - 应该匹配！

3. 在 Network 标签查看实际请求
   - F12 → Network → 过滤 "doc"
   - 创建文件时查看请求的完整 URL

---

## 当前功能状态

### ✅ 已实现
- [x] WebSocket 服务器基础设施
- [x] HTTP API 端点（`/api/mirror`）
- [x] 浏览器扩展加载和连接
- [x] API 拦截（使用 webRequest API）
- [x] 文件监听（仅日志，未实现同步）
- [x] 自动重连机制
- [x] SVG 图标

### ⏳ 待实现（未来阶段）
- [ ] 实际的 Overleaf API 调用处理
- [ ] 本地文件 → Overleaf 同步
- [ ] 冲突检测和解决
- [ ] 增量同步优化

---

## 关键设计决策

### 为什么选择 webRequest API？

**对比方案：**

| 方案 | 优点 | 缺点 | 状态 |
|------|------|------|------|
| Content Script Proxy | 简单直接 | 时机太晚，被页面代码绕过 | ❌ 已废弃 |
| Object.defineProperty 锁定 | 理论上防覆盖 | 仍然太晚，且无效 | ❌ 已移除 |
| webRequest API | 浏览器层面，无法绕过 | 需要配置 URL filter | ✅ 使用中 |

**参见**：`docs/postmortem-api-interception.md` 完整调试复盘

---

## 下一步

1. **测试基础连接：** 按照上述测试场景验证所有功能
2. **报告问题：** 如果遇到任何错误，记录详细的错误信息和复现步骤
3. **准备下一阶段：** 基础设施验证通过后，可以实现实际的文件同步逻辑
