# Edit Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 Overleaf 编辑操作的实时监测功能，捕获用户的编辑事件（增量 OT 操作）并在浏览器控制台和 Mirror Server 打印详细日志。

**Architecture:** Content Script 监听 Overleaf 的 `doc:changed` 自定义事件，从 `window.editor.sharejs_docs` 提取文档信息和 OT 操作，通过 WebSocket 发送到 Mirror Server，服务器格式化打印日志。

**Tech Stack:** TypeScript, Chrome Extension (Manifest V3), WebSocket (Socket.IO client), Overleaf ShareJS API

---

## Prerequisites

**Before starting:**
1. 阅读设计文档: `docs/plans/2026-03-06-edit-monitor-design.md`
2. 了解 Overleaf 项目结构: 已有 `packages/extension/` 和 `packages/mirror-server/`
3. 已有 WebSocket 连接: `MirrorClient` 类在 `packages/extension/src/client.ts`
4. 已有类型定义: `packages/shared/src/types.ts`

**Required skills:**
- Chrome Extension API
- TypeScript 类型系统
- Event handling
- WebSocket communication

---

## Task 1: 添加共享类型定义

**Files:**
- Modify: `packages/shared/src/types.ts`

**Step 1: 添加 OT 操作类型**

在文件末尾添加以下类型定义：

```typescript
// OT 操作类型
export type AnyOperation = InsertOperation | DeleteOperation | RetainOperation;

export interface InsertOperation {
  i: string;  // 插入的文本
  p: number;  // 位置
}

export interface DeleteOperation {
  d: string;  // 删除的文本
  p: number;  // 位置
}

export interface RetainOperation {
  p: number;  // 光标移动位置
}
```

**Step 2: 添加编辑事件消息类型**

```typescript
// 编辑事件消息（通过 WebSocket 发送）
export interface EditEventMessage {
  type: 'edit_event';
  project_id: string;
  data: EditEventData;
}

export interface EditEventData {
  doc_id: string;
  doc_name?: string;
  version: number;
  ops: AnyOperation[];
  meta?: {
    user_id: string;
    source: string;        // 'local' | 'remote'
    timestamp: number;
  };
}
```

**Step 3: 添加文件扩展名白名单**

```typescript
// 文本文件扩展名白名单
export const TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  // LaTeX 相关
  '.tex', '.bib', '.cls', '.sty', '.def', '.bst',
  // 文本文件
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml',
  // 代码文件
  '.js', '.ts', '.jsx', '.tsx', '.py', '.c', '.cpp', '.h', '.java',
  // 配置文件
  '.cfg', '.conf', '.ini'
]);
```

**Step 4: 导出新增类型**

确保文件末尾的 export 语句包含所有新类型（如果有统一的 export 语句）。

**Step 5: 构建验证**

```bash
cd packages/shared
npm run build
```

Expected: 编译成功，无类型错误。

**Step 6: 提交**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add OT operation types and edit event message types"
```

---

## Task 2: 创建 EditMonitor 类（Content Script）

**Files:**
- Create: `packages/extension/src/content/edit-monitor.ts`

**Step 1: 创建文件基础结构**

```typescript
import { EditEventData, TEXT_FILE_EXTENSIONS } from '@overleaf-cc/shared';
import { MirrorClient } from '../client';

export class EditMonitor {
  private projectId: string;
  private mirrorClient: MirrorClient;
  private monitoring = false;
  private lastEditTime = 0;
  private readonly THROTTLE_MS = 100;

  constructor(projectId: string, mirrorClient: MirrorClient) {
    this.projectId = projectId;
    this.mirrorClient = mirrorClient;
  }

  start(): void {
    if (this.monitoring) return;
    this.monitoring = true;

    // 监听 Overleaf 的 doc:changed 事件
    window.addEventListener('doc:changed', this.handleDocChanged);

    console.log('[EditMonitor] Started monitoring document edits');
  }

  stop(): void {
    if (!this.monitoring) return;
    this.monitoring = false;

    window.removeEventListener('doc:changed', this.handleDocChanged);

    console.log('[EditMonitor] Stopped monitoring');
  }

  private handleDocChanged = (event: Event): void => {
    // 节流：100ms 内的重复触发只处理一次
    const now = Date.now();
    if (now - this.lastEditTime < this.THROTTLE_MS) {
      return;
    }
    this.lastEditTime = now;

    const customEvent = event as CustomEvent<{ id: string }>;
    const docId = customEvent.detail.id;

    // 获取文档对象
    const doc = this.getShareJsDoc(docId);
    if (!doc) {
      console.warn(`[EditMonitor] Document ${docId} not found`);
      return;
    }

    // 提取文档信息
    const docInfo = this.extractDocInfo(docId, doc);
    if (!docInfo) return;

    // 发送到 mirror server
    this.sendEditEvent(docInfo);
  }

