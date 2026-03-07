# Mirror Server 文件系统实现 - 设计文档

**日期**: 2026-03-07
**状态**: 设计阶段
**作者**: Claude + User

---

## 1. 概述

### 1.1 目标

将 Mirror Server 从日志输出升级为真实的文件系统操作，实现 Overleaf 项目到本地磁盘的完整镜像。

### 1.2 核心需求

- **完整镜像**: 同步所有文件类型（文本 + 二进制）
- **自定义路径**: 每个项目独立配置本地存储路径
- **持久化配置**: project_id → localPath 映射保存到配置文件
- **混合同步策略**: 首次完整获取 + OT 增量更新 + 定期校验
- **跨平台支持**: Windows/macOS/Linux
- **用户可控**: 二进制文件同步可配置

### 1.3 当前状态

**已实现**:
- ✅ 编辑事件拦截（WebSocket hijacking）
- ✅ 文件操作拦截（webRequest API）
- ✅ 日志输出框架
- ✅ FileSystemManager 基础类

**待实现**:
- ❌ 真实文件系统操作
- ❌ 配置持久化
- ❌ Overleaf API 调用
- ❌ OT 操作应用
- ❌ 定期同步机制

---

## 2. 架构设计

### 2.1 数据流

```
Browser Extension                    Mirror Server
────────────────────────────────────────────────────────

【流程1：文件新增/删除】
webRequest API 拦截
      ↓
HTTP POST → /api/mirror
      ↓
FileOperationHandler
      ↓
  ┌─────┴─────┐
  ↓           ↓
 文件新增    文件删除
  ↓           ↓
 创建本地    删除本地
 文件/文件夹  文件/文件夹

【流程2：文本编辑】
WebSocket 拦截
      ↓
edit_event 消息
      ↓
TextFileSyncManager
      ↓
  OT 增量更新
      ↓
写入本地文件

【流程3：定期校验】
FileListSyncScheduler (定时器)
      ↓
OverleafAPIClient 获取完整文件列表
      ↓
对比本地文件系统
      ↓
  ┌─────┴─────┐
  ↓           ↓
 缺失文件    多余文件
  ↓           ↓
 下载        询问用户
            (是否删除)
```

### 2.2 核心组件

```
MirrorServer
    ↓
    ├── ProjectConfigStore (配置管理)
    ├── TextFileSyncManager (文本同步)
    ├── BinaryFileSyncManager (二进制同步)
    ├── OverleafAPIClient (API 调用)
    ├── FileOperationHandler (文件操作)
    ├── FileListSyncScheduler (定期校验)
    └── ErrorHandler (错误处理)
```

---

## 3. 组件详细设计

### 3.1 ProjectConfigStore - 项目配置管理

**职责**: 管理 project_id → localPath 映射配置

**配置文件**: `~/.overleaf-mirror/config.json`

**数据结构**:
```typescript
interface ProjectConfig {
  projectId: string;
  projectName?: string;
  localPath: string;
  createdAt: number;
  lastSyncAt: number;
  syncBinaryFiles: boolean;
}

interface GlobalConfig {
  version: string;
  defaultMirrorDir: string;
  projects: Record<string, ProjectConfig>;
}
```

**核心方法**:
```typescript
class ProjectConfigStore {
  getProjectConfig(projectId: string): ProjectConfig;
  setProjectPath(projectId: string, localPath: string): Promise<void>;
  updateLastSync(projectId: string): Promise<void>;
  listProjects(): ProjectConfig[];
  save(): Promise<void>;
}
```

**默认路径逻辑**:
```typescript
import { homedir } from 'os';
import { join } from 'path';

const getDefaultPath = (projectId: string): string => {
  const baseDir = join(homedir(), 'overleaf-mirror');
  return join(baseDir, projectId);
};
```

---

### 3.2 TextFileSyncManager - 文本文件同步

**职责**: 处理文本文件的实时编辑（OT 操作）

**核心方法**:
```typescript
class TextFileSyncManager {
  handleEditEvent(event: EditEventData): Promise<void>;
  initialSync(docId: string, docName: string): Promise<void>;
  applyOps(docPath: string, ops: AnyOperation[]): Promise<void>;
  verifyAndCorrect(docPath: string, docId: string): Promise<void>;

  private docContentCache: Map<string, string>;
}
```

