# 本地到 Overleaf 同步实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 实现本地文件系统到 Overleaf 的反向同步，支持编辑、创建、删除操作

**架构:** 使用浏览器扩展代理方案，Mirror Server 检测本地文件变化，通过 WebSocket 请求扩展调用 Overleaf API

**技术栈:** chokidar（文件监控）、WebSocket（通信）、fetch API（HTTP 请求）

---

## Task 1: 增强 FileWatcher 添加回调接口

**目标:** 让 FileWatcher 支持回调机制，以便在文件变化时通知其他组件

**文件:**
- 修改: `packages/mirror-server/src/filesystem/watcher.ts`

**步骤 1: 添加接口定义**

在文件顶部添加：

```typescript
interface FileChangeEvent {
  type: 'create' | 'update' | 'delete';
  path: string;  // 相对于项目目录的路径
}

type ChangeEventHandler = (event: FileChangeEvent) => void;
```

**步骤 2: 添加私有字段**

在 FileWatcher 类中添加：

```typescript
private onChangeCallback?: ChangeEventHandler;
private projectDir: string;
```

**步骤 3: 修改 constructor 保存 projectDir**

```typescript
constructor(
  private projectId: string,
  private basePath?: string
) {
  this.projectDir = this.basePath || join(homedir(), 'overleaf-mirror', this.projectId);
}
```

**步骤 4: 添加 onChange 方法**

```typescript
onChange(callback: ChangeEventHandler): void {
  this.onChangeCallback = callback;
  console.log('[FileWatcher] Change callback registered');
}
```

**步骤 5: 添加路径提取辅助方法**

```typescript
private extractRelativePath(fullPath: string): string {
  return fullPath
    .replace(this.projectDir, '')
    .replace(/^\/+/, '');
}
```

**步骤 6: 修改事件监听器添加回调**

在 `start()` 方法中修改事件监听：

```typescript
this.watcher
  .on('add', (path) => {
    const relativePath = this.extractRelativePath(path);
    console.log(`[FileWatcher] File added: ${relativePath}`);
    this.onChangeCallback?.({
      type: 'create',
      path: relativePath
    });
  })
  .on('change', (path) => {
    const relativePath = this.extractRelativePath(path);
    console.log(`[FileWatcher] File modified: ${relativePath}`);
    this.onChangeCallback?.({
      type: 'update',
      path: relativePath
    });
  })
  .on('unlink', (path) => {
    const relativePath = this.extractRelativePath(path);
    console.log(`[FileWatcher] File deleted: ${relativePath}`);
    this.onChangeCallback?.({
      type: 'delete',
      path: relativePath
    });
  })
```

**步骤 7: 导出接口**

在文件末尾添加：

```typescript
export type { FileChangeEvent, ChangeEventHandler };
```

**步骤 8: 提交**

```bash
git add packages/mirror-server/src/filesystem/watcher.ts
git commit -m "feat(file-watcher): add onChange callback interface

- Add FileChangeEvent and ChangeEventHandler types
- Add onChange() method to register callbacks
- Extract relative paths in event handlers
- Support create/update/delete event types
"
```

---

## Task 2: 创建 OverleafSyncManager 组件

**目标:** 创建同步管理器，负责映射维护、防抖处理和 WebSocket 通信

**文件:**
- 创建: `packages/mirror-server/src/sync/overleaf-sync-manager.ts`

**步骤 1: 创建文件结构和导入**

```typescript
import { WebSocket } from 'ws';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

import type { FileChangeEvent } from '../filesystem/watcher';
```

**步骤 2: 定义消息接口**

```typescript
interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  content?: string;
  doc_id?: string;
  timestamp: number;
}

interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  timestamp: number;
}
```

**步骤 3: 创建类和构造函数**

