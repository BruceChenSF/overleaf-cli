# Phase 2: 本地到 Overleaf 同步 - 手动测试指南

**日期**: 2026-03-09
**功能**: 本地文件编辑同步到 Overleaf
**测试环境**: Windows, Chrome 浏览器

---

## 🚀 测试前准备

### 1. 启动 Mirror Server

```bash
cd packages/mirror-server
npm start
```

**预期输出**:
```
[Server] Mirror Server listening on ws://localhost:3456
[Server] ProjectConfigStore initialized
```

### 2. 加载浏览器扩展

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 找到 "Overleaf Mirror" 扩展
4. 点击刷新按钮 🔄
5. 确认扩展已加载

### 3. 打开 Overleaf 项目

1. 访问任何 Overleaf 项目（如 `https://cn.overleaf.com/project/xxxxx`）
2. 打开浏览器开发者工具（F12）
3. 切换到 Console 标签
4. 确认看到初始化日志：

```
[Mirror] ✅ Initializing Mirror connection...
[Mirror] ✅ Connected to Mirror Server
[Overleaf WS] Connected to Overleaf WebSocket
[Mirror] ✅ Overleaf API Handler registered
[Mirror] ✅ Initialization complete (including Overleaf sync)
```

### 4. 启用文件同步功能

**重要**: 文件同步默认是禁用的。需要手动启用。

在项目配置文件中添加 `enableFileSync: true`:

```json
{
  "projectId": "your-project-id",
  "localPath": "C:/Users/YourUser/overleaf-mirror/your-project-id",
  "enableFileSync": true
}
```

或者，在 Mirror Server 控制台观察初始同步完成后，检查日志：

```
[Server] ✅ File sync started for project: your-project-id
[FileWatcher] Change callback registered
[OverleafSyncManager] ✅ Initialized path → docId mappings
```

---

## 📋 测试用例

### 测试 1: 编辑现有文件

**目标**: 验证本地编辑同步到 Overleaf

**步骤**:
1. 找到项目的本地目录：`C:/Users/YourUser/overleaf-mirror/project-id/`
2. 选择一个已存在的文件，如 `main.tex`
3. 用文本编辑器打开该文件
4. 在文件末尾添加一行：`% Test edit at {current-time}`
5. 保存文件
6. **观察时间**: 等待 1-2 秒（500ms 防抖 + 网络延迟）

**预期日志** (Mirror Server):
```
[FileWatcher] File modified: main.tex
[OverleafSyncManager] Syncing to Overleaf: update main.tex
[OverleafSyncManager] ✅ Sent sync request: update main.tex
```

**预期日志** (浏览器扩展 Console):
```
[Mirror] Received sync_to_overleaf request: {type: 'sync_to_overleaf', operation: 'update', ...}
[APIHandler] update main.tex
[APIHandler] ✅ Updated: main.tex
```

**预期日志** (Mirror Server - 响应):
```
[Server] ✅ Sync to Overleaf successful: update main.tex
[OverleafSyncManager] ✅ Sync successful: update main.tex
```

**验证结果**:
- ✅ Overleaf 中 `main.tex` 内容已更新
- ✅ 添加的文本出现在 Overleaf 编辑器中
- ✅ 没有错误日志

**失败迹象**:
- ❌ 日志中出现 "WebSocket not connected"
- ❌ 日志中出现 "Sync failed"
- ❌ Overleaf 内容未更新

---

### 测试 2: 创建新文件

**目标**: 验证本地新文件同步到 Overleaf

**步骤**:
1. 在本地项目目录创建新文件：`test-chapter.tex`
2. 添加内容：
```latex
\documentclass{article}
\begin{document}
  Test chapter created at {current-time}
\end{document}
```
3. 保存文件
4. **观察时间**: 等待 1-2 秒

**预期日志** (Mirror Server):
```
[FileWatcher] File added: test-chapter.tex
[OverleafSyncManager] Syncing to Overleaf: create test-chapter.tex
[OverleafSyncManager] ✅ Sent sync request: create test-chapter.tex
```

**预期日志** (浏览器扩展 Console):
```
[Mirror] Received sync_to_overleaf request: {...}
[APIHandler] create test-chapter.tex
[APIHandler] ✅ Created: test-chapter.tex (id: abc123def)
[APIHandler] ✅ Updated: test-chapter.tex
```