  private getShareJsDoc(docId: string): any {
    const editor = (window as any).editor;
    if (!editor || !editor.sharejs_docs) {
      return null;
    }
    return editor.sharejs_docs[docId];
  }

  private extractDocInfo(docId: string, doc: any): EditEventData | null {
    try {
      // 1. 检查文档对象是否有效
      if (!doc || typeof doc.getVersion !== 'function') {
        console.warn(`[EditMonitor] Invalid doc object for ${docId}`);
        return null;
      }

      // 2. 获取版本号
      const version = doc.getVersion();
      if (typeof version !== 'number' || version < 0) {
        console.warn(`[EditMonitor] Invalid version: ${version}`);
        return null;
      }

      // 3. 获取文档名称
      const docName = this.getDocName(docId);

      // 4. 过滤文件扩展名
      const extension = this.getExtension(docName);
      if (!TEXT_FILE_EXTENSIONS.has(extension)) {
        // 静默跳过，不打印日志
        return null;
      }

      // 5. 获取 ops
      const ops = doc.getPendingOp() || doc.getInflightOp() || [];
      if (!Array.isArray(ops)) {
        console.warn(`[EditMonitor] Invalid ops for ${docId}`);
        return null;
      }

      return {
        doc_id: docId,
        doc_name: docName,
        version,
        ops,
        meta: {
          user_id: this.getCurrentUserId(),
          source: 'local',
          timestamp: Date.now()
        }
      };
    } catch (error) {
      console.error(`[EditMonitor] Error extracting doc info for ${docId}:`, error);
      return null;
    }
  }

  private getDocName(docId: string): string {
    const editor = (window as any).editor;
    const docs = editor?.docs;
    return docs?.[docId]?.name || `unknown-${docId}`;
  }

  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }

  private getCurrentUserId(): string {
    const editor = (window as any).editor;
    return editor?.user?.id || 'unknown';
  }

  private sendEditEvent(data: EditEventData): void {
    const message = {
      type: 'edit_event' as const,
      project_id: this.projectId,
      data
    };

    console.log('[EditMonitor] Sending edit event:', message);

    // 通过 WebSocket 发送到 mirror server
    this.mirrorClient.send(message);
  }
}
```

**Step 2: 构建验证**

```bash
cd packages/extension
npm run build
```

Expected: 编译成功。

**Step 3: 提交**

```bash
git add packages/extension/src/content/edit-monitor.ts
git commit -m "feat(extension): add EditMonitor class for tracking document edits"
```

---

## Task 3: 在 Content Script 中集成 EditMonitor

**Files:**
- Modify: `packages/extension/src/content/injector.ts`

**Step 1: 添加 EditMonitor 导入**

在文件顶部添加：

```typescript
import { EditMonitor } from './edit-monitor';
```

**Step 2: 声明 editMonitor 变量**

在 `mirrorClient` 声明后添加：

```typescript
let editMonitor: EditMonitor | null = null;
```

**Step 3: 在 initializeMirror() 中启动监测**

修改 `initializeMirror()` 函数：

```typescript
async function initializeMirror(): Promise<void> {
  try {
    console.log('[Mirror] Initializing WebSocket connection...');

    mirrorClient = new MirrorClient();
    await mirrorClient.connect();

    // 新增：启动编辑监测
    if (projectId) {
      editMonitor = new EditMonitor(projectId, mirrorClient);
      editMonitor.start();
    }

    console.log('[Mirror] Initialization complete');
  } catch (error) {
    console.error('[Mirror] Initialization failed:', error);
  }
}
```

**Step 4: 在 beforeunload 中清理**

修改 `beforeunload` 事件监听器：

```typescript
window.addEventListener('beforeunload', () => {
  if (editMonitor) {
    editMonitor.stop();
  }
  if (mirrorClient) {
    mirrorClient.disconnect();
  }
});
```

**Step 5: 构建验证**

```bash
cd packages/extension
npm run build
```

Expected: 编译成功，dist/content.js 更新。

**Step 6: 提交**

```bash
git add packages/extension/src/content/injector.ts packages/extension/dist/
git commit -m "feat(extension): integrate EditMonitor into content script"
```

---

## Task 4: 创建 Mirror Server 处理器

**Files:**
- Create: `packages/mirror-server/src/handlers/edit-monitor.ts`
- Create: `packages/mirror-server/src/handlers/index.ts` (导出所有处理器)

**Step 1: 创建 edit-monitor.ts**

```typescript
import { EditEventMessage, AnyOperation } from '@overleaf-cc/shared';