```typescript
export class OverleafSyncManager {
  private pathToDocId = new Map<string, string>();
  private debounceTimer = new Map<string, NodeJS.Timeout>();
  private projectPath: string;
  private projectId: string;
  private wsClient: WebSocket | null = null;

  constructor(projectId: string, wsPort: number = 3456) {
    this.projectId = projectId;
    this.projectPath = join(homedir(), 'overleaf-mirror', projectId);

    // 连接到扩展的 WebSocket
    this.wsClient = new WebSocket(`ws://localhost:${wsPort}`);

    this.wsClient.on('open', () => {
      console.log('[OverleafSyncManager] Connected to Mirror Server');
    });

    this.wsClient.on('message', (data: string) => {
      this.handleMessage(data);
    });
  }
}
```

**步骤 4: 添加消息处理方法**

```typescript
private handleMessage(data: string): void {
  try {
    const message = JSON.parse(data);

    if (message.type === 'sync_to_overleaf_response') {
      this.handleSyncResponse(message as SyncToOverleafResponse);
    }
  } catch (error) {
    console.error('[OverleafSyncManager] Failed to parse message:', error);
  }
}
```

**步骤 5: 添加映射初始化方法**

```typescript
initializeMappings(docIdToPath: Map<string, { path: string }>): void {
  console.log(`[OverleafSyncManager] Initializing ${docIdToPath.size} mappings`);

  this.pathToDocId.clear();

  docIdToPath.forEach((info, docId) => {
    this.pathToDocId.set(info.path, docId);
  });

  console.log(`[OverleafSyncManager] ✅ Initialized path → docId mappings`);
}
```

**步骤 6: 添加文件变化处理方法**

```typescript
async handleFileChange(event: FileChangeEvent): Promise<void> {
  // 防抖处理
  if (this.debounceTimer.has(event.path)) {
    clearTimeout(this.debounceTimer.get(event.path));
  }

  const timer = setTimeout(async () => {
    await this.syncToOverleaf(event);
    this.debounceTimer.delete(event.path);
  }, 500); // 500ms 防抖

  this.debounceTimer.set(event.path, timer);
}
```

**步骤 7: 添加同步到 Overleaf 方法**

```typescript
private async syncToOverleaf(event: FileChangeEvent): Promise<void> {
  try {
    console.log(`[OverleafSyncManager] Syncing to Overleaf: ${event.type} ${event.path}`);

    // 读取文件内容
    const content = await readFile(
      join(this.projectPath, event.path),
      'utf-8'
    );

    // 查找 docId
    const docId = this.pathToDocId.get(event.path);

    // 判断操作类型
    const operation = docId ? 'update' : 'create';

    // 发送消息到扩展
    const message: SyncToOverleafMessage = {
      type: 'sync_to_overleaf',
      project_id: this.projectId,
      operation,
      path: event.path,
      content,
      doc_id: docId,
      timestamp: Date.now()
    };

    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify(message));
      console.log(`[OverleafSyncManager] ✅ Sent sync request: ${operation} ${event.path}`);
    } else {
      console.warn('[OverleafSyncManager] ⚠️ WebSocket not connected');
    }
  } catch (error) {
    console.error(`[OverleafSyncManager] ❌ Failed to sync ${event.path}:`, error);
  }
}
```

**步骤 8: 添加响应处理方法**

```typescript
private handleSyncResponse(response: SyncToOverleafResponse): void {
  if (response.success) {
    console.log(`[OverleafSyncManager] ✅ Sync successful: ${response.operation} ${response.path}`);

    // 更新映射（创建操作）
    if (response.operation === 'create' && response.doc_id) {
      this.pathToDocId.set(response.path, response.doc_id);
      console.log(`[OverleafSyncManager] ✅ Mapped ${response.path} → ${response.doc_id}`);
    }

    // 删除映射（删除操作）
    if (response.operation === 'delete') {
      this.pathToDocId.delete(response.path);
      console.log(`[OverleafSyncManager] ✅ Unmapped ${response.path}`);
    }
  } else {
    console.error(`[OverleafSyncManager] ❌ Sync failed: ${response.operation} ${response.path}`);
    if (response.error) {
      console.error(`[OverleafSyncManager] Error: ${response.error}`);
    }
  }
}
```

**步骤 9: 添加停止方法**

```typescript
stop(): void {
  if (this.wsClient) {
    this.wsClient.close();
    this.wsClient = null;
  }

  // 清理防抖定时器
  this.debounceTimer.forEach(timer => clearTimeout(timer));
  this.debounceTimer.clear();
}
```

**步骤 10: 提交**

```bash
git add packages/mirror-server/src/sync/overleaf-sync-manager.ts
git commit -m "feat(sync-manager): add OverleafSyncManager component

- Create sync manager for local → Overleaf synchronization
- Maintain path → docId reverse mapping
- Implement 500ms debounce for file changes
- WebSocket communication with browser extension
- Handle sync responses and update mappings
"
```

---

## Task 3: 创建 OverleafAPIHandler 组件

**目标:** 在浏览器扩展中创建 API 处理器，调用 Overleaf API

**文件:**
- 创建: `packages/extension/src/content/overleaf-api-handler.ts`

**步骤 1: 创建文件和导入**

```typescript
import { MirrorClient } from '../client';
```

**步骤 2: 定义消息接口**

```typescript
interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  content?: string;
  doc_id?: string;
  timestamp: number;
}

interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  timestamp: number;
}
```

**步骤 3: 创建类**

```typescript
export class OverleafAPIHandler {
  constructor(
    private mirrorClient: MirrorClient,
    private projectId: string
  ) {}
}
```

**步骤 4: 添加主处理方法**

```typescript
async handleSyncRequest(message: SyncToOverleafMessage): Promise<void> {
  try {
    console.log(`[APIHandler] ${message.operation} ${message.path}`);

    let result: SyncToOverleafResponse;

    switch (message.operation) {
      case 'update':
        result = await this.updateDocument(message);
        break;
      case 'create':
        result = await this.createDocument(message);
        break;
      case 'delete':
        result = await this.deleteDocument(message);
        break;
      default:
        throw new Error(`Unknown operation: ${message.operation}`);
    }

    this.mirrorClient.send(result);
  } catch (error) {
    console.error(`[APIHandler] ❌ ${message.operation} failed:`, error);

    this.mirrorClient.send({
      type: 'sync_to_overleaf_response',
      project_id: this.projectId,
      operation: message.operation,
      path: message.path,
      success: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
}
```

**步骤 5: 添加更新文档方法**

```typescript
private async updateDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
  const response = await fetch(
    `/project/${message.project_id}/doc/${message.doc_id}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lines: message.content!.split('\n'),
        version: -1  // 本地优先，强制更新
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Update failed: ${response.status} ${response.statusText}`);
  }

  console.log(`[APIHandler] ✅ Updated: ${message.path}`);

  return {
    type: 'sync_to_overleaf_response',
    project_id: this.projectId,
    operation: 'update',
    path: message.path,
    success: true,
    timestamp: Date.now()
  };
}
```

**步骤 6: 添加创建文档方法**

```typescript
private async createDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
  // 解析路径
  const pathParts = message.path.split('/');
  const fileName = pathParts.pop() || message.path;

  // 创建文档
  const response = await fetch(
    `/project/${this.projectId}/doc`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fileName,
        parent_folder_id: 'rootFolder'
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Create failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log(`[APIHandler] ✅ Created: ${message.path} (id: ${data._id})`);

  // 立即更新内容
  await this.updateDocument({
    ...message,
    doc_id: data._id
  });

  return {
    type: 'sync_to_overleaf_response',
    project_id: this.projectId,
    operation: 'create',
    path: message.path,
    success: true,
    doc_id: data._id,
    timestamp: Date.now()
  };
}
```

**步骤 7: 添加删除文档方法**

```typescript
private async deleteDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
  const response = await fetch(
    `/project/${this.project_id}/doc/${message.doc_id}`,
    {
      method: 'DELETE'
    }
  );

  // 404 也算成功（文件已删除）
  if (!response.ok && response.status !== 404) {
    throw new Error(`Delete failed: ${response.status} ${response.statusText}`);
  }

  console.log(`[APIHandler] ✅ Deleted: ${message.path}`);

  return {
    type: 'sync_to_overleaf_response',
    project_id: this.projectId,
    operation: 'delete',
    path: message.path,
    success: true,
    timestamp: Date.now()
  };
}
```

**步骤 8: 提交**

```bash
git add packages/extension/src/content/overleaf-api-handler.ts
git commit -m "feat(api-handler): add OverleafAPIHandler for sync operations

