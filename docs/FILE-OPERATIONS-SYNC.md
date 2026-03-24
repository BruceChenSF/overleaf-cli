# 📋 文件操作同步完整方案

## ⚠️ 重要阅读

本文档详细说明了 Overleaf Mirror 项目中**文件创建、删除、重命名**功能的完整实现方案。所有开发者/Agent 在修改相关代码前**必须先阅读本文档**。

---

## 🎯 方案概述

### 核心原则

**使用 Overleaf 原生 WebSocket 协议监听文件操作，而不是 HTTP 请求拦截。**

### 为什么选择 WebSocket 而不是 HTTP 拦截？

| 方案 | 优点 | 缺点 | 状态 |
|------|------|------|------|
| **WebSocket 监听** | ✅ 可靠、直接获取文件信息、官方协议 | - | ✅ **当前方案** |
| **HTTP 拦截** | 理论上可行 | ❌ 无法读取响应体、依赖 URL 解析、不稳定 | ❌ **已废弃** |

---

## 🏗️ 架构设计

### 数据流向

```
┌─────────────────┐
│  用户在 Overleaf │
│  操作文件        │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Overleaf WebSocket Server      │
│  发送消息:                       │
│  • reciveNewDoc (新建文档)       │
│  • removeEntity (删除实体)       │
│  • reciveEntityRename (重命名)   │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  OverleafWebSocketClient         │
│  (packages/extension/src/content/│
│   overleaf-sync.ts)              │
│                                  │
│  • 连接 Overleaf WebSocket       │
│  • 维护 docIdToPath 映射         │
│  • 解析消息并触发 onChange 回调  │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Content Script (injector.ts)    │
│                                  │
│  • 接收 onChange 事件            │
│  • 获取文件内容（如需要）        │
│  • 发送消息到 Mirror Server      │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Mirror Server                  │
│  (packages/mirror-server/src/    │
│   server.ts)                     │
│                                  │
│  • 接收 file_created/deleted/    │
│    file_renamed 消息            │
│  • 执行本地文件系统操作          │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│  本地文件系统    │
│  (同步完成)      │
└─────────────────┘
```

---

## 🔧 核心组件详解

### 1. OverleafWebSocketClient

**位置**: `packages/extension/src/content/overleaf-sync.ts`

**职责**:
- 连接 Overleaf WebSocket API
- 监听并解析 Overleaf 的文件操作消息
- 维护 `docIdToPath` 映射（文档ID → 文件路径）
- 通过 `onChange` 回调通知上层代码

**关键方法**:

```typescript
class OverleafWebSocketClient {
  private docIdToPath = new Map<string, DocInfo>();
  private onChangeCallback?: ChangeEventHandler;

  // 连接到 Overleaf WebSocket
  async connect(): Promise<void>

  // 同步所有文件（初始同步）
  async syncAllFiles(): Promise<SyncedFile[]>

  // 获取文档信息
  getDocInfo(id: string): DocInfo | undefined

  // 加入文档并获取内容
  async joinDoc(docId: string): Promise<string[]>

  // 下载二进制文件
  async downloadFile(fileRefId: string): Promise<ArrayBuffer>

  // 注册变化监听回调 ⭐ 核心
  onChange(callback: ChangeEventHandler): void

  // 断开连接
  disconnect(): void
}
```

### 2. 消息处理逻辑

**处理的消息类型**:

| 消息名称 | 触发时机 | 处理逻辑 |
|---------|---------|---------|
| `joinProjectResponse` | 连接建立时 | 构建完整的 docIdToPath 映射 |
| `reciveNewDoc` | 新建文档 | 添加映射 → 触发 `created` 事件 |
| `newDocCreated` | 新建文档（备用） | 同上 |
| `reciveNewFile` | 上传文件 | 添加映射 → 触发 `created` 事件 |
| `fileUploaded` | 上传文件（备用） | 同上 |
| `fileCreated` | 创建文件（备用） | 同上 |
| `removeEntity` | 删除实体 | 获取路径 → 删除映射 → 触发 `deleted` 事件 |
| `docRemoved` | 删除文档（备用） | 同上 |
| `fileRemoved` | 删除文件（备用） | 同上 |
| `reciveEntityRename` | 重命名 | 获取旧路径 → 更新映射 → 触发 `renamed` 事件 |