**编辑事件处理流程**:
```typescript
async handleEditEvent(event: EditEventData): Promise<void> {
  const { doc_id, doc_name, ops } = event;
  const docPath = this.resolveDocPath(doc_name);

  // 1. 检查本地文件是否存在
  if (!await this.fileManager.fileExists(docPath)) {
    await this.initialSync(doc_id, doc_name);
    return;
  }

  // 2. 应用 OT 操作
  await this.applyOps(docPath, ops);

  // 3. 更新同步时间
  await this.configStore.updateLastSync(this.projectConfig.projectId);
}
```

**OT 操作应用**:
```typescript
async applyOps(docPath: string, ops: AnyOperation[]): Promise<void> {
  let content = await this.fileManager.readFile(docPath);

  // 按 position 排序（从后往前应用）
  const sortedOps = [...ops].sort((a, b) => b.p - a.p);

  for (const op of sortedOps) {
    if ('i' in op) {
      content = content.slice(0, op.p) + op.i + content.slice(op.p);
    } else if ('d' in op) {
      content = content.slice(0, op.p) + content.slice(op.p + op.d.length);
    }
  }

  await this.fileManager.updateFile(docPath, content);
  this.docContentCache.set(docPath, content);
}
```

**定期校验**:
- 每 10 次编辑或 5 分钟后触发一次完整获取
- 通过 API 获取完整内容并修正本地文件

---

### 3.3 BinaryFileSyncManager - 二进制文件同步

**职责**: 定期轮询并同步二进制文件（.pdf, .png, .jpg 等）

**核心方法**:
```typescript
class BinaryFileSyncManager {
  start(intervalMs: number = 60000): void;
  stop(): void;
  syncOnce(): Promise<void>;
  getRemoteBinaryFiles(): Promise<ProjectFile[]>;
  downloadFile(file: ProjectFile): Promise<void>;
  shouldUpdate(file: ProjectFile): Promise<boolean>;
}
```

**同步流程**:
```typescript
async syncOnce(): Promise<void> {
  if (!this.projectConfig.syncBinaryFiles) return;

  const remoteFiles = await this.getRemoteBinaryFiles();

  for (const file of remoteFiles) {
    if (await this.shouldUpdate(file)) {
      await this.downloadFile(file);
    }
  }
}
```

**版本判断**:
```typescript
async shouldUpdate(file: ProjectFile): Promise<boolean> {
  const localPath = join(this.projectConfig.localPath, file.path);

  if (!await fs.pathExists(localPath)) return true;

  const localStats = await fs.stat(localPath);
  const remoteMtime = new Date(file.updatedAt).getTime();

  return remoteMtime > localStats.mtimeMs;
}
```

---

### 3.4 OverleafAPIClient - API 调用

**职责**: 调用 Overleaf API 获取项目文件和内容

**核心方法**:
```typescript
class OverleafAPIClient {
  getProjectFiles(projectId: string): Promise<ProjectFile[]>;
  getDocContent(projectId: string, docId: string): Promise<string>;
  getFileContent(projectId: string, path: string): Promise<Buffer>;
  updateDoc(projectId: string, docId: string, content: string): Promise<void>;
  uploadFile(projectId: string, path: string, content: Buffer): Promise<void>;
}
```

**Cookie 管理**:
```typescript
// 从浏览器扩展发送
interface ConnectionMessage {
  type: 'connect';
  project_id: string;
  cookies?: Record<string, string>;
}

// MirrorServer 存储
private projectCookies = new Map<string, Map<string, string>>();
```

