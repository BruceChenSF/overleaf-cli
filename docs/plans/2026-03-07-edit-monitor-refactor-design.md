# EditMonitor 重构设计文档（CodeMirror 6 Transaction 监听）

**Date**: 2026-03-07
**Status**: Approved
**Author**: Claude (with user requirements)
**Target**: Overleaf 新编辑器（CodeMirror 6）

---

## Overview

重构 EditMonitor，使其专门针对 Overleaf 的新编辑器（CodeMirror 6），通过监听 `transaction` 事件精确捕获用户的编辑操作，提取完整的 OT 操作数据并发送到 Mirror Server。

**核心改进：**
- ✅ 精确的 OT 操作捕获（通过 transaction.changes）
- ✅ 实时监听，无延迟
- ✅ 支持本地/远程操作区分
- ✅ 完善的错误处理和降级策略
- ✅ 模块化架构，易于测试和维护

**关键发现：** Overleaf 已迁移到 CodeMirror 6，EditorView 实例可通过 `document.querySelector('.cm-content').cmView.view` 访问。

---

## Architecture

### 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Overleaf Page (CodeMirror 6)             │
│                                                              │
│  .cm-editor                                                  │
│    └── .cm-content.cmView.view → EditorView 实例            │
│            │                                                 │
│            ├── EditorState                                   │
│            │   └── updateListener (我们的监听器)              │
│            │                                                 │
│            └── Transaction (编辑事务)                        │
│                └── changes (变更集合)                        │
│                    ├── [{from, to, insert}]  (插入)         │
│                    └── [{from, to}]          (删除)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              EditMonitor (Content Script)                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  1. CodeMirror 6 Detector                            │  │
│  │     - MutationObserver 监听 .cm-content 创建          │  │
│  │     - 从 .cmView.view 获取 EditorView                │  │
│  │     - 验证实例有效性                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  2. Transaction Listener                             │  │
│  │     - 注册 StateField.updateListener                  │  │
│  │     - 捕获每次编辑的 transaction                      │  │
│  │     - 提取 transaction.changes                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  3. OT Converter                                      │  │
│  │     - CodeMirror changes → ShareJS ops               │  │
│  │     - 过滤纯光标移动                                   │  │
│  │     - 区分本地/远程操作                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  4. Event Sender                                      │  │
│  │     - 构造 EditEventData                              │  │
│  │     - 通过 MirrorClient.send() 发送                   │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                  Mirror Server                              │
│              handleEditMonitor()                            │
│              - 格式化日志输出                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. EditMonitor 类（主控制器）

**File**: `packages/extension/src/content/edit-monitor.ts`

**Class Interface:**
```typescript
class EditMonitor {
  private projectId: string;
  private mirrorClient: MirrorClient;
  private monitoring = false;
  private editorView: EditorView | null = null;
  private mutationObserver: MutationObserver | null = null;
  private readonly DETECTION_TIMEOUT = 5000; // 5秒超时
  private readonly DETECTION_RETRY_INTERVAL = 500; // 500ms重试间隔

  constructor(projectId: string, mirrorClient: MirrorClient)

  // 生命周期管理
  start(): Promise<void>
  stop(): void

  // EditorView 检测
  private detectEditorView(): Promise<EditorView | null>
  private waitForEditorView(): Promise<EditorView | null>
  private validateEditorView(view: any): boolean

  // 事件监听
  private setupTransactionListener(): void
  private handleTransaction(transaction: Transaction): void
  private getTransactionSource(transaction: Transaction): 'local' | 'remote'

  // OT 转换
  private convertChangesToOps(
    changes: ChangeSet<ChangeDesc>,
    startState: EditorState
  ): AnyOperation[]

  // 发送
  private sendEditEvent(ops: AnyOperation[], source: string): void
}
```

**关键设计决策：**
- `start()` 返回 `Promise<void>`，因为 EditorView 检测是异步的
- 超时机制：如果 5 秒内未检测到 EditorView，返回失败但不阻塞
- 清理机制：`stop()` 时移除 MutationObserver 和事件监听器