### 3. Content Script (injector.ts)

**位置**: `packages/extension/src/content/injector.ts`

**职责**:
- 初始化 OverleafWebSocketClient 并保持连接
- 注册 `onChange` 回调处理文件操作
- 根据操作类型获取文件内容并发送到 Mirror Server

**关键代码**:

```typescript
// 初始化 - 连接 Overleaf WebSocket 并保持活跃
overleafWsClient = new OverleafWebSocketClient(projectId, auth, csrfToken);
await overleafWsClient.connect();

// 初始同步
const syncedFiles = await overleafWsClient.syncAllFiles();
for (const file of syncedFiles) {
  mirrorClient.send({ type: 'file_sync', ... });
}

// 注册监听回调 ⭐
overleafWsClient.onChange(async (change) => {
  if (change.type === 'created') {
    // 获取文件内容
    const docInfo = overleafWsClient.getDocInfo(change.docId);
    const content = await overleafWsClient.joinDoc(change.docId);

    // 发送创建事件
    mirrorClient.send({ type: 'file_created', ... });
    // 发送文件内容
    mirrorClient.send({ type: 'file_sync', content, ... });
  }
  else if (change.type === 'deleted') {
    // 发送删除事件（包含路径）
    mirrorClient.send({
      type: 'file_deleted',
      path: change.path,  // ⭐ 重要：从 docIdToPath 获取
      file_id: change.docId
    });
  }
  else if (change.type === 'renamed') {
    // 发送重命名事件
    mirrorClient.send({
      type: 'file_renamed',
      old_name: change.oldPath,
      new_name: change.path
    });
  }
});
```

### 4. Mirror Server

**位置**: `packages/mirror-server/src/server.ts`

**职责**:
- 接收来自 extension 的文件操作消息
- 执行本地文件系统操作

**处理逻辑**:

```typescript
switch (message.type) {
  case 'file_created':
    // 创建空文件占位符
    this.handleFileCreated(projectId, fileName);
    break;

  case 'file_sync':
    // 写入文件内容
    this.syncTextFile(projectId, path, content);
    break;

  case 'file_deleted':
    // ⭐ 使用路径删除文件（不是 file_id）
    this.handleFileDeleted(projectId, path);
    break;

  case 'file_renamed':
    // 重命名文件
    this.handleFileRenamed(projectId, oldName, newName);
    break;
}
```

---

## 📊 文件操作详细流程

### ✅ 文件创建流程

```
1. 用户在 Overleaf 点击"New File"
   ↓
2. Overleaf 发送 WebSocket 消息
   消息: reciveNewDoc
   参数: [docId, { path: "test.tex", name: "test.tex" }]
   ↓
3. OverleafWebSocketClient.handleDataMessage()
   • 解析消息获取 docPath
   • 更新 docIdToPath.set(docId, { path: docPath, ... })
   • 触发 onChange({ type: 'created', path: 'test.tex', docId })
   ↓
4. Content Script onChange 回调
   • 调用 overleafWsClient.getDocInfo(docId)
   • 调用 overleafWsClient.joinDoc(docId) 获取内容
   • 发送 file_created 消息到 Mirror Server
   • 发送 file_sync 消息（包含内容）
   ↓
5. Mirror Server
   • handleFileCreated(): 创建空文件
   • syncTextFile(): 写入实际内容
   ↓
6. ✅ 本地文件创建完成
```

### ✅ 文件删除流程

```
1. 用户在 Overleaf 删除文件
   ↓
2. Overleaf 发送 WebSocket 消息
   消息: removeEntity
   参数: [entityId, entityType]
   ↓
3. OverleafWebSocketClient.handleDataMessage()
   • 从 docIdToPath.get(entityId) 获取路径
   • docIdToPath.delete(entityId) 删除映射
   • 触发 onChange({ type: 'deleted', path: 'test.tex', docId })
   ↓
4. Content Script onChange 回调
   • 发送 file_deleted 消息（⭐ 包含 path）
   ↓
5. Mirror Server
   • handleFileDeleted(projectId, path)
   • fs.unlinkSync(fullPath) 删除文件
   ↓
6. ✅ 本地文件删除完成
```