export function handleEditMonitor(message: EditEventMessage): void {
  const { project_id, data } = message;
  const { doc_id, doc_name, version, ops, meta } = data;

  console.log('\n' + '='.repeat(60));
  console.log('[EditMonitor] Document edited:', doc_name || doc_id);
  console.log('  Project ID:', project_id);
  console.log('  Doc ID:', doc_id);
  console.log('  Version:', version);

  if (meta) {
    console.log('  Source:', meta.source);
    console.log('  User ID:', meta.user_id);
    console.log('  Time:', new Date(meta.timestamp).toLocaleString('zh-CN'));
  }

  console.log('\n  Operations:');
  if (ops.length === 0) {
    console.log('    (no operations)');
  } else {
    ops.forEach((op: AnyOperation, index: number) => {
      if ('i' in op) {
        console.log(`    ${index + 1}. Insert "${op.i}" at position ${op.p}`);
      } else if ('d' in op) {
        console.log(`    ${index + 1}. Delete "${op.d}" at position ${op.p}`);
      } else if ('p' in op) {
        console.log(`    ${index + 1}. Retain/Cursor to position ${op.p}`);
      }
    });
  }

  console.log('='.repeat(60) + '\n');
}

// 格式化 ops 为更易读的格式（用于调试）
export function formatOps(ops: AnyOperation[]): string {
  return ops.map(op => {
    if ('i' in op) return `+${JSON.stringify(op.i)}@${op.p}`;
    if ('d' in op) return `-${JSON.stringify(op.d)}@${op.p}`;
    if ('p' in op) return `→${op.p}`;
    return JSON.stringify(op);
  }).join(', ');
}
```

**Step 2: 创建 handlers/index.ts**

```typescript
export { handleEditMonitor, formatOps } from './edit-monitor';
```

**Step 3: 构建验证**

```bash
cd packages/mirror-server
npm run build
```

Expected: 编译成功。

**Step 4: 提交**

```bash
git add packages/mirror-server/src/handlers/
git commit -m "feat(mirror-server): add edit monitor handler with formatted logging"
```

---

## Task 5: 在 Mirror Server 中集成处理器

**Files:**
- Modify: `packages/mirror-server/src/server.ts`
- Modify: `packages/mirror-server/src/types.ts`

**Step 1: 更新 types.ts**

在 `WSMessage` 类型定义中添加 `EditEventMessage`：

```typescript
import { EditEventMessage } from '@overleaf-cc/shared';

export type WSMessage =
  | MirrorRequestMessage
  | SyncCommandMessage
  | AckMessage
  | EditEventMessage;  // 新增
```

**Step 2: 在 server.ts 中导入处理器**

在文件顶部添加：

```typescript
import { handleEditMonitor } from './handlers/edit-monitor';
```

**Step 3: 在 handleMessage() 中添加 case**

在 `handleMessage()` 方法的 switch 语句中添加：

```typescript
private handleMessage(connection: ClientConnection, message: WSMessage): void {
  switch (message.type) {
    case 'mirror':
      console.log('Received mirror request:', message.api_endpoint);
      // 现有的 mirror 处理逻辑
      break;

    case 'edit_event':  // 新增
      handleEditMonitor(message as EditEventMessage);
      break;

    case 'sync':
      console.log('Received sync command:', message.operation);
      // 现有的 sync 处理逻辑
      break;

    default:
      console.warn('Unknown message type:', (message as any).type);
  }
}
```

**Step 4: 构建验证**

```bash
cd packages/mirror-server
npm run build
```

Expected: 编译成功。

**Step 5: 提交**

```bash
git add packages/mirror-server/src/server.ts packages/mirror-server/src/types.ts packages/mirror-server/dist/
git commit -m "feat(mirror-server): integrate edit monitor handler into message router"
```

---

## Task 6: 扩展支持 - 在 MirrorClient 中添加 send() 方法

**Files:**
- Check: `packages/extension/src/client.ts`

**Step 1: 检查 MirrorClient 是否有 send() 方法**

```bash
grep -n "send(" packages/extension/src/client.ts
```

If exists: 跳到 Step 3
If not exists: 继续 Step 2

**Step 2: 如果没有，添加 send() 方法**

```typescript
send(message: any): void {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
    console.warn('[MirrorClient] Cannot send message: WebSocket not connected');
    return;
  }

  this.ws.send(JSON.stringify(message));
}
```

**Step 3: 如果已有，确认签名是否兼容**

确保 `send()` 方法接受任意类型的消息对象。

**Step 4: 构建验证**

```bash
cd packages/extension
npm run build
```

**Step 5: 提交（如果有修改）**

```bash
git add packages/extension/src/client.ts
git commit -m "feat(extension): ensure MirrorClient has send() method"
```

---

## Task 7: 端到端测试

**Files:**
- Test: Manual testing in browser

**Step 1: 启动 Mirror Server**

```bash
cd packages/mirror-server
npm run build
node dist/cli.js start
```

Expected output:
```
Starting Overleaf Mirror Server...
Mirror server listening on port 3456
```

**Step 2: 构建扩展**

```bash
cd packages/extension
npm run build
```

Expected:
```
dist/content.js created
dist/background.js created
```

**Step 3: 加载扩展到 Chrome**

1. 打开 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `packages/extension/` 目录

Expected: 扩展加载成功，无错误。

**Step 4: 打开 Overleaf 项目**

访问: `https://cn.overleaf.com/project/xxxxx`