- Create API handler in browser extension
- Implement updateDocument() for editing existing files
- Implement createDocument() for creating new files
- Implement deleteDocument() for deleting files
- Use local-first strategy (version: -1)
- Handle errors and send responses to Mirror Server
"
```

---

## Task 4: 在 Mirror Server 集成 FileWatcher 和 SyncManager

**目标:** 在 Mirror Server 中启动文件监控并连接各组件

**文件:**
- 修改: `packages/mirror-server/src/server.ts`
- 修改: `packages/mirror-server/src/config.ts`

**步骤 1: 添加配置项**

在 `config.ts` 中添加：

```typescript
export interface ProjectConfig {
  projectId: string;
  localPath: string;
  enableFileSync?: boolean;  // 新增：是否启用文件同步
}
```

**步骤 2: 导入新组件**

在 `server.ts` 顶部添加：

```typescript
import { FileWatcher } from './filesystem/watcher';
import { OverleafSyncManager } from './sync/overleaf-sync-manager';
import type { FileChangeEvent } from './filesystem/watcher';
```

**步骤 3: 添加私有字段**

在 MirrorServer 类中添加：

```typescript
private fileWatchers = new Map<string, FileWatcher>();
private syncManagers = new Map<string, OverleafSyncManager>();
```

**步骤 4: 添加启动文件监控方法**

```typescript
private startFileSync(projectId: string, docIdToPath: Map<string, any>): void {
  console.log(`[Server] Starting file sync for project: ${projectId}`);

  // 创建 FileWatcher
  const fileWatcher = new FileWatcher(projectId, this.configStore.getProjectConfig(projectId).localPath);

  // 创建 SyncManager
  const syncManager = new OverleafSyncManager(projectId, this.config.port);

  // 初始化映射
  syncManager.initializeMappings(docIdToPath);

  // 设置回调
  fileWatcher.onChange((event: FileChangeEvent) => {
    syncManager.handleFileChange(event);
  });

  // 启动监控
  fileWatcher.start().catch((error) => {
    console.error(`[Server] Failed to start file watcher:`, error);
  });

  // 保存实例
  this.fileWatchers.set(projectId, fileWatcher);
  this.syncManagers.set(projectId, syncManager);

  console.log(`[Server] ✅ File sync started for project: ${projectId}`);
}
```

**步骤 5: 添加处理同步响应方法**

```typescript
private handleSyncResponse(message: any): void {
  const { project_id, success, operation, path, doc_id, error } = message;

  const syncManager = this.syncManagers.get(project_id);
  if (!syncManager) {
    console.warn(`[Server] ⚠️ No sync manager for project: ${project_id}`);
    return;
  }

  if (success) {
    console.log(`[Server] ✅ Sync to Overleaf successful: ${operation} ${path}`);

    // 对于创建操作，更新 path → docId 映射
    if (operation === 'create' && doc_id) {
      syncManager.updateMapping(path, doc_id);
    }
  } else {
    console.error(`[Server] ❌ Sync to Overleaf failed: ${operation} ${path} - ${error}`);
  }
}
```

**步骤 6: 在 handleClientMessage 中处理响应**

在 `handleClientMessage` 方法的 switch 语句中添加：

```typescript
case 'sync_to_overleaf_response':
  this.handleSyncResponse(message);
  break;
```

**步骤 7: 在项目初始化时启动文件同步**

找到处理初始同步完成的位置，添加：

```typescript
// 在 file_sync 处理完成后
if (this.configStore.getProjectConfig(projectId).enableFileSync) {
  this.startFileSync(projectId, docIdToPath);
}
```

**步骤 8: 添加停止文件监控方法**

```typescript
private stopFileSync(projectId: string): void {
  const fileWatcher = this.fileWatchers.get(projectId);
  const syncManager = this.syncManagers.get(projectId);

  if (fileWatcher) {
    fileWatcher.stop();
    this.fileWatchers.delete(projectId);
  }

  if (syncManager) {
    syncManager.stop();
    this.syncManagers.delete(projectId);
  }

  console.log(`[Server] Stopped file sync for project: ${projectId}`);
}
```

**步骤 9: 在 WebSocket 关闭时清理**

在 `handleClose` 方法中添加：

```typescript
// 停止所有文件监控
for (const projectId of this.fileWatchers.keys()) {
  this.stopFileSync(projectId);
}
```

**步骤 10: 为 SyncManager 添加 updateMapping 方法**

在 OverleafSyncManager 中添加：

```typescript
updateMapping(path: string, docId: string): void {
  this.pathToDocId.set(path, docId);
  console.log(`[OverleafSyncManager] ✅ Updated mapping: ${path} → ${docId}`);
}
```

**步骤 11: 提交**

```bash
git add packages/mirror-server/src/server.ts packages/mirror-server/src/config.ts packages/mirror-server/src/sync/overleaf-sync-manager.ts
git commit -m "feat(server): integrate FileWatcher and SyncManager