**API 调用示例**:
```typescript
async getDocContent(projectId: string, docId: string): Promise<string> {
  const url = `https://cn.overleaf.com/project/${projectId}/doc/${docId}`;

  const response = await fetch(url, {
    headers: {
      'Cookie': this.formatCookies(),
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch doc: ${response.statusText}`);
  }

  const data = await response.json();
  return data.content;
}
```

---

### 3.5 FileOperationHandler - 文件新增/删除处理

**职责**: 处理 webRequest API 拦截的文件操作

**核心方法**:
```typescript
class FileOperationHandler {
  handleMirrorRequest(request: MirrorRequest): Promise<void>;
  handleFileCreate(projectId: string, fileInfo: FileInfo): Promise<void>;
  handleFileDelete(projectId: string, filePath: string): Promise<void>;
  handleFolderCreate(projectId: string, folderPath: string): Promise<void>;
  handleFolderDelete(projectId: string, folderPath: string): Promise<void>;
}
```

**处理流程**:
```typescript
async handleMirrorRequest(request: MirrorRequest): Promise<void> {
  const { projectId, method, apiEndpoint, body } = request;

  const match = apiEndpoint.match(/\/project\/([^\/]+)\/(.+)/);
  if (!match) return;

  const [, _projectId, action] = match;

  switch (method) {
    case 'POST':
      if (action === 'doc') {
        await this.handleFileCreate(projectId, body);
      } else if (action === 'folder') {
        await this.handleFolderCreate(projectId, body.folder_path);
      }
      break;

    case 'DELETE':
      if (action.startsWith('doc/')) {
        const docId = action.split('/')[1];
        await this.handleFileDelete(projectId, docId);
      }
      break;
  }
}
```

**文件创建**:
```typescript
async handleFileCreate(projectId: string, fileInfo: FileInfo): Promise<void> {
  const isBinary = this.isBinaryFile(fileInfo.name);

  if (isBinary && !this.projectConfig.syncBinaryFiles) {
    return;
  }

  let content: string | Buffer;
  if (fileInfo._id) {
    content = await this.apiClient.getDocContent(projectId, fileInfo._id);
  } else {
    content = await this.apiClient.getFileContent(projectId, fileInfo.path);
  }

  const localPath = join(this.projectConfig.localPath, fileInfo.path);
  await this.fileManager.createFile(localPath, content.toString());
}
```

---

### 3.6 FileListSyncScheduler - 定期文件列表校验

**职责**: 定期同步完整文件列表，检测并修正差异

**核心方法**:
```typescript
class FileListSyncScheduler {
  start(intervalMs: number = 300000): void;
  stop(): void;
  syncOnce(): Promise<SyncResult>;

  private compareFileLists(
    remoteFiles: ProjectFile[],
    localFiles: string[]
  ): Promise<SyncDiff>;

  private syncMissingFiles(files: ProjectFile[]): Promise<void>;
  private handleExtraFiles(files: string[]): Promise<void>;
}
```

**差异检测**:
```typescript
interface SyncDiff {
  missingInLocal: ProjectFile[];    // 远程有，本地没有
  extraInLocal: string[];           // 本地有，远程没有
  mismatched: ProjectFile[];        // 版本不匹配
}

private async compareFileLists(
  remoteFiles: ProjectFile[],
  localFiles: string[]
): Promise<SyncDiff> {
  const diff: SyncDiff = {
    missingInLocal: [],
    extraInLocal: [],
    mismatched: []
  };

  const localSet = new Set(localFiles);

  for (const remoteFile of remoteFiles) {
    if (remoteFile.type === 'folder') continue;

    const relativePath = remoteFile.path;

    if (!localSet.has(relativePath)) {
      diff.missingInLocal.push(remoteFile);
    } else {
      const localPath = join(this.projectConfig.localPath, relativePath);
      const localStats = await fs.stat(localPath);
      const remoteMtime = new Date(remoteFile.updated).getTime();

      if (remoteMtime > localStats.mtimeMs) {
        diff.mismatched.push(remoteFile);
      }

      localSet.delete(relativePath);
    }
  }

  diff.extraInLocal = Array.from(localSet);
  return diff;
}
```

---

### 3.7 错误处理

**错误类型**:
```typescript
enum MirrorErrorType {
  // API 相关
  API_AUTH_FAILED = 'API_AUTH_FAILED',
  API_NETWORK_ERROR = 'API_NETWORK_ERROR',
  API_RATE_LIMIT = 'API_RATE_LIMIT',

  // 文件系统相关
  FS_PATH_NOT_FOUND = 'FS_PATH_NOT_FOUND',
  FS_PERMISSION_DENIED = 'FS_PERMISSION_DENIED',
  FS_DISK_FULL = 'FS_DISK_FULL',

  // 同步相关
  SYNC_CONFLICT = 'SYNC_CONFLICT',
  SYNC_INVALID_OP = 'SYNC_INVALID_OP',

  // 配置相关
  CONFIG_INVALID_PATH = 'CONFIG_INVALID_PATH',
  CONFIG_NOT_FOUND = 'CONFIG_NOT_FOUND',
}

class MirrorError extends Error {
  constructor(
    public type: MirrorErrorType,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'MirrorError';
  }
}
```

**错误处理策略**:
- API 错误：区分认证失败、网络错误、频率限制
- 文件系统错误：区分路径不存在、权限不足、磁盘满
- 同步错误：标记需要完全重新同步
- 所有错误记录到日志，必要时通知用户

---

## 4. 实现优先级

### 阶段 1：核心基础设施（最高优先级）

1. **ProjectConfigStore 实现**
   - 配置文件读写
   - 默认路径生成
   - 跨平台路径处理

2. **MirrorServer 集成**
   - 在 handleEditMonitor 中集成 TextFileSyncManager
   - 在 handleMirrorRequest 中集成 FileOperationHandler
   - Cookie 管理和存储

### 阶段 2：文本文件同步（核心功能）

3. **OverleafAPIClient 基础方法**
   - getDocContent()
   - getProjectFiles()
   - Cookie 认证

4. **TextFileSyncManager 实现**
   - initialSync() - 首次获取完整内容
   - applyOps() - 应用 OT 操作
   - handleEditEvent() - 主处理流程

### 阶段 3：文件操作处理

5. **FileOperationHandler 实现**
   - handleFileCreate()
   - handleFileDelete()
   - handleFolderCreate/Delete()
   - API 端点解析

### 阶段 4：增强功能

6. **TextFileSyncManager 增强**
   - 定期校验机制
   - OT 操作错误恢复
   - 文档状态缓存

7. **BinaryFileSyncManager 实现**
   - 定期轮询
   - 版本比较
   - 文件下载

### 阶段 5：完整同步

8. **FileListSyncScheduler 实现**
   - 文件列表对比
   - 差异检测
   - 多余文件处理

9. **错误处理完善**
   - 统一错误类型
   - 重试机制
   - 用户通知

### 阶段 6：测试和文档

10. **单元测试**
    - ConfigStore 测试
    - OT 操作测试
    - API 客户端测试

11. **集成测试**
    - 完整同步流程
    - 错误场景

12. **文档更新**
    - 使用指南
    - API 文档

---

## 5. 测试策略

### 单元测试

```typescript
// tests/unit/text-file-sync.test.ts
describe('TextFileSyncManager', () => {
  it('should apply insert operation correctly', async () => {
    const manager = new TextFileSyncManager(config, apiClient, fileManager);
    await manager.applyOps('test.tex', [{ p: 5, i: 'hello' }]);

    const content = await fileManager.readFile('test.tex');
    expect(content).toContain('hello');
  });

  it('should apply delete operation correctly', async () => {
    // 测试删除操作
  });

  it('should handle multiple operations in order', async () => {
    // 测试多个操作
  });

  it('should request full content on first edit', async () => {
    // 测试首次同步
  });
});
```

### 集成测试

```typescript
// tests/integration/file-sync.test.ts
describe('File Sync Integration', () => {
  it('should sync a new document from Overleaf', async () => {
    mockAPI.getDocContent.mockResolvedValue('\\documentclass{article}');

    await handleEditEvent({
      project_id: 'test-project',
      data: { doc_id: '123', doc_name: 'main.tex', ops: [] }
    });

    const content = await fs.readFile('/tmp/mirror/main.tex', 'utf-8');
    expect(content).toBe('\\documentclass{article}');
  });
});
```

### 手动测试场景

#### 场景 1：首次使用
1. 打开新的 Overleaf 项目
2. 在编辑器中输入内容
3. 检查本地是否创建了文件

#### 场景 2：实时编辑同步
1. 打开已有项目
2. 修改本地文件
3. 在 Overleaf 中编辑
4. 验证 OT 操作正确应用

#### 场景 3：文件操作
1. 在 Overleaf 中创建新文件
2. 验证本地文件创建
3. 在 Overleaf 中删除文件
4. 验证本地文件删除

#### 场景 4：冲突检测
1. 修改本地文件
2. 修改 Overleaf 文件
3. 运行定期校验
4. 检查冲突处理

#### 场景 5：二进制文件
1. 上传 PDF 到 Overleaf
2. 等待轮询周期
3. 验证 PDF 下载到本地

---

## 6. 技术约束和注意事项

### 6.1 Overleaf Session Cookie

**问题**: Mirror Server 需要用户的 Overleaf session 才能调用 API

**解决方案**:
1. 浏览器扩展通过 chrome.cookies API 读取 cookie
2. 在建立 WebSocket 连接时发送给 Mirror Server
3. Mirror Server 存储到 Map 并在 API 调用时使用

```typescript
// 扩展端
chrome.cookies.get({
  url: 'https://cn.overleaf.com',
  name: 'overleaf_session2'
}, (cookie) => {
  mirrorClient.send({
    type: 'connect',
    project_id: projectId,
    cookies: { overleaf_session2: cookie.value }
  });
});
```

### 6.2 CORS 限制

Overleaf API 可能不允许跨域请求。

**解决方案**: Mirror Server 作为后端，不受 CORS 限制。

### 6.3 文件编码

**问题**: Windows 系统可能使用 GBK 编码

**解决方案**: 统一使用 UTF-8 编码。

---

## 7. 未来扩展

### 7.1 浏览器扩展集成

- 添加项目设置界面
- 用户可选择本地存储路径
- 显示同步状态和进度
- 错误通知和日志查看

### 7.2 双向同步

- FileWatcher 检测本地文件变化
- 调用 Overleaf API 更新远程文件
- 冲突检测和解决策略

### 7.3 离线支持

- 本地缓存完整文档内容
- 离线编辑队列
- 联网后批量同步

### 7.4 多项目支持

- 同时监听多个 Overleaf 项目
- 独立的配置和状态管理
- 全局同步状态概览

---

## 8. 文件结构

```
packages/mirror-server/src/
├── config/
│   ├── store.ts              # ProjectConfigStore
│   └── types.ts              # 配置类型定义
├── sync/
│   ├── text-file-sync.ts     # TextFileSyncManager
│   ├── binary-file-sync.ts   # BinaryFileSyncManager
│   └── file-list-sync.ts     # FileListSyncScheduler
├── api/
│   ├── overleaf-client.ts    # OverleafAPIClient
│   └── types.ts              # API 类型定义
├── handlers/
│   ├── file-operation.ts     # FileOperationHandler
│   ├── edit-monitor.ts       # (已存在，需修改)
│   └── index.ts
├── filesystem/
│   ├── manager.ts            # (已存在)
│   ├── filter.ts             # (已存在)
│   └── watcher.ts            # (已存在)
├── errors/
│   ├── types.ts              # 错误类型定义
│   └── handler.ts            # 错误处理
├── utils/
│   ├── logger.ts             # 日志系统
│   └── path.ts               # 路径工具
├── server.ts                 # (已存在，需修改)
└── index.ts
```

---

## 9. 依赖项

```json
{
  "dependencies": {
    "ws": "^8.0.0",
    "fs-extra": "^11.0.0",
    "chokidar": "^3.5.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.0.0",
    "@types/fs-extra": "^11.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## 10. 总结

本设计定义了 Mirror Server 从日志输出到真实文件系统操作的完整实现方案。

**核心特性**:
- ✅ 完整镜像（所有文件类型）
- ✅ 用户自定义路径（每个项目独立配置）
- ✅ 持久化配置（project_id → localPath 映射）
- ✅ 混合同步策略（首次完整 + OT 增量 + 定期校验）
- ✅ 跨平台支持（Windows/macOS/Linux）
- ✅ 二进制文件可配置

**下一步**: 调用 writing-plans skill 创建详细实施计划。

---

**文档版本**: 1.0
**最后更新**: 2026-03-07