**预期日志** (Mirror Server - 响应):
```
[Server] ✅ Sync to Overleaf successful: create test-chapter.tex
[OverleafSyncManager] ✅ Sync successful: create test-chapter.tex
[OverleafSyncManager] ✅ Mapped test-chapter.tex → abc123def
```

**验证结果**:
- ✅ Overleaf 文件树中出现 `test-chapter.tex`
- ✅ 文件内容正确
- ✅ path → docId 映射已更新

**失败迹象**:
- ❌ "Create failed: 400 Bad Request"
- ❌ "Response missing _id field"
- ❌ 文件未出现在 Overleaf

---

### 测试 3: 删除文件

**目标**: 验证本地文件删除同步到 Overleaf

**步骤**:
1. 在本地项目目录选择一个测试文件（不要删除重要文件！）
2. 删除该文件
3. **观察时间**: 等待 1 秒

**预期日志** (Mirror Server):
```
[FileWatcher] File deleted: test-chapter.tex
[OverleafSyncManager] Syncing to Overleaf: delete test-chapter.tex
[OverleafSyncManager] ✅ Sent sync request: delete test-chapter.tex
```

**预期日志** (浏览器扩展 Console):
```
[Mirror] Received sync_to_overleaf request: {...}
[APIHandler] delete test-chapter.tex
[APIHandler] ✅ Deleted: test-chapter.tex
```

**预期日志** (Mirror Server - 响应):
```
[Server] ✅ Sync to Overleaf successful: delete test-chapter.tex
[OverleafSyncManager] ✅ Sync successful: delete test-chapter.tex
[OverleafSyncManager] ✅ Unmapped test-chapter.tex
```

**验证结果**:
- ✅ Overleaf 中文件已删除
- ✅ path → docId 映射已移除

**失败迹象**:
- ❌ "Delete failed: 403 Forbidden"
- ❌ "doc_id is required for delete operation"
- ❌ 文件仍在 Overleaf

---

### 测试 4: 防抖机制测试

**目标**: 验证快速编辑只同步最后一次

**步骤**:
1. 打开 `main.tex` 文件
2. 在 1 秒内进行 3 次编辑：
   - 编辑 1: 添加 `% First edit`
   - 保存
   - 编辑 2: 添加 `% Second edit`
   - 保存
   - 编辑 3: 添加 `% Third edit`
   - 保存
3. 等待 2 秒

**预期日志** (Mirror Server):
```
[FileWatcher] File modified: main.tex
[FileWatcher] File modified: main.tex
[FileWatcher] File modified: main.tex
```
然后（只应该出现一次）:
```
[OverleafSyncManager] Syncing to Overleaf: update main.tex
[OverleafSyncManager] ✅ Sent sync request: update main.tex
```

**验证结果**:
- ✅ 只有 1 次 "Sent sync request" 日志
- ✅ Overleaf 中只有第 3 次编辑的内容
- ✅ 第 1、2 次编辑的内容不存在

**失败迹象**:
- ❌ 出现 3 次 "Sent sync request"
- ❌ 防抖未生效

---

### 测试 5: 网络重试测试

**目标**: 验证网络故障时自动重试

**准备**:
- 这个测试需要临时断开网络或停止 Overleaf 连接

**步骤 A: Overleaf 未登录**
1. 在 Overleaf 网站退出登录
2. 编辑本地文件
3. 观察日志

**预期日志** (浏览器扩展):
```
[APIHandler] update main.tex
[APIHandler] ⚠️ Update main.tex failed (attempt 1/3), retrying in 1000ms...
[APIHandler] ⚠️ Update main.tex failed (attempt 2/3), retrying in 2000ms...
[APIHandler] ⚠️ Update main.tex failed (attempt 3/3), retrying in 4000ms...
[APIHandler] ❌ update failed: Update failed: 403 Forbidden
```

**步骤 B: 网络恢复**
1. 重新登录 Overleaf
2. 等待重试完成
3. 再次编辑文件

**验证结果**:
- ✅ 网络恢复后，新的编辑成功同步
- ✅ 重试次数符合预期（最多 3 次）
- ✅ 重试延迟正确（1s, 2s, 4s）

**失败迹象**:
- ❌ 没有重试，直接失败
- ❌ 重试次数超过 3 次
- ❌ 重试延迟不正确