### 2. CodeMirror 6 检测器

**职责：** 检测和获取 CodeMirror 6 的 EditorView 实例

**实现方式：**
```typescript
private detectEditorView(): Promise<EditorView | null> {
  return new Promise((resolve) => {
    // 1. 立即检查
    const immediateView = this.findEditorViewImmediate();
    if (immediateView) {
      resolve(immediateView);
      return;
    }

    // 2. MutationObserver
    const observer = new MutationObserver(() => {
      const view = this.findEditorViewImmediate();
      if (view) {
        observer.disconnect();
        resolve(view);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 3. 超时
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, this.DETECTION_TIMEOUT);
  });
}

private findEditorViewImmediate(): EditorView | null {
  // 用户验证的路径
  const cmContent = document.querySelector('.cm-content');
  const view = cmContent?.cmView?.view;

  if (view && this.validateEditorView(view)) {
    return view;
  }

  // 备用路径
  const cmEditor = document.querySelector('.cm-editor');
  const altView = cmEditor?.__cm_view || cmEditor?.cmView;

  if (altView && this.validateEditorView(altView)) {
    return altView;
  }

  return null;
}

private validateEditorView(view: any): boolean {
  return (
    view &&
    typeof view.state === 'object' &&
    typeof view.dispatch === 'function' &&
    typeof view.state.doc === 'object' &&
    typeof view.state.doc.toString === 'function'
  );
}
```

### 3. Transaction 监听器

**职责：** 监听 CodeMirror 6 的编辑事务并提取变更

**实现方式：**
```typescript
private setupTransactionListener(): void {
  if (!this.editorView) return;

  // 方案：通过重新配置 EditorState 注入监听器
  // 或者在 EditorView 初始化时注入

  // 这里需要根据实际的 CodeMirror 6 API 调整
  // 可能需要劫持 EditorView.constructor 或使用插件系统
}

private handleTransaction(transaction: Transaction): void {
  // 1. 过滤
  if (!transaction.docChanged) return;

  // 2. 提取变更
  const changes = transaction.changes;

  // 3. 转换
  const ops = this.convertChangesToOps(changes, transaction.startState);

  // 4. 过滤空操作
  if (ops.length === 0) return;

  // 5. 判断来源
  const source = this.getTransactionSource(transaction);

  // 6. 发送
  this.sendEditEvent(ops, source);
}
```

### 4. OT 转换器（CodeMirror → ShareJS）

**职责：** 将 CodeMirror 6 的 changes 转换为 ShareJS 格式的 ops

**转换映射：**

| CodeMirror 属性 | ShareJS 属性 | 说明 |
|----------------|-------------|------|
| `transaction.changes` | `ops[]` | 变更集合 |
| `fromA, toA` | `d` (delete) | 删除范围 |
| `fromB, toB` | `i` (insert) | 插入范围 |
| `startState.sliceDoc(fromA, toA)` | `d: string` | 被删除的内容 |
| `inserted.toString()` | `i: string` | 插入的内容 |

**实现方式：**
```typescript
private convertChangesToOps(
  changes: ChangeSet<ChangeDesc>,
  startState: EditorState
): AnyOperation[] {
  const ops: AnyOperation[] = [];
  let positionOffset = 0;

  changes.iterChanges((fromA: number, toA: number, fromB: number, toB: number, inserted: Text) => {
    // 处理删除
    if (fromA < toA) {
      const deletedText = startState.sliceDoc(fromA, toA);
      ops.push({
        p: fromA + positionOffset,
        d: deletedText
      });
      positionOffset -= (toA - fromA);
    }

    // 处理插入
    if (fromB < toB) {
      const insertedText = inserted.toString();
      ops.push({
        p: fromB + positionOffset,
        i: insertedText
      });
      positionOffset += (toB - fromB);
    }
  });

  return ops;
}
```

**转换示例：**

