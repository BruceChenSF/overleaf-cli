# Overleaf 新编辑器 API 探索

## 问题发现

```
hasSharejsDocs: false
hasDocs: false
hasOpenDocs: false
hasDocManager: false
```

**结论**: `window.editor` 不存在，Overleaf 已迁移到新编辑器架构。

## 🔍 探索步骤

### 第一步：找到实际的编辑器实例

在浏览器控制台运行：

```javascript
// 1. 搜索全局变量中的编辑器相关对象
Object.keys(window).filter(key =>
  key.includes('editor') ||
  key.includes('Editor') ||
  key.includes('doc') ||
  key.includes('Doc')
).forEach(key => console.log(key, window[key]));
```

### 第二步：查找 React 组件实例

新 Overleaf 可能使用 React，尝试：

```javascript
// 查找 React 内部实例
const rootElement = document.querySelector('#editor');
console.log('Root element:', rootElement);
console.log('React fiber:', rootElement?._reactRootContainer?._internalRoot?.current);
```

### 第三步：查找 CodeMirror 实例

从堆栈看到 `codemirror-editor`，尝试：

```javascript
// 查找所有 CodeMirror 视图
document.querySelectorAll('.cm-editor').forEach((el, i) => {
  console.log(`Editor ${i}:`, el);
  console.log(`  View:`, el.cmView || el.__cm_view);
});
```

### 第四步：监听编辑器事件（临时方案）

如果找不到文档对象，我们可以直接监听编辑事件：

```javascript
// 监听 CodeMirror 的变化事件
document.addEventListener('input', (e) => {
  console.log('Input event:', e);
});

// 或监听特定的 Overleaf 事件
window.addEventListener('doc:changed:before', (e) => {
  console.log('Before doc:changed:', e);
  console.log('window keys:', Object.keys(window).filter(k => k.includes('doc')));
});
```

## 🎯 快速修复方案

如果找不到文档对象，我们可以：

### 方案 A：监听实际的编辑事件（推荐）

不依赖 Overleaf 内部 API，直接监听 DOM 事件：

```typescript
private setupAlternativeMonitoring() {
  // 监听输入事件
  document.addEventListener('input', this.handleInputEvent);
}

private handleInputEvent = (event: Event) => {
  const target = event.target as HTMLElement;
  if (target.classList.contains('cm-content')) {
    console.log('[EditMonitor] Content edited via new editor');
    // 发送编辑事件
    this.sendEditEvent({
      doc_id: this.currentDocId,
      doc_name: this.currentDocName,
      version: Date.now(),
      ops: [{ p: 0, i: 'detected-change' }],
      meta: {
        user_id: this.getCurrentUserId(),
        source: 'local',
        timestamp: Date.now()
      }
    });
  }
}
```

### 方案 B：等待文档加载完成

```typescript
private waitForDocumentReady(docId: string): Promise<any> {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const doc = this.findDocumentByAnyMethod(docId);
      if (doc) {
        clearInterval(checkInterval);
        resolve(doc);
      }
    }, 100);

    // 超时后放弃
    setTimeout(() => clearInterval(checkInterval), 5000);
  });
}
```

## 📋 请运行这些命令

请在控制台运行上面的探索命令，并把结果告诉我。特别是：

1. **第一步的结果** - 显示所有包含 "editor" 的全局变量
2. **第三步的结果** - CodeMirror 视图信息

这样我就能找到正确的 API 路径！

## 🔄 临时测试方案

在找到正确的 API 之前，你可以先测试 WebSocket 连接是否工作：

```javascript
// 在控制台手动触发编辑事件
window.dispatchEvent(new CustomEvent('doc:changed', {
  detail: { id: 'test-doc-123' }
}));
```

然后查看 Mirror Server 是否收到消息（即使文档对象不存在）。