**Step 5: 打开浏览器控制台**

按 F12 → Console

Expected logs:
```
[Mirror] Project ID: xxxxx
[Mirror] Project ID sent to background script
[Mirror] Initializing WebSocket connection...
[MirrorClient] Connected to server
[Mirror] Initialization complete
[EditMonitor] Started monitoring document edits
```

**Step 6: 测试编辑监测**

1. 在 Overleaf 编辑器中打开一个 `.tex` 文件
2. 输入一些文本，例如 "Hello World"

Expected browser console:
```
[EditMonitor] Sending edit event: {
  type: 'edit_event',
  project_id: 'xxxxx',
  data: { ... }
}
```

Expected server terminal:
```
============================================================
[EditMonitor] Document edited: main.tex
  Project ID: xxxxx
  Doc ID: yyyyy
  Version: 123
  Source: local
  User ID: zzzzz
  Time: 2026-03-06 10:30:15

  Operations:
    1. Insert "H" at position 0
    2. Insert "e" at position 1
    ...
============================================================
```

**Step 7: 测试文件过滤**

1. 创建一个 `.pdf` 文件
2. 查看是否有日志

Expected: 无日志（PDF 被过滤）

3. 编辑 `.bib` 文件
4. 查看是否有日志

Expected: 有日志（.bib 在白名单中）

**Step 8: 测试节流**

1. 快速连续输入大量文本
2. 查看日志数量

Expected: 日志数量少于输入次数（节流生效）

**Step 9: 测试错误处理**

1. 停止 Mirror Server (Ctrl+C)
2. 在 Overleaf 中编辑
3. 重启 Mirror Server

Expected:
- 停止时：扩展优雅处理错误
- 重启后：扩展自动重连，监测恢复

**Step 10: 测试文档关闭**

1. 关闭当前文档
2. 查看控制台

Expected:
```
[EditMonitor] Stopped monitoring
```

---

## Task 8: 更新文档

**Files:**
- Modify: `docs/PROGRESS-REPORT.md`

**Step 1: 更新进度报告**

在 Phase 4 的完成任务中添加：

```markdown
### 4. Browser Extension 核心逻辑（54%）← 从 27% 更新

#### 4.1 ✅ 已实现

- [x] 项目 ID 提取
- [x] WebSocket 连接
- [x] API 拦截（webRequest API）
- [x] 消息传递（content ↔ background）
- [x] **编辑操作监测（EditMonitor）** ← 新增

#### 4.2 ❌ 未实现

- [ ] 反向同步（本地 → Overleaf）
- [ ] 冲突提示 UI
- [ ] 同步状态指示器
```

**Step 2: 添加新功能说明**

在"已完成的核心功能"部分添加：

```markdown
### 3. 编辑操作监测（100%）

**实现方式**: Content Script 监听 Overleaf 的 `doc:changed` 事件

**监测内容**:
- 文档 ID 和名称
- 版本号变化
- 增量 OT 操作（插入/删除/光标移动）
- 操作来源（本地/远程）
- 时间戳和用户 ID

**文件过滤**: 只监听文本文件（.tex, .bib, .cls, .js, .py 等）

**日志输出**:
- 浏览器控制台：发送前的完整事件对象
- Mirror Server：格式化的易读日志
```

