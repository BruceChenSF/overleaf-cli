# 文件同步问题诊断指南

**目标**: 帮助诊断为什么本地文件编辑没有同步到 Overleaf

---

## 🔍 诊断步骤

### 步骤 1: 检查配置是否被读取

重启 Mirror Server，打开 Overleaf 项目，查看日志中是否有：

```
[Server] 🔍 Checking file sync config...
[Server] 🔍 enableFileSync value: true
[Server] 🔍 Project config: { ... }
```

**如果没有看到这些日志**:
- ❌ 初始同步可能没有完成
- ❌ 需要等待初始同步完成后才能启动文件同步

**如果看到 `enableFileSync value: undefined` 或 `false`**:
- ❌ 配置文件中没有设置 `enableFileSync: true`
- ✅ 按照 `docs/ENABLE-FILE-SYNC.md` 修改配置文件

**如果看到 `enableFileSync value: true`**:
- ✅ 配置正确，继续下一步

---

### 步骤 2: 检查文件同步是否启动

在日志中查找：

```
[Server] 🔄 File sync enabled, starting continuous sync...
[Server] 🔧 startFileSync() called for project: xxxxx
[Server] 🔧 Creating FileWatcher...
[Server] 🔧 Creating OverleafSyncManager...
[Server] 🔧 Starting file watcher...
```

**如果看到 `[Server] ℹ️ File sync not enabled`**:
- ❌ 返回步骤 1，配置文件需要修改

**如果没有看到任何 startFileSync 日志**:
- ❌ 初始同步可能失败了
- ❌ 检查是否有 `[Server] ❌ Initial sync failed` 错误

---

### 步骤 3: 检查 FileWatcher 是否启动

在日志中查找：

```
[FileWatcher] 🔧 start() called
[FileWatcher] 🔧 Watching directory: C:/Users/pc/overleaf-mirror/xxxxx
[FileWatcher] 🔧 Callback registered: Yes
[FileWatcher] 🔧 Chokidar watcher created
[FileWatcher] ✅ Event listeners registered
[FileWatcher] ✅ Watcher ready - monitoring directory
```

**关键检查点**:

1. **监控的目录路径是否正确？**
   - 应该是您本地项目文件所在的目录
   - 例如：`C:/Users/pc/overleaf-mirror/69a6f132d255a33e681501a5`

2. **回调是否注册？**
   - 应该看到 `Callback registered: Yes`
   - 如果是 `No`，说明回调没有正确设置

3. **Watcher 是否 ready？**
   - 应该看到 `Watcher ready - monitoring directory`
   - 如果没有看到这条，说明 chokidar 初始化失败

---

### 步骤 4: 测试文件监控

现在编辑一个本地文件，应该立即看到：

```
[FileWatcher] ✏️ File modified: main.tex
[FileWatcher] 🔧 Full path: C:/Users/pc/overleaf-mirror/xxxxx/main.tex
```

**如果没有看到任何日志**:

#### 问题 A: 编辑了错误的文件

**检查**:
- 确认您编辑的文件在监控的目录中
- 查看日志中的 `Watching directory:` 路径
- 确认您的文件在这个路径下

**示例**:
```
日志显示: [FileWatcher] 🔧 Watching directory: C:/Users/pc/overleaf-mirror/69a6f132d255a33e681501a5

您应该编辑: C:/Users/pc/overleaf-mirror/69a6f132d255a33e681501a5\main.tex
```

#### 问题 B: 文件监控未启动

**检查**:
- 是否看到 `Watcher ready - monitoring directory`？
- 是否有任何 `[FileWatcher] ❌ Watcher error` 错误？

**常见错误**:
```
[FileWatcher] ❌ Watcher error: Error: EACCES: permission denied
```
→ 目录权限问题，检查目录访问权限

```
[FileWatcher] ❌ Watcher error: Error: ENOENT: no such file or directory
```
→ 目录不存在，检查 localPath 配置

---

### 步骤 5: 检查同步流程

如果看到文件修改日志，应该接着看到：

```
[Server] 🔧 File change callback triggered: { type: 'update', path: 'main.tex' }
[OverleafSyncManager] Syncing to Overleaf: update main.tex
[OverleafSyncManager] ✅ Sent sync request: update main.tex
```

**如果在 FileWatcher 日志后没有任何日志**:
- ❌ 文件变化回调没有被触发
- ❌ 检查 `[FileWatcher] 🔧 Callback registered: Yes`

**如果有同步日志但浏览器没有收到**:
- ❌ WebSocket 连接可能断开
- ❌ 检查浏览器扩展是否加载

---

## 📋 完整诊断清单

使用这个清单逐步检查：

- [ ] **步骤 1**: 配置检查
  - [ ] 看到 `[Server] 🔍 Checking file sync config...`
  - [ ] `enableFileSync value: true`
  - [ ] 配置文件路径正确

- [ ] **步骤 2**: 启动检查
  - [ ] 看到 `[Server] 🔄 File sync enabled`
  - [ ] 看到 `[Server] 🔧 startFileSync() called`
  - [ ] 看到 `[FileWatcher] 🔧 start() called`

- [ ] **步骤 3**: 目录检查
  - [ ] 监控目录路径正确
  - [ ] 目录存在且可访问
  - [ ] `Callback registered: Yes`
  - [ ] `Watcher ready - monitoring directory`

- [ ] **步骤 4**: 文件编辑测试
  - [ ] 编辑监控目录中的文件
  - [ ] 看到 `[FileWatcher] ✏️ File modified`
  - [ ] 看到完整的文件路径

- [ ] **步骤 5**: 同步流程
  - [ ] 看到回调触发日志
  - [ ] 看到同步管理器日志
  - [ ] 浏览器扩展接收到消息

