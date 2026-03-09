# 本地文件到 Overleaf 同步设计文档

**日期**: 2026-03-09
**状态**: 设计阶段
**作者**: Claude Code Assistant

---

## 📋 需求概述

实现本地文件系统到 Overleaf 的反向同步功能，使 Claude Code 可以在本地编辑 LaTeX 项目，并自动同步到 Overleaf。

**核心需求**:
- ✅ 支持文件编辑同步
- ✅ 支持文件创建同步
- ✅ 支持文件删除同步
- ❌ 不支持文件重命名（Claude Code 很少重命名文件）
- ✅ 实时同步（500ms 防抖）
- ✅ 本地优先策略（忽略版本冲突）

---

## 🎯 设计原则

1. **复用现有架构**: 利用浏览器扩展的认证能力
2. **简单可靠**: 本地优先，不处理复杂冲突
3. **实时响应**: 500ms 防抖，及时同步
4. **错误容忍**: 网络错误重试，API 错误记录

---

## 🏗️ 架构设计

### 系统架构图

```
┌─────────────────┐
│ Claude Code     │
│  编辑本地文件    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  FileWatcher (chokidar)         │
│  - 监控本地文件变化               │
│  - 防抖 500ms                    │
└────────┬────────────────────────┘
         │ 检测到变化
         ▼
┌─────────────────────────────────┐
│  OverleafSyncManager            │
│  - path → docId 映射             │
│  - 防抖队列管理                  │
│  - WebSocket 通信                │
└────────┬────────────────────────┘
         │ sync_to_overleaf 消息
         ▼
┌─────────────────────────────────┐
│  Browser Extension              │
│  OverleafAPIHandler             │
│  - 调用 Overleaf API             │
│  - 处理响应和错误                │
└────────┬────────────────────────┘
         │ HTTP fetch()
         ▼
┌─────────────────────────────────┐
│  Overleaf Server                │
│  - 更新/创建/删除文档            │
└─────────────────────────────────┘
```

### 数据流向

**编辑现有文件**:
```
1. Claude Code 编辑 main.tex
2. FileWatcher 检测 change 事件
3. 防抖 500ms
4. OverleafSyncManager 查找 docId
5. 发送消息到扩展
6. 扩展调用 POST /project/{id}/doc/{doc_id}
7. 返回成功/失败
```

**创建新文件**:
```
1. Claude Code 创建 new.tex
2. FileWatcher 检测 add 事件
3. 无 docId 映射 → 创建操作
4. 扩展调用 POST /project/{id}/doc
5. 获取新 docId
6. 更新 path → docId 映射
7. 返回成功和 docId
```

**删除文件**:
```
1. Claude Code 删除 old.tex
2. FileWatcher 检测 unlink 事件
3. 查找 docId
4. 扩展调用 DELETE /project/{id}/doc/{doc_id}
5. 删除 path → docId 映射
6. 返回成功/失败
```

---

## 🔧 组件设计

### 1. FileWatcher 增强

**文件**: `packages/mirror-server/src/filesystem/watcher.ts`

**现有功能**: 监控文件变化，打印日志

**新增功能**:
- 添加 `onChange` 回调接口
- 触发 `FileChangeEvent` 事件
- 提取相对路径

**接口定义**:
```typescript
interface FileChangeEvent {
  type: 'create' | 'update' | 'delete';
  path: string;  // 相对于项目目录的路径
}

type ChangeEventHandler = (event: FileChangeEvent) => void;

class FileWatcher {
  onChange(callback: ChangeEventHandler): void;
}
```

**实现要点**:
- 使用 `ignoreInitial: true` 避免触发已存在文件
- 提取相对路径：`path.replace(projectDir, '')`
- 去除前导斜杠：`path.replace(/^\//, '')`

---

### 2. OverleafSyncManager（新组件）

**文件**: `packages/mirror-server/src/sync/overleaf-sync-manager.ts`

**职责**:
- 管理 path → docId 反向映射
- 防抖处理（500ms）
- 读取文件内容
- 通过 WebSocket 发送同步请求
- 处理同步响应

**核心数据结构**:
```typescript
class OverleafSyncManager {
  private pathToDocId = new Map<string, string>();
  private debounceTimer = new Map<string, NodeJS.Timeout>();
  private projectPath: string;
  private wsClient: any;  // MirrorClient 实例
}
```

**关键方法**:

#### `initializeMappings(docIdToPath: Map<string, DocInfo>)`
```typescript
// 从 OverleafWebSocketClient 的映射初始化反向映射
docIdToPath.forEach((info, docId) => {
  this.pathToDocId.set(info.path, docId);
});
```

#### `handleFileChange(event: FileChangeEvent)`
```typescript
// 防抖处理
clearTimeout(this.debounceTimer.get(event.path));

this.debounceTimer.set(event.path, setTimeout(async () => {
  await this.syncToOverleaf(event);
  this.debounceTimer.delete(event.path);
}, 500));
```

