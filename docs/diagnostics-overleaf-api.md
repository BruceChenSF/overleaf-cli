# Overleaf API 诊断指南

## 问题：EditMonitor 找不到文档对象

### 错误信息
```
[EditMonitor] Document 69aa95859ea9439c79dac890 not found
```

### 诊断步骤

#### 1. 打开浏览器控制台（F12）

在 Overleaf 编辑页面执行以下命令来查看数据结构：

```javascript
// 查看 window 对象结构
console.log('window.editor:', window.editor);

// 查看 sharejs_docs 结构
console.log('sharejs_docs:', window.editor?.sharejs_docs);

// 查看所有打开的文档
console.log('docs:', window.editor?.docs);

// 查看项目实体
console.log('entities:', window.editor?.project_app?.rootDoc?.children);
```

#### 2. 触发一次编辑，然后检查事件数据

```javascript
// 监听 doc:changed 事件并查看详细信息
window.addEventListener('doc:changed', (event) => {
  console.log('doc:changed event:', event);
  console.log('doc_id:', event.detail.id);

  // 尝试不同的查找方式
  console.log('From sharejs_docs:', window.editor?.sharejs_docs?.[event.detail.id]);
  console.log('From docs:', window.editor?.docs?.[event.detail.id]);
  console.log('From openDocs:', window.editor?.openDocs?.[event.detail.id]);
});
```

#### 3. 检查 Overleaf 实际使用的 API

根据源码分析，文档可能存储在不同的位置。尝试这些命令：

```javascript
// 方法 1: 通过 sharejs_docs
const doc1 = window.editor?.sharejs_docs?.[docId];

// 方法 2: 通过 docs 属性
const doc2 = window.editor?.docs?.[docId];

// 方法 3: 通过 openDocs
const doc3 = window.editor?.openDocs?.[docId];

// 方法 4: 通过 documentManager
const doc4 = window.editor?.documentManager?.getDocument(docId);

console.log('Method 1:', doc1);
console.log('Method 2:', doc2);
console.log('Method 3:', doc3);
console.log('Method 4:', doc4);
```

### 可能的原因

1. **文档 ID 格式不匹配**
   - `doc:changed` 事件可能发送的是实体 ID 而不是文档 ID
   - 需要通过 `window.editor.docs` 获取实体，然后找到对应的文档

2. **ShareJS 文档未初始化**
   - 文档可能还未加载完成
   - 需要等待 `document:opened` 事件

3. **API 路径变化**
   - Overleaf 更新了 API
   - `sharejs_docs` 可能改名为其他属性

### 临时修复方案

如果发现正确的 API 路径，更新 `edit-monitor.ts` 中的 `getShareJsDoc()` 方法：

```typescript
private getShareJsDoc(docId: string): any {
  const editor = (window as any).editor;

  // 尝试多个可能的路径
  return editor?.sharejs_docs?.[docId] ||
         editor?.docs?.[docId] ||
         editor?.openDocs?.[docId] ||
         editor?.documentManager?.getDocument(docId);
}
```

### 下一步

请运行上述诊断命令并告诉我：
1. 哪个方法成功找到了文档对象？
2. 文档对象的实际结构是什么？

然后我可以修复 `EditMonitor` 来使用正确的 API。

## 调试命令（复制粘贴到控制台）

```javascript
// 一键诊断脚本
(function() {
  const docId = '69aa95859ea9439c79dac890'; // 替换为你的文档 ID

  console.log('=== Overleaf API 诊断 ===');
  console.log('docId:', docId);
  console.log('window.editor:', window.editor);
  console.log('');

  const methods = [
    () => window.editor?.sharejs_docs?.[docId],
    () => window.editor?.docs?.[docId],
    () => window.editor?.openDocs?.[docId],
    () => window.editor?.documentManager?.getDocument(docId),
    () => window.editor?.documentManager?.getDoc(docId),
    () => window.editor?.docManager?.getDoc(docId),
  ];

  const results = methods.map((method, index) => {
    try {
      const result = method();
      console.log(`Method ${index + 1}:`, result ? '✅ Found' : '❌ null');
      if (result) {
        console.log('  Type:', typeof result);
        console.log('  Keys:', Object.keys(result).slice(0, 10).join(', '));
        console.log('  getVersion:', typeof result.getVersion);
        console.log('  getPendingOp:', typeof result.getPendingOp);
      }
      return result;
    } catch (e) {
      console.log(`Method ${index + 1}: ❌ Error - ${e.message}`);
      return null;
    }
  });

  const found = results.find(r => r !== null && r !== undefined);
  if (found) {
    console.log('');
    console.log('✅ 成功！可以使用的方法已找到');
  } else {
    console.log('');
    console.log('❌ 所有方法都失败，需要进一步调查');
  }
})();
```