```javascript
// 用户将 "World" 改为 "CodeMirror"
// 原文: "Hello World"

// CodeMirror changes
// fromA=6, toA=11 (删除 "World")
// fromB=6, toB=17 (插入 "CodeMirror")

// ↓ 转换为

// ShareJS ops
[
  { p: 6, d: "World" },
  { p: 6, i: "CodeMirror" }
]
```

### 5. 来源检测器（本地 vs 远程）

**职责：** 判断操作是本地用户还是远程协作者产生的

```typescript
private getTransactionSource(transaction: Transaction): 'local' | 'remote' {
  // 方法 1: 检查用户交互事件
  const hasUserEvent = transaction.isUserEvent("input") ||
                       transaction.isUserEvent("paste") ||
                       transaction.isUserEvent("delete");

  if (hasUserEvent) {
    return 'local';
  }

  // 方法 2: 检查 transaction 的 annotation
  // CodeMirror 可能标记远程操作的来源

  // 默认为远程
  return 'remote';
}
```

---

## Data Structures

### 共享类型（已存在，无需修改）

**File**: `packages/shared/src/types.ts`

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

// 编辑事件消息
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

// 文本文件扩展名白名单
export const TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.tex', '.bib', '.cls', '.sty', '.def', '.bst',
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.c', '.cpp', '.h', '.java',
  '.cfg', '.conf', '.ini'
]);
```

### 内部状态类型

```typescript
// EditMonitor 的内部状态
interface EditMonitorState {
  monitoring: boolean;
  editorView: EditorView | null;
  detectionFailed: boolean;
  listenerSetupFailed: boolean;
  lastEditTime: number;
}

// Transaction 来源
type TransactionSource = 'local' | 'remote' | 'unknown';

// EditorView 检测结果
interface EditorViewDetectionResult {
  success: boolean;
  view: EditorView | null;
  method: 'immediate' | 'mutation' | 'timeout';
  duration: number;
}
```

---

## Error Handling

### 错误处理策略

| 错误场景 | 处理方式 |
|---------|---------|
| EditorView 检测超时（5s） | 优雅降级，记录警告，不阻塞扩展 |
| MutationObserver 失败 | 立即检查失败，返回 null |
| validateEditorView 失败 | 跳过该实例，继续检测 |
| Transaction 处理异常 | 捕获异常，记录错误，跳过该 transaction |
| OT 转换失败 | 返回空 ops 数组，记录错误 |
| MirrorClient.send() 失败 | 捕获错误，记录但不影响后续操作 |
| WebSocket 断开 | 丢弃消息，等待重连 |

### 优雅降级

```typescript
async start(): Promise<void> {
  try {
    const editorView = await this.detectEditorView();

    if (!editorView) {
      console.warn('[EditMonitor] CodeMirror 6 not detected, monitor disabled');
      this.detectionFailed = true;
      return; // 不抛出错误，允许扩展继续运行
    }

    this.editorView = editorView;
    this.setupTransactionListener();
    this.monitoring = true;

    console.log('[EditMonitor] Started monitoring with CodeMirror 6');

  } catch (error) {
    console.error('[EditMonitor] Failed to start:', error);
    // 不抛出错误，不影响扩展的其他功能
  }
}
```

### 资源清理

```typescript
stop(): void {
  if (!this.monitoring) return;
  this.monitoring = false;

  // 1. 停止 MutationObserver
  if (this.mutationObserver) {
    this.mutationObserver.disconnect();
    this.mutationObserver = null;
  }

  // 2. 清理 EditorView 引用
  this.editorView = null;

  // 3. 清理状态
  this.detectionFailed = false;
  this.listenerSetupFailed = false;

  console.log('[EditMonitor] Stopped monitoring');
}
```

---

## Integration

### 集成点：Content Script

**File**: `packages/extension/src/content/injector.ts`

```typescript
import { EditMonitor } from './edit-monitor';

let editMonitor: EditMonitor | null = null;

