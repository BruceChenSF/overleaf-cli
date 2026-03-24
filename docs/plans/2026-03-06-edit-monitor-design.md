# Edit Monitor Design Document

**Date**: 2026-03-06
**Status**: Approved
**Author**: Claude (with user requirements)

---

## Overview

实现 Overleaf 编辑操作的实时监测功能，捕获用户的编辑事件并记录详细的操作信息（增量 OT 操作），为未来的双向同步和冲突检测打下基础。

**核心原则**：
- ✅ 仅监测，不修改内容（当前阶段）
- ✅ 细粒度记录（完整 OT 操作）
- ✅ 浏览器 + 服务器双重日志
- ✅ 只监听文本文件
- ✅ 保留扩展性，便于未来升级

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Overleaf Page                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Content Script                                       │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │ EditMonitor                                     │  │  │
│  │  │ - 监听 window 'doc:changed' 事件               │  │  │
│  │  │ - 从 window.editor.sharejs_docs 提取信息       │  │  │
│  │  │ - 过滤文本文件扩展名                           │  │  │
│  │  │ - 节流处理（100ms）                            │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  │           ↓                                           │  │
│  │  MirrorClient - 通过 WebSocket 发送                 │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↓ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                    Mirror Server                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ handleEditMonitor()                                  │  │
│  │ - 接收 edit_event 消息                              │  │
│  │ - 打印格式化日志                                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### Shared Types (`packages/shared/src/types.ts`)

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
export const TEXT_FILE_EXTENSIONS = new Set([
  '.tex', '.bib', '.cls', '.sty', '.def', '.bst',
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.c', '.cpp', '.h', '.java',
  '.cfg', '.conf', '.ini'
]);
```

---

## Components

### 1. EditMonitor Class

**File**: `packages/extension/src/content/edit-monitor.ts`

**Responsibilities**:
- 监听 `window` 的 `doc:changed` 事件
- 从 `window.editor.sharejs_docs` 提取文档信息
- 过滤文件扩展名
- 节流处理（避免重复触发）
- 通过 MirrorClient 发送事件到服务器

**Key Methods**:
```typescript
class EditMonitor {
  start(): void                      // 开始监测
  stop(): void                       // 停止监测
  private handleDocChanged()         // 处理文档变化事件
  private getShareJsDoc()            // 获取 ShareJS 文档对象
  private extractDocInfo()           // 提取编辑信息
  private getDocName()               // 获取文档名称
  private getExtension()             // 获取文件扩展名
  private getCurrentUserId()         // 获取当前用户 ID
  private sendEditEvent()            // 发送编辑事件
}
```

**Throttling**: 100ms 节流窗口，避免快速连续输入导致的重复处理。

---

### 2. Mirror Server Handler

**File**: `packages/mirror-server/src/handlers/edit-monitor.ts`

**Responsibilities**:
- 接收 `edit_event` 消息
- 格式化并打印日志
- 提供调试辅助函数

**Output Format**:
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
    1. Insert "Hello" at position 42
    2. Delete "foo" at position 50
    3. Retain/Cursor to position 55
============================================================
```

---

### 3. Integration Points

**Content Script Integration** (`packages/extension/src/content/injector.ts`):
```typescript
// 在 initializeMirror() 函数中添加
import { EditMonitor } from './edit-monitor';

let editMonitor: EditMonitor | null = null;

async function initializeMirror(): Promise<void> {
  // ... 现有代码 ...

  // 新增：启动编辑监测
  if (projectId) {
    editMonitor = new EditMonitor(projectId, mirrorClient);
    editMonitor.start();
  }
}

// 清理时停止监测
window.addEventListener('beforeunload', () => {
  if (editMonitor) {
    editMonitor.stop();
  }
});
```

**Server Integration** (`packages/mirror-server/src/server.ts`):
```typescript
// 在 handleMessage() 的 switch 语句中添加
import { handleEditMonitor } from './handlers/edit-monitor';

switch (message.type) {
  case 'mirror':
    // 现有逻辑
    break;

  case 'edit_event':  // 新增
    handleEditMonitor(message as EditEventMessage);
    break;

  case 'sync':
    // 现有逻辑
    break;
}
```

---

## Error Handling

### 错误处理策略

| 错误场景 | 处理方式 |
|---------|---------|
| `window.editor` 未初始化 | 等待 DOM 加载完成 |
| 文档对象无效 | 返回 `null`，跳过该文档 |
| 版本号无效 | 返回 `null`，打印警告 |
| ops 不是数组 | 返回 `null`，打印警告 |
| 文件扩展名不匹配 | 静默跳过（不打印日志） |
| WebSocket 断开 | 暂停监测，等待重连 |
| 重复触发事件 | 节流处理（100ms 窗口） |