---

## 🛠️ 常见问题和解决方案

### 问题 1: 完全没有任何日志

**可能原因**:
- Mirror Server 未运行
- Overleaf 项目未打开
- 初始同步未完成

**解决方案**:
1. 确认 Mirror Server 正在运行
2. 打开 Overleaf 项目页面
3. 等待初始同步完成：
   ```
   [Server] ✅ Initial sync complete: X files downloaded
   ```
4. 查看配置是否正确加载

---

### 问题 2: 看到 `enableFileSync value: false`

**可能原因**:
- 配置文件中没有设置 `enableFileSync: true`

**解决方案**:
1. 找到配置文件：`C:\Users\pc\.overleaf-mirror\config.json`
2. 找到您的项目配置
3. 添加：`"enableFileSync": true`
4. 重启 Mirror Server
5. 刷新 Overleaf 页面

---

### 问题 3: 看到 `Watching directory` 但路径错误

**可能原因**:
- localPath 配置不正确

**解决方案**:
1. 检查日志中的路径：
   ```
   [FileWatcher] 🔧 Watching directory: C:/Users/pc/overleaf-mirror/wrong-id
   ```
2. 确认您的实际项目目录
3. 更新配置文件中的 `localPath`
4. 重启 Mirror Server

---

### 问题 4: 文件监控启动但编辑文件没有日志

**可能原因**:
- 编辑了不在监控目录中的文件
- chokidar 没有正确初始化

**解决方案**:
1. 确认文件在监控目录中
2. 检查是否有 `Watcher ready` 日志
3. 尝试创建新文件（不是编辑）
4. 检查文件权限

---

### 问题 5: 有 FileWatcher 日志但没有后续同步

**可能原因**:
- 回调未注册
- WebSocket 连接断开

**解决方案**:
1. 检查 `[FileWatcher] 🔧 Callback registered: Yes`
2. 检查浏览器扩展是否加载
3. 查看 WebSocket 连接状态

---

## 💡 快速验证命令

### 检查配置文件

```bash
# Windows
type C:\Users\pc\.overleaf-mirror\config.json

# Linux/macOS
cat ~/.overleaf-mirror/config.json
```

### 检查监控目录是否存在

```bash
# Windows
dir "C:\Users\pc\overleaf-mirror\your-project-id"

# Linux/macOS
ls -la ~/overleaf-mirror/your-project-id
```

### 查看 Mirror Server 日志

在日志中搜索（使用 Ctrl+F）：
- `🔍 Checking file sync config` - 配置检查
- `🔧 Watching directory` - 监控目录
- `✏️ File modified` - 文件修改事件
- `❌` - 错误信息

---

## 📊 日志级别说明

| 前缀 | 含义 | 何时出现 |
|------|------|----------|
| 🔍 | 配置检查 | 检查 enableFileSync 设置时 |
| 🔧 | 内部步骤 | 组件初始化和执行时 |
| ✅ | 成功 | 操作成功完成时 |
| ❌ | 错误 | 任何错误发生时 |
| ⚠️ | 警告 | 非致命问题 |
| 🔄 | 启用功能 | 功能启动时 |
| ➕ | 文件创建 | 检测到新文件 |
| ✏️ | 文件编辑 | 检测到文件修改 |
| 🗑️ | 文件删除 | 检测到文件删除 |

---

## 🔧 已修复的问题

### 问题: 只看到 mirror 消息，没有 sync 消息

**症状**:
- 服务器日志只显示 `[Server] Handling message type: mirror`
- 从未看到 `[Server] 📨 Received sync command: initial_sync`
- 配置检查日志（`🔍 Checking file sync config`）从未出现

**根本原因**:
扩展的 `requestInitialSync()` 函数在浏览器中执行同步，并发送 `file_sync` 消息给服务器，但**从未发送服务器期望的 `sync` 消息**。服务器需要这个 `sync` 消息来触发 `handleInitialSync()` 方法，该方法会检查 `enableFileSync` 配置并启动文件监控。

**修复** (commit 12bc32f):
在 `packages/extension/src/content/injector.ts` 中，在 `sendCookiesToServer()` 之后添加了发送 `sync` 消息的代码：

```typescript
// 🔧 新增：告诉服务器开始初始同步（这会触发 enableFileSync 检查）
console.log('[Mirror] 🔄 Telling server to start initial sync...');
mirrorClient.send({
  type: 'sync' as const,
  project_id: projectId,
  operation: 'initial_sync',
  timestamp: Date.now()
});
console.log('[Mirror] ✅ Initial sync message sent to server');
```

**验证修复**:
重新编译扩展后，您应该看到：
1. 浏览器控制台: `[Mirror] 🔄 Telling server to start initial sync...`
2. 浏览器控制台: `[Mirror] ✅ Initial sync message sent to server`
3. 服务器日志: `[Server] 📨 Received sync command: initial_sync`
4. 服务器日志: `[Server] 🔍 Checking file sync config...`
5. 如果 `enableFileSync: true`，则文件监控启动

---

## 🎯 下一步

根据诊断结果：

1. **如果配置问题** → 修改配置文件
2. **如果目录路径问题** → 更新 localPath
3. **如果回调未注册** → 检查 startFileSync 实现
4. **如果 chokidar 问题** → 检查文件系统权限
5. **如果只有 mirror 消息** → 确保使用最新版本扩展（commit 12bc32f）

完成诊断后，请报告：
- 您在哪个步骤遇到问题？
- 看到了哪些日志？
- 没有看到哪些预期的日志？

这样我可以帮您进一步诊断！

---

**诊断指南版本**: 1.1
**最后更新**: 2026-03-09
**作者**: Claude Code Assistant