- Add startFileSync() method to initialize file monitoring
- Add handleSyncResponse() to process sync results
- Add stopFileSync() for cleanup
- Add updateMapping() to SyncManager
- Start file sync after initial sync completes
- Clean up on WebSocket close
"
```

---

## Task 5: 在浏览器扩展中集成 API Handler

**目标:** 在扩展中注册 API 处理器，处理来自 Mirror Server 的同步请求

**文件:**
- 修改: `packages/extension/src/content/injector.ts`

**步骤 1: 导入 API Handler**

在文件顶部添加：

```typescript
import { OverleafAPIHandler } from './overleaf-api-handler';
```

**步骤 2: 在 initializeMirror 中注册处理器**

找到 `initializeMirror()` 函数，在 EditMonitor 初始化后添加：

```typescript
// 创建 API Handler
const apiHandler = new OverleafAPIHandler(mirrorClient, projectId);

// 注册消息处理
mirrorClient.onMessage((message: any) => {
  if (message.type === 'sync_to_overleaf') {
    console.log('[Mirror] Received sync_to_overleaf request:', message);
    apiHandler.handleSyncRequest(message);
  }
});

console.log('[Mirror] ✅ Overleaf API Handler registered');
```

**步骤 3: 更新初始化完成日志**

修改最后的日志：

```typescript
console.log('[Mirror] ✅ Initialization complete (including Overleaf sync)');
```

**步骤 4: 提交**

```bash
git add packages/extension/src/content/injector.ts
git commit -m "feat(extension): integrate OverleafAPIHandler