#### `syncToOverleaf(event: FileChangeEvent)`
```typescript
// 读取文件内容
const content = await fs.readFile(
  path.join(this.projectPath, event.path),
  'utf-8'
);

// 查找 docId
const docId = this.pathToDocId.get(event.path);

// 判断操作类型
const operation = docId ? 'update' : 'create';

// 发送到扩展
this.wsClient.send({
  type: 'sync_to_overleaf',
  project_id: this.projectId,
  operation,
  path: event.path,
  doc_id: docId,
  content
});
```

#### `handleSyncResponse(response: SyncToOverleafResponse)`
```typescript
if (response.success) {
  console.log(`✅ Sync to Overleaf successful: ${response.operation} ${response.path}`);

  // 更新映射（创建操作）
  if (response.operation === 'create' && response.doc_id) {
    this.pathToDocId.set(response.path, response.doc_id);
  }

  // 删除映射（删除操作）
  if (response.operation === 'delete') {
    this.pathToDocId.delete(response.path);
  }
} else {
  console.error(`❌ Sync to Overleaf failed: ${response.operation} ${response.path}`);
}
```

---

### 3. OverleafAPIHandler（新组件）

**文件**: `packages/extension/src/content/overleaf-api-handler.ts`

**职责**:
- 接收来自 Mirror Server 的同步请求
- 调用 Overleaf HTTP API
- 处理错误和重试
- 返回结果

**核心方法**:

#### `handleSyncRequest(message: SyncToOverleafMessage)`
```typescript
async handleSyncRequest(message: SyncToOverleafMessage) {
  try {
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
    this.mirrorClient.send({
      type: 'sync_to_overleaf_response',
      success: false,
      error: error.message,
      operation: message.operation,
      path: message.path
    });
  }
}
```

#### `updateDocument(message: SyncToOverleafMessage)`
```typescript
const response = await fetch(
  `/project/${message.project_id}/doc/${message.doc_id}`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lines: message.content.split('\n'),
      version: -1  // 本地优先，强制更新
    })
  }
);

if (!response.ok) {
  throw new Error(`Update failed: ${response.status}`);
}

return {
  type: 'sync_to_overleaf_response',
  success: true,
  operation: 'update',
  path: message.path
};
```

#### `createDocument(message: SyncToOverleafMessage)`
```typescript
// 解析路径
const pathParts = message.path.split('/');
const fileName = pathParts.pop() || message.path;

// 创建文档
const response = await fetch(
  `/project/${message.project_id}/doc`,
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
  throw new Error(`Create failed: ${response.status}`);
}

const data = await response.json();

// 立即更新内容
await this.updateDocument({
  ...message,
  doc_id: data._id
});

return {
  type: 'sync_to_overleaf_response',
  success: true,
  operation: 'create',
  path: message.path,
  doc_id: data._id
};
```

#### `deleteDocument(message: SyncToOverleafMessage)`
```typescript
const response = await fetch(
  `/project/${message.project_id}/doc/${message.doc_id}`,
  {
    method: 'DELETE'
  }
);

// 404 也算成功（文件已删除）
if (!response.ok && response.status !== 404) {
  throw new Error(`Delete failed: ${response.status}`);
}

return {
  type: 'sync_to_overleaf_response',
  success: true,
  operation: 'delete',
  path: message.path
};
```

---

### 4. Mirror Server 集成

**文件**: `packages/mirror-server/src/server.ts`

**新增消息处理**:
```typescript
case 'sync_to_overleaf_response':
  this.handleSyncResponse(message);
  break;
```

**初始化流程**:
```typescript
// 在项目初始化时
async initializeProject(projectId: string) {
  // 1. 启动 FileWatcher
  const fileWatcher = new FileWatcher(projectId);

  // 2. 创建 OverleafSyncManager
  const syncManager = new OverleafSyncManager(projectId, this.ws);

  // 3. 设置回调
  fileWatcher.onChange((event) => {
    syncManager.handleFileChange(event);
  });

  // 4. 启动监控
  await fileWatcher.start();

  // 5. 初始化映射（等待 OverleafWebSocketClient 完成）
  syncManager.initializeMappings(docIdToPath);
}
```

---

### 5. Browser Extension 集成

**文件**: `packages/extension/src/content/injector.ts`

**新增内容**:
```typescript
import { OverleafAPIHandler } from './overleaf-api-handler';

// 在 initializeMirror() 中
async function initializeMirror(): Promise<void> {
  // ... 现有代码 ...

  // 创建 API Handler
  const apiHandler = new OverleafAPIHandler(mirrorClient, projectId);

  // 注册消息处理
  mirrorClient.onMessage((message: any) => {
    if (message.type === 'sync_to_overleaf') {
      apiHandler.handleSyncRequest(message);
    }
  });
}
```

---

## 📦 消息格式

### Mirror Server → Extension

```typescript
interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;          // 文件路径（相对）
  content?: string;      // 文件内容（update/create 时）
  doc_id?: string;       // 文档 ID（update/delete 时）
  timestamp: number;
}
```

### Extension → Mirror Server（响应）