### 错误恢复

```typescript
// WebSocket 错误恢复
mirrorClient.on('error', (error) => {
  console.error('[EditMonitor] WebSocket error:', error);
  editMonitor?.stop();  // 暂停监测
});

mirrorClient.on('reconnect', () => {
  console.log('[EditMonitor] WebSocket reconnected');
  editMonitor?.start();  // 恢复监测
});
```

---

## Edge Cases

### 边界情况处理

| 场景 | 处理方式 |
|------|---------|
| Overleaf 页面未完全加载 | 等待 `DOMContentLoaded` 事件 |
| 文档被关闭 | 移除事件监听器，清理资源 |
| WebSocket 断开 | 暂停发送，等待重连后继续 |
| 重复触发 `doc:changed` | 节流处理（100ms 内合并） |
| 协作者编辑（远程操作） | 通过 `meta.source === 'remote'` 过滤 |
| 空操作（只有光标移动） | 记录（可用于追踪光标位置） |
| 二进制文件（.pdf, .png） | 通过扩展名白名单过滤 |

---

## Extensibility

### 可扩展的架构设计

为了支持未来升级到 Socket.IO hook（方案 C），设计了可插拔的监听器接口：

```typescript
// 统一的监听器接口
interface EditListener {
  start(): void;
  stop(): void;
  isMonitoring(): boolean;
}

// 当前实现：DocChangeListener
class DocChangeListener implements EditListener {
  // 方案 1：监听 doc:changed 事件
}

// 未来：ShareJSHookListener
class ShareJSHookListener implements EditListener {
  // 方案 2：劫持 ShareJS Doc.on('change')
}

// 未来：SocketIOHookListener
class SocketIOHookListener implements EditListener {
  // 方案 C：劫持 Socket.IO emit('applyOtUpdate')
}

// EditMonitor 作为策略入口
class EditMonitor implements EditListener {
  constructor(private strategy: EditListener) {}

  start() {
    this.strategy.start();
  }
}
```

### 迁移路径

```
当前（方案 1 - doc:changed）
  ↓
修改配置 strategy = 'sharejs-hook'
  ↓
实现 ShareJSHookListener 类
  ↓
无需修改其他代码，自动切换
```

---

## Testing Strategy

### 手动测试清单

1. **基础功能测试**
   - [ ] 打开 .tex 文件并输入文本
   - [ ] 验证浏览器控制台有 `[EditMonitor]` 日志
   - [ ] 验证 server 终端有格式化输出

2. **文件过滤测试**
   - [ ] 编辑 .tex 文件 → 应该记录
   - [ ] 编辑 .bib 文件 → 应该记录
   - [ ] 编辑 .pdf 文件 → 不应该记录
   - [ ] 编辑 .png 文件 → 不应该记录

3. **多人协作测试**
   - [ ] 打开两个浏览器窗口
   - [ ] 在窗口 A 编辑 → 检查 `source: 'local'`
   - [ ] 在窗口 B 编辑 → 检查窗口 A 的日志

4. **边界情况测试**
   - [ ] 快速连续输入 → 验证节流效果
   - [ ] 关闭文档 → 验证停止监测
   - [ ] 断开 server → 验证错误处理
   - [ ] 重新连接 → 验证恢复监测

### 测试命令

```bash
# 1. 启动 mirror server
cd packages/mirror-server
npm run build
node dist/cli.js start

# 2. 构建扩展
cd packages/extension
npm run build

# 3. 加载扩展
# chrome://extensions/ → 加载已解压的扩展程序

# 4. 打开 Overleaf 并编辑
# https://cn.overleaf.com/project/xxxxx

# 5. 查看日志
# - 浏览器: F12 → Console
# - Server: 终端输出
```

---

## Implementation Plan

下一步：使用 `writing-plans` 技能创建详细的实现计划，包括：
1. 创建新文件
2. 修改现有文件
3. 更新类型定义
4. 测试和验证

---

## Future Enhancements

### 短期（Phase 4+）
- [ ] 添加配置 UI（开启/关闭监测）
- [ ] 支持自定义文件扩展名白名单
- [ ] 导出编辑历史为 JSON

### 中期（Phase 5）
- [ ] 升级到方案 C（Socket.IO hook）
- [ ] 检测远程协作者编辑
- [ ] 编辑统计和可视化

### 长期（Phase 6）
- [ ] 双向同步（本地 → Overleaf）
- [ ] 冲突检测和解决
- [ ] 离线编辑支持

---

**文档版本**: 1.0
**最后更新**: 2026-03-06