- Import OverleafAPIHandler
- Create handler instance in initializeMirror()
- Register message listener for sync_to_overleaf
- Handle sync requests from Mirror Server
"
```

---

## Task 6: 添加网络重试机制

**目标:** 为 API 调用添加重试逻辑，提高可靠性

**文件:**
- 修改: `packages/extension/src/content/overleaf-api-handler.ts`

**步骤 1: 添加重试辅助方法**

在 OverleafAPIHandler 类中添加：

```typescript
private async retryWithBackoff<T>(
  fn: () => Promise<T>,
  context: string,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) {
        throw error;
      }

      const delay = initialDelay * Math.pow(2, i);
      console.warn(`[APIHandler] ⚠️ ${context} failed (attempt ${i + 1}/${maxRetries}), retrying in ${delay}ms...`);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error(`${context}: Max retries exceeded`);
}
```

**步骤 2: 在 updateDocument 中使用重试**

```typescript
private async updateDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
  const response = await this.retryWithBackoff(
    async () => await fetch(
      `/project/${message.project_id}/doc/${message.doc_id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lines: message.content!.split('\n'),
          version: -1
        })
      }
    ),
    `Update ${message.path}`
  );

  if (!response.ok) {
    throw new Error(`Update failed: ${response.status} ${response.statusText}`);
  }

  console.log(`[APIHandler] ✅ Updated: ${message.path}`);

  return {
    type: 'sync_to_overleaf_response',
    project_id: this.projectId,
    operation: 'update',
    path: message.path,
    success: true,
    timestamp: Date.now()
  };
}
```

**步骤 3: 在 createDocument 中使用重试**

修改 fetch 调用：

```typescript
const response = await this.retryWithBackoff(
  async () => await fetch(
    `/project/${this.project_id}/doc`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fileName,
        parent_folder_id: 'rootFolder'
      })
    }
  ),
  `Create ${message.path}`
);
```

**步骤 4: 在 deleteDocument 中使用重试**

修改 fetch 调用：

```typescript
const response = await this.retryWithBackoff(
  async () => await fetch(
    `/project/${this.project_id}/doc/${message.doc_id}`,
    {
      method: 'DELETE'
    }
  ),
  `Delete ${message.path}`
);
```

**步骤 5: 提交**

```bash
git add packages/extension/src/content/overleaf-api-handler.ts
git commit -m "feat(api-handler): add retry mechanism with exponential backoff

- Add retryWithBackoff() helper method
- Retry up to 3 times with exponential backoff
- Apply retry to updateDocument, createDocument, deleteDocument
- Log retry attempts for debugging
"
```

---

## Task 7: 添加类型定义到共享类型文件

**目标:** 在共享类型文件中定义同步消息类型

**文件:**
- 修改: `packages/mirror-server/src/types.ts` 或创建共享类型文件

**步骤 1: 添加消息类型定义**

在 types.ts 中添加：

```typescript
// Local to Overleaf sync messages
export interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  content?: string;
  doc_id?: string;
  timestamp: number;
}

export interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  timestamp: number;
}
```

**步骤 2: 提交**

```bash
git add packages/mirror-server/src/types.ts
git commit -m "feat(types): add sync message type definitions

- Add SyncToOverleafMessage interface
- Add SyncToOverleafResponse interface
- Support update, create, delete operations
"
```

---

## Task 8: 构建和测试

**目标:** 构建所有代码并进行手动测试

**步骤 1: 构建扩展**

```bash
cd packages/extension
npm run build
```

预期: 构建成功，无错误

**步骤 2: 构建服务器**

```bash
cd packages/mirror-server
npm run build
```

预期: 构建成功，无错误

**步骤 3: 启动服务器**

```bash
cd packages/mirror-server
npm start
```

预期: 服务器启动在端口 3456

**步骤 4: 重新加载扩展**

在浏览器中：
1. 打开 `chrome://extensions/`
2. 找到 Overleaf Mirror 扩展
3. 点击刷新按钮

**步骤 5: 测试编辑同步**

1. 打开 Overleaf 项目
2. 在本地编辑 `main.tex`（添加一行文本）
3. 等待 1 秒
4. 刷新 Overleaf 页面

预期: Overleaf 中看到更新

**步骤 6: 测试创建同步**

1. 在本地创建新文件 `test.tex`
2. 写入内容：`\\documentclass{article}`
3. 等待 1 秒

预期: Overleaf 中出现新文件

**步骤 7: 测试删除同步**

1. 在本地删除 `test.tex`
2. 等待 1 秒

预期: Overleaf 中文件被删除

**步骤 8: 测试防抖**

1. 在本地快速编辑同一文件 3 次
2. 每次间隔 < 500ms

预期: 只同步最后一次

**步骤 9: 提交文档更新**

如果有问题，创建 bugfix 提交：

```bash
git add .
git commit -m "test: manual testing and bug fixes

- Build all packages
- Test file editing sync
- Test file creation sync
- Test file deletion sync
- Test debounce mechanism
- Fix any discovered issues
"
```

---

## Task 9: 更新文档

**目标:** 更新进度报告和 README，反映新功能

**文件:**
- 修改: `docs/PROGRESS-REPORT.md`
- 修改: `README.md`

**步骤 1: 更新 PROGRESS-REPORT.md**

在 Phase 2 部分添加：

```markdown
### Phase 2: 本地 → Overleaf 同步 ✅

**实现时间**: 2026-03-09

**关键组件**:
- FileWatcher: 本地文件监控
- OverleafSyncManager: 同步管理
- OverleafAPIHandler: API 调用

**功能**:
- ✅ 实时编辑同步（500ms 防抖）
- ✅ 文件创建同步
- ✅ 文件删除同步
- ✅ 网络重试机制（3次，指数退避）
- ✅ 本地优先策略
```

**步骤 2: 更新 README.md**

修改功能状态表：

```markdown
| 功能 | 状态 | 说明 |
|------|------|------|
| 📥 **初始同步** | ✅ 完成 | 打开 Overleaf 项目时自动同步所有文件 |
| ✏️ **实时编辑同步** | ✅ 完成 | 监听 Overleaf 编辑操作，实时更新本地文件 |
| ➕ **文件创建** | ✅ 完成 | Overleaf 中新建文件自动同步到本地 |
| 🗑️ **文件删除** | ✅ 完成 | Overleaf 中删除文件自动同步到本地 |
| ✏️ **文件重命名** | ✅ 完成 | Overleaf 中重命名文件自动同步到本地 |
| 📤 **反向同步** | ✅ 完成 | 本地编辑自动同步到 Overleaf |
```

**步骤 3: 提交**

```bash
git add docs/PROGRESS-REPORT.md README.md
git commit -m "docs: update documentation with Phase 2 completion

- Update PROGRESS-REPORT.md with Phase 2 details
- Mark Phase 2 as complete (100%)
- Update README.md feature status table
- Add local to Overleaf sync description
"
```

---

## 验收标准

完成所有任务后，应该满足：

- [ ] 编辑本地文件，Overleaf 在 < 1 秒内更新
- [ ] 创建本地文件，Overleaf 自动创建
- [ ] 删除本地文件，Overleaf 自动删除
- [ ] 快速编辑同一文件，只同步最后一次（防抖）
- [ ] 网络错误自动重试（最多 3 次）
- [ ] 所有操作有日志记录
- [ ] 构建成功，无 TypeScript 错误
- [ ] 手动测试通过

---

**实现计划版本**: 1.0
**创建日期**: 2026-03-09
**预计时间**: 2-3 小时
**复杂度**: 中等