async function initializeMirror(): Promise<void> {
  try {
    console.log('[Mirror] Initializing WebSocket connection...');

    // 1. 创建 MirrorClient
    mirrorClient = new MirrorClient();
    await mirrorClient.connect();

    // 2. 启动 EditMonitor
    if (projectId) {
      editMonitor = new EditMonitor(projectId, mirrorClient);

      try {
        await editMonitor.start();
        // 如果失败，editMonitor 会优雅降级
      } catch (error) {
        console.warn('[Mirror] EditMonitor initialization failed:', error);
      }
    }

    console.log('[Mirror] Initialization complete');
  } catch (error) {
    console.error('[Mirror] Initialization failed:', error);
  }
}

// 清理
window.addEventListener('beforeunload', () => {
  if (editMonitor) {
    editMonitor.stop();
    editMonitor = null;
  }
  if (mirrorClient) {
    mirrorClient.disconnect();
  }
});
```

**关键集成点：**
- EditMonitor 启动失败不应阻塞整个扩展
- `await editMonitor.start()` 会等待 EditorView 检测（最多 5 秒）
- 如果 EditMonitor 失败，扩展的其他功能仍然工作

---

## Testing Strategy

### 单元测试（Jest）

**File**: `packages/extension/src/content/__tests__/edit-monitor.test.ts`

```typescript
describe('EditMonitor', () => {
  describe('convertChangesToOps', () => {
    it('should convert insert operation', () => {
      const monitor = new EditMonitor('test-project', mockMirrorClient);
      const mockChanges = createMockChanges([
        { fromA: 5, toA: 5, fromB: 5, toB: 10, inserted: 'Hello' }
      ]);

      const ops = monitor['convertChangesToOps'](mockChanges, mockStartState);

      expect(ops).toEqual([{ p: 5, i: 'Hello' }]);
    });

    it('should convert delete operation', () => {
      const mockChanges = createMockChanges([
        { fromA: 5, toA: 10, fromB: 5, toB: 5, inserted: '' }
      ]);

      const ops = monitor['convertChangesToOps'](mockChanges, mockStartState);

      expect(ops).toEqual([{ p: 5, d: 'World' }]);
    });

    it('should handle multiple changes with position offset', () => {
      const mockChanges = createMockChanges([
        { fromA: 5, toA: 10, fromB: 5, toB: 5, inserted: '' },
        { fromA: 15, toA: 15, fromB: 10, toB: 17, inserted: 'CodeMirror' }
      ]);

      const ops = monitor['convertChangesToOps'](mockChanges, mockStartState);

      expect(ops).toEqual([
        { p: 5, d: 'World' },
        { p: 10, i: 'CodeMirror' }
      ]);
    });
  });

  describe('validateEditorView', () => {
    it('should validate valid EditorView', () => {
      const mockView = {
        state: { doc: { toString: () => '' } },
        dispatch: () => {}
      };

      expect(monitor['validateEditorView'](mockView)).toBe(true);
    });

    it('should reject invalid EditorView', () => {
      expect(monitor['validateEditorView'](null)).toBe(false);
      expect(monitor['validateEditorView']({})).toBe(false);
    });
  });
});
```

### 集成测试（手动）

**测试环境：**
```bash
# 1. 构建
cd packages/shared && npm run build
cd packages/extension && npm run build
cd packages/mirror-server && npm run build && node dist/cli.js start

# 2. 加载扩展
# chrome://extensions/ → 加载已解压的扩展程序