**关键点**: 文件路径从 `docIdToPath` 映射中获取，而不是从消息中解析！

### ✅ 文件重命名流程

```
1. 用户在 Overleaf 重命名文件
   ↓
2. Overleaf 发送 WebSocket 消息
   消息: reciveEntityRename
   参数: [entityId, newPath, entityType]
   ↓
3. OverleafWebSocketClient.handleDataMessage()
   • 从 docIdToPath.get(entityId) 获取旧路径
   • docIdToPath.set(entityId, { ...docInfo, path: newPath }) 更新映射
   • 触发 onChange({ type: 'renamed', oldPath: 'old.tex', newPath: 'new.tex' })
   ↓
4. Content Script onChange 回调
   • 发送 file_renamed 消息（包含 old_name 和 new_name）
   ↓
5. Mirror Server
   • handleFileRenamed(projectId, oldName, newName)
   • fs.renameSync(oldPath, newPath) 重命名文件
   ↓
6. ✅ 本地文件重命名完成
```

---

## 🗺️ docIdToPath 映射表

### 作用

维护 Overleaf 文档/文件 ID 到本地路径的映射关系。

### 为什么需要？

- Overleaf 的 WebSocket 消息通常只包含 `entityId`，不包含路径
- 删除和重命名操作需要知道文件的当前路径
- 映射表确保我们能准确找到文件

### 生命周期

```typescript
// 1. 初始构建 - joinProjectResponse
processProjectStructure(response) {
  for (doc of folder.docs) {
    docIdToPath.set(doc._id, { path: `${folder.name}/${doc.name}`, ... });
  }
}

// 2. 新建时添加
reciveNewDoc([docId, { path, name }]) {
  docIdToPath.set(docId, { path, name, type: 'doc' });
}

// 3. 删除时移除
removeEntity([entityId]) {
  const path = docIdToPath.get(entityId).path;  // 先获取路径
  docIdToPath.delete(entityId);                 // 再删除映射
}

// 4. 重命名时更新
reciveEntityRename([entityId, newPath]) {
  const oldInfo = docIdToPath.get(entityId);
  docIdToPath.set(entityId, { ...oldInfo, path: newPath });  // 更新路径
}
```

---

## ⚙️ 配置和维护

### 消息类型定义

**位置**: `packages/mirror-server/src/types.ts`

```typescript
// 文件创建
export interface FileCreatedMessage {
  type: 'file_created';
  project_id: string;
  file_name: string;
  file_id: string;
  timestamp: number;
}

// 文件删除 ⭐ 必须包含 path
export interface FileDeletedMessage {
  type: 'file_deleted';
  project_id: string;
  file_id: string;
  path: string;  // ⭐ 关键字段
  timestamp: number;
}

// 文件重命名
export interface FileRenamedMessage {
  type: 'file_renamed';
  project_id: string;
  old_name: string;
  new_name: string;
  file_id: string;
  timestamp: number;
}
```

### FileChange 接口

**位置**: `packages/extension/src/content/overleaf-sync.ts`

```typescript
interface FileChange {
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  path: string;        // 当前路径（新建时为新路径，删除时为旧路径）
  oldPath?: string;    // 仅重命名时有值
  docId: string;       // Overleaf 实体 ID
}
```

---

## 🚫 已废弃的方案

### HTTP 请求拦截（❌ 不要使用）

**问题**:
1. **无法读取响应体**: Chrome webRequest API 不支持读取 HTTP 响应
2. **文件名在响应中**: 新建文件时，文件名在响应体而非请求或 URL 中
3. **不可靠**: 依赖 URL 解析，容易出错

**已清理的代码**:
- ❌ `interceptDocRequests()` 函数 (270+ 行)
- ❌ `getCurrentFileName()` 辅助函数
- ❌ Background script 中的 webRequest 拦截器 (140+ 行)