```typescript
interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  success: boolean;
  error?: string;
  doc_id?: string;       // 创建操作返回的新 doc_id
  timestamp: number;
}
```

---

## ⚠️ 错误处理

### 1. 网络错误

**策略**: 重试 3 次，指数退避

```typescript
private async retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = initialDelay * Math.pow(2, i);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}
```

### 2. API 错误

| 状态码 | 处理策略 |
|-------|---------|
| **200 OK** | 成功 |
| **400 Bad Request** | 记录错误，跳过 |
| **403 Forbidden** | 认证失败，通知用户 |
| **404 Not Found** | 删除操作可能成功，继续 |
| **409 Conflict** | 本地优先模式忽略 |
| **429 Too Many Requests** | 延迟重试 |
| **500 Server Error** | 重试 |

### 3. 文件系统错误

- **文件不存在**: 跳过同步
- **权限错误**: 记录错误
- **编码错误**: 尝试 UTF-8，失败跳过

---

## 🧪 测试计划

### 单元测试

**FileWatcher 测试**:
- [ ] 创建文件触发 `add` 事件
- [ ] 修改文件触发 `change` 事件
- [ ] 删除文件触发 `unlink` 事件
- [ ] 防抖机制测试

**OverleafSyncManager 测试**:
- [ ] path → docId 映射维护
- [ ] 防抖队列管理
- [ ] 消息发送格式正确

**OverleafAPIHandler 测试**:
- [ ] API 调用格式正确
- [ ] 错误处理正确
- [ ] 重试机制测试

### 集成测试

**编辑同步**:
- [ ] 编辑文件 → 500ms 后同步到 Overleaf
- [ ] 验证 Overleaf 内容正确

**创建同步**:
- [ ] 创建新文件 → 同步到 Overleaf
- [ ] 验证文件在 Overleaf 出现
- [ ] 验证 path → docId 映射更新

**删除同步**:
- [ ] 删除文件 → 同步到 Overleaf
- [ ] 验证文件在 Overleaf 删除
- [ ] 验证映射清理

### 手动测试场景

1. **基础编辑测试**:
   - 在 VS Code 编辑 `main.tex`
   - 添加一行文本
   - 等待 500ms
   - 刷新 Overleaf，验证内容更新

2. **快速连续编辑**:
   - 快速编辑同一文件多次
   - 验证只同步最后一次（防抖）

3. **批量编辑**:
   - 同时编辑多个文件
   - 验证所有文件都同步

4. **新建文件**:
   - 创建 `chapter1.tex`
   - 写入内容
   - 验证 Overleaf 出现新文件

5. **删除文件**:
   - 删除 `old.tex`
   - 验证 Overleaf 文件删除

6. **错误恢复**:
   - 断开网络 → 编辑文件 → 恢复网络
   - 验证重试成功

---

## 📊 性能考虑

### 资源占用

- **内存**: path → docId 映射（~1000 文件 < 1MB）
- **网络**: 每次同步 < 10KB
- **CPU**: 防抖计时器（可忽略）

### 同步延迟

- **防抖延迟**: 500ms
- **网络往返**: ~100ms
- **总延迟**: < 1 秒

### 并发处理

- 不同文件变化 → 并发处理
- 同一文件多次变化 → 防抖合并

---

## 🚧 实现顺序

### Phase 1: 基础设施（优先级：高）
1. ✅ FileWatcher 增强添加回调
2. ✅ OverleafSyncManager 创建
3. ✅ Mirror Server 集成

### Phase 2: API Handler（优先级：高）
1. ✅ OverleafAPIHandler 创建
2. ✅ updateDocument 实现
3. ✅ Extension 集成

### Phase 3: 创建和删除（优先级：中）
1. ✅ createDocument 实现
2. ✅ deleteDocument 实现
3. ✅ 映射管理

### Phase 4: 错误处理（优先级：中）
1. ✅ 网络重试
2. ✅ API 错误处理
3. ✅ 日志记录

### Phase 5: 测试和优化（优先级：低）
1. ⏳ 单元测试
2. ⏳ 集成测试
3. ⏳ 手动测试
4. ⏳ 性能优化

---

## 📝 注意事项

### 限制

1. **不支持重命名**: Claude Code 很少重命名文件
2. **仅文本文件**: 二进制文件后续处理
3. **需要浏览器打开**: Overleaf 页面必须打开

### 未来改进

- [ ] 支持二进制文件同步
- [ ] 支持文件重命名
- [ ] 冲突解决机制
- [ ] 批量同步优化
- [ ] 离线同步支持

---

## ✅ 验收标准

- [ ] 编辑本地文件，Overleaf 自动更新（< 1秒）
- [ ] 创建本地文件，Overleaf 自动创建
- [ ] 删除本地文件，Overleaf 自动删除
- [ ] 快速编辑同一文件，只同步最后一次
- [ ] 网络错误自动重试
- [ ] 所有操作有日志记录

---

**设计版本**: 1.0
**最后更新**: 2026-03-09
**状态**: 待评审