---

## 🔍 调试技巧

### 查看完整日志

**Mirror Server 日志**:
- 查看运行 `npm start` 的终端
- 所有日志都有前缀标记：
  - `[Server]` - Mirror Server
  - `[FileWatcher]` - 文件监控
  - `[OverleafSyncManager]` - 同步管理器
  - `[Overleaf WS]` - Overleaf WebSocket 连接

**浏览器扩展日志**:
- 按 F12 打开开发者工具
- 切换到 Console 标签
- 筛选日志：在 Console 顶部的过滤框输入 `[Mirror]` 或 `[APIHandler]`
- 所有日志都有前缀：
  - `[Mirror]` - Mirror Client
  - `[APIHandler]` - Overleaf API Handler
  - `[Overleaf WS]` - Overleaf WebSocket

### 常见问题诊断

#### 问题 1: "WebSocket not connected"

**症状**:
```
[OverleafSyncManager] ⚠️ WebSocket not connected
```

**原因**: Mirror Server 未运行或扩展未连接

**解决**:
1. 检查 Mirror Server 是否运行：`http://localhost:3456`
2. 重新加载浏览器扩展
3. 刷新 Overleaf 页面

---

#### 问题 2: "doc_id is required for update operation"

**症状**:
```
[APIHandler] ❌ update failed: Error: doc_id is required for update operation
```

**原因**: 编辑了初始同步时不存在的文件

**解决**:
1. 检查文件是否在初始同步时存在
2. 如果是新文件，应该触发创建而非更新
3. 检查 path → docId 映射是否正确初始化

---

#### 问题 3: "Create failed: 400 Bad Request"

**症状**:
```
[APIHandler] ❌ create failed: Error: Create failed: 400 Bad Request
```

**原因**: 可能是文件名无效或 Overleaf API 参数错误

**解决**:
1. 检查文件名是否包含特殊字符
2. 查看 Overleaf 响应的详细错误信息
3. 确认 `parent_folder_id: 'rootFolder'` 正确

---

#### 问题 4: 防抖不生效

**症状**: 快速编辑导致多次同步

**原因**: 防抖计时器未正确清除

**解决**:
1. 检查 `OverleafSyncManager.handleFileChange` 实现
2. 确认 `clearTimeout` 被正确调用
3. 确认计时器被正确存储在 Map 中

---

#### 问题 5: 映射未更新

**症状**: 创建文件后，无法再次编辑该文件

**原因**: path → docId 映射未更新

**解决**:
1. 检查 `handleSyncResponse` 是否被调用
2. 确认 `operation === 'create'` 时更新映射
3. 查看 `updateMapping` 方法日志

---

## ✅ 测试完成检查清单

完成所有测试后，确认以下项目：

- [ ] **测试 1**: 编辑文件成功同步
- [ ] **测试 2**: 创建文件成功同步
- [ ] **测试 3**: 删除文件成功同步
- [ ] **测试 4**: 防抖机制正确工作
- [ ] **测试 5**: 网络重试机制正确工作
- [ ] 所有日志都有清晰的前缀
- [ ] 没有未处理的错误
- [ ] 资源正确清理（无内存泄漏）

---

## 📊 测试结果记录

**测试日期**: _______________

**测试环境**:
- OS: Windows
- 浏览器: Chrome (版本: ____)
- Node.js: (版本: ____)

**测试结果**:
1. 编辑同步: ✅ / ❌
2. 创建同步: ✅ / ❌
3. 删除同步: ✅ / ❌
4. 防抖机制: ✅ / ❌
5. 网络重试: ✅ / ❌

**遇到的问题**:
- (记录任何问题)

**备注**:
- (任何额外观察)

---

## 🆘 需要帮助？

如果测试过程中遇到问题：

1. **查看日志**: 使用上面的调试技巧查看完整日志
2. **检查配置**: 确认 `enableFileSync: true` 已设置
3. **重启服务**: 重启 Mirror Server 和重新加载扩展
4. **清除缓存**: 清除浏览器缓存和扩展数据

**下一步**:
- 如果所有测试通过 → Phase 2 完成！🎉
- 如果测试失败 → 记录问题并调试

---

**测试指南版本**: 1.0
**最后更新**: 2026-03-09
**作者**: Claude Code Assistant