**Step 3: 提交文档更新**

```bash
git add docs/PROGRESS-REPORT.md
git commit -m "docs: update progress report - edit monitoring feature completed"
```

---

## Task 9: 创建快速测试指南

**Files:**
- Create: `docs/quick-test-edit-monitor.md`

**Step 1: 创建测试文档**

```markdown
# Edit Monitor 快速测试指南

## 准备工作

1. 启动 Mirror Server
2. 构建并加载 Chrome 扩展
3. 打开 Overleaf 项目

## 测试场景

### 1. 基础编辑监测

**操作**: 在 .tex 文件中输入 "Hello World"

**预期结果**:
- 浏览器控制台: `[EditMonitor] Sending edit event: ...`
- Server 终端: 格式化的编辑日志

### 2. 文件过滤

**操作**:
- 编辑 .tex 文件 → 应该记录
- 编辑 .pdf 文件 → 不应该记录
- 编辑 .bib 文件 → 应该记录

### 3. 节流效果

**操作**: 快速连续输入

**预期结果**: 日志数量少于输入次数

### 4. 错误恢复

**操作**:
- 停止 Server → 编辑 → 重启 Server

**预期结果**: 自动恢复监测

## 日志示例

```
============================================================
[EditMonitor] Document edited: main.tex
  Project ID: 69a6f132d255a33e681501a5
  Doc ID: 6123456789abcdef0123456
  Version: 123
  Source: local
  User ID: 5f6d7e8f9a0b1c2d3e4f5a6b
  Time: 2026-03-06 10:30:15

  Operations:
    1. Insert "Hello World" at position 0
============================================================
```
```

**Step 2: 提交文档**

```bash
git add docs/quick-test-edit-monitor.md
git commit -m "docs: add quick test guide for edit monitor feature"
```

---

## Task 10: 最终验证和清理

**Step 1: 完整构建测试**

```bash
# 在项目根目录
npm install
npm run build
```

Expected: 所有包编译成功，无错误。

**Step 2: 类型检查**

```bash
cd packages/shared
npm run typecheck

cd ../extension
npm run typecheck

cd ../mirror-server
npm run typecheck
```

Expected: 无类型错误。

**Step 3: 代码格式化检查**

```bash
npm run format:check
```

If fails:
```bash
npm run format
```

**Step 4: 最终提交**

```bash
git add .
git commit -m "feat: complete edit monitor implementation

- Add OT operation types and edit event message types
- Create EditMonitor class with throttling and file filtering
- Integrate EditMonitor into content script
- Add server-side handler with formatted logging
- Add comprehensive testing guide
- Update progress report

Tested: Manual testing in Chrome Extension

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

**Step 5: 创建标签（可选）**

```bash
git tag -a v0.2.0 -m "Edit Monitor Feature"
git push origin v0.2.0
```

---

## Success Criteria

实现完成后，应该满足：

✅ Content Script 成功监听 `doc:changed` 事件
✅ 正确提取文档信息（ID、名称、版本、ops）
✅ 文件扩展名过滤正常工作
✅ 节流机制生效（100ms 窗口）
✅ WebSocket 消息正确发送到 Mirror Server
✅ Mirror Server 格式化打印日志
✅ 错误处理优雅（无崩溃）
✅ 支持重连和恢复
✅ 代码类型安全（TypeScript）
✅ 所有测试场景通过

---

## Known Limitations

当前实现已知限制：

1. **只监测本地编辑**: 无法直接区分远程协作者的编辑（可通过 `meta.source` 过滤）
2. **无持久化**: 日志只在控制台打印，未保存到文件
3. **无 UI**: 没有可视化界面展示编辑历史
4. **依赖 Overleaf 内部 API**: 如果 Overleaf 更新 `window.editor` 结构，可能需要适配

## Future Enhancements

下一步改进方向：

1. **升级到方案 C**: 使用 Socket.IO hook 监听 `applyOtUpdate`
2. **持久化日志**: 保存编辑历史到本地文件
3. **可视化 UI**: 展示编辑时间线和统计信息
4. **双向同步**: 使用监测到的 ops 实现本地 → Overleaf 同步
5. **冲突检测**: 基于版本号和 ops 检测冲突

---

**计划版本**: 1.0
**最后更新**: 2026-03-06
**预计完成时间**: 1-2 小时（包含测试）