# 3. 打开 Overleaf 项目并编辑
```

**测试场景清单：**

| 场景 | 操作 | 预期结果 |
|------|------|---------|
| 基础功能 | 输入 "Hello" | 控制台和服务器显示编辑事件 |
| 删除操作 | 删除文本 | ops 包含 delete 操作 |
| 混合操作 | 替换文本 | ops 包含 delete + insert |
| 文件过滤 | 编辑 .pdf | 无日志 |
| 远程操作 | 协作者编辑 | source: 'remote' |
| 快速输入 | 连续输入 | 每个字符触发事件 |
| 页面导航 | 切换文件 | 重新检测 EditorView |
| WebSocket 断开 | 停止服务器 | 错误日志，不崩溃 |
| 重连 | 重启服务器 | 自动恢复 |

---

## Performance Considerations

**性能指标：**
- EditorView 检测时间：< 100ms（理想）或 < 5s（超时）
- Transaction 处理延迟：< 10ms
- 内存占用：< 5MB（无内存泄漏）
- CPU 占用：编辑时 < 1%

**优化策略：**

1. **懒加载**：只在 `start()` 时检测 EditorView
2. **避免重复查询**：缓存 `.cm-content` 元素引用
3. **及时清理**：断开 MutationObserver，移除监听器

```typescript
// 性能优化：缓存 DOM 引用
private cmContentElement: Element | null = null;

private findEditorViewImmediate(): EditorView | null {
  if (!this.cmContentElement) {
    this.cmContentElement = document.querySelector('.cm-content');
  }

  const view = this.cmContentElement?.cmView?.view;
  // ...
}
```

---

## Implementation Plan

### 阶段 1：基础设施（1-2小时）
- [ ] 删除旧的 EditMonitor 代码
- [ ] 创建新的 EditMonitor 类骨架
- [ ] 实现 EditorView 检测逻辑
- [ ] 实现基本的启动/停止机制
- [ ] **验收**：`start()` 能成功检测到 EditorView

### 阶段 2：核心功能（2-3小时）
- [ ] 实现 Transaction 监听器注册
- [ ] 实现 CodeMirror → ShareJS 转换
- [ ] 实现操作来源检测
- [ ] 实现文件信息提取
- [ ] **验收**：输入文本能产生正确的 ops

### 阶段 3：错误处理与优化（1-2小时）
- [ ] 添加完整的错误处理
- [ ] 实现优雅降级
- [ ] 添加调试日志
- [ ] 优化性能
- [ ] **验收**：边界情况正确处理

### 阶段 4：测试与文档（1小时）
- [ ] 编写单元测试
- [ ] 手动集成测试
- [ ] 更新文档
- [ ] 代码审查和重构
- [ ] **验收**：所有测试通过

**预计总工作量：** 5-8 小时

---

## File Structure

```
packages/extension/src/content/
├── edit-monitor.ts              # 主实现（重构）
├── edit-monitor/
│   ├── detectors.ts             # EditorView 检测器
│   ├── converters.ts            # CodeMirror → ShareJS 转换器
│   ├── listeners.ts             # Transaction 监听器
│   └── utils.ts                 # 辅助函数
└── __tests__/
    └── edit-monitor.test.ts     # 单元测试

packages/mirror-server/src/handlers/
├── edit-monitor.ts              # 已存在，无需修改
└── index.ts

packages/shared/src/types.ts     # 已存在，无需修改
```

---

## Migration Strategy

**不兼容的变更：**
- 删除对旧编辑器（Ace/ShareJS）的支持
- 删除 WebSocket 和网络请求拦截逻辑
- EditMonitor.start() 现在是异步的

**迁移步骤：**
1. 确保 `injector.ts` 使用 `await editMonitor.start()`
2. 移除依赖旧实现的代码
3. 更新测试用例

**回滚计划：**
```bash
git revert <commit-hash>
```

---

## Known Limitations

1. **仅支持 CodeMirror 6**：不支持旧编辑器（Ace/ShareJS）
2. **单文件监听**：当前只监听第一个 `.cm-editor` 实例
3. **远程操作检测**：可能需要根据实际行为调整
4. **EditorView 访问**：依赖内部属性（`.cmView.view`），可能随 Overleaf 更新而变化

---

## Future Enhancements

1. **多文件支持**：监听多个打开的文件
2. **操作统计**：记录编辑统计信息
3. **操作回放**：用于调试和审计
4. **UI 开关**：让用户控制是否监听
5. **离线缓冲**：断网时缓冲操作，重连后发送

---

**文档版本**: 1.0
**最后更新**: 2026-03-07