**构建优化**:
- `background.js`: 2.69 kB → 0.74 kB (减少 1.9 kB)

---

## 🧪 测试指南

### 测试文件创建

1. 在 Overleaf 中创建新文件 `test.tex`
2. 查看控制台日志：
   ```
   [Overleaf WS] 📢 reciveNewDoc received: [...]
   [Overleaf WS] ✅ Mapped doc xxx -> test.tex
   [Mirror] 📢 File operation detected: created - test.tex
   [Mirror] ✅ Synced new file to mirror server: test.tex
   [Server] ➕ Received file creation event: test.tex
   [Server] ✅ Created empty file: test.tex
   ```
3. 确认本地文件已创建

### 测试文件删除

1. 在 Overleaf 中删除文件
2. 查看控制台日志：
   ```
   [Overleaf WS] 📢 removeEntity received: [...]
   [Overleaf WS] ✅ Found path for xxx: test.tex
   [Mirror] 📢 File operation detected: deleted - test.tex
   [Server] 🗑️ Received file deletion event: test.tex
   [Server] ✅ Deleted file: test.tex
   ```
3. 确认本地文件已删除

### 测试文件重命名

1. 在 Overleaf 中重命名文件
2. 查看控制台日志：
   ```
   [Overleaf WS] 📢 reciveEntityRename received: [...]
   [Overleaf WS] ✅ Rename: old.tex -> new.tex
   [Mirror] 📢 File operation detected: renamed - new.tex
   [Mirror] ✅ Sent file rename event: old.tex -> new.tex
   [Server] ✏️ Received file rename event: old.tex -> new.tex
   [Server] ✅ Renamed file: old.tex -> new.tex
   ```
3. 确认本地文件已重命名

---

## 🔍 调试技巧

### 查看 WebSocket 消息

在 `overleaf-sync.ts` 的 `handleMessage` 方法中添加日志：

```typescript
private handleMessage(data: string): void {
  // 添加这行查看所有原始消息
  console.log('[Overleaf WS] 🔍 Raw message:', data);

  if (data.match(/^5:::(.*)/)) {
    const message = JSON.parse(match[1]);
    console.log('[Overleaf WS] 📦 Data message:', message.name);
  }
}
```

### 查看 docIdToPath 映射

在浏览器控制台执行：

```javascript
// 需要先在代码中暴露 overleafWsClient
overleafWsClient.docIdToPath
```

### 常见问题排查

| 问题 | 可能原因 | 解决方法 |
|------|---------|---------|
| 新建文件没有内容 | joinDoc 调用失败 | 检查 WebSocket 连接状态 |
| 删除文件报错找不到路径 | docIdToPath 映射缺失 | 检查初始同步是否完成 |
| 重命名没有生效 | reciveEntityRename 未处理 | 确认消息处理逻辑存在 |

---

## 📚 相关文档

- [总体架构](ARCHITECTURE.md)
- [文件同步架构](FILE-SYNC-ARCHITECTURE.md)
- [安装指南](INSTALLATION.md)
- [手动测试指南](MANUAL-TESTING-GUIDE.md)

---

## ⚡ 快速参考

### 关键文件

| 文件 | 职责 |
|------|------|
| `packages/extension/src/content/overleaf-sync.ts` | Overleaf WebSocket 客户端 |
| `packages/extension/src/content/injector.ts` | 内容脚本，注册回调 |
| `packages/mirror-server/src/server.ts` | 服务端，处理文件操作 |
| `packages/mirror-server/src/types.ts` | 消息类型定义 |

### 关键方法

| 组件 | 方法 | 作用 |
|------|------|------|
| OverleafWebSocketClient | `onChange()` | 注册变化监听 |
| OverleafWebSocketClient | `getDocInfo()` | 从 ID 获取路径 |
| Content Script | 回调函数 | 处理文件操作事件 |
| Mirror Server | `handleFileDeleted()` | 删除文件（使用路径） |

---

**最后更新**: 2026-03-09
**维护者**: Overleaf Mirror Team
**状态**: ✅ 生产就绪
