# CodeMirror 6 兼容性修复测试指南

## 修复内容

EditMonitor 已更新为支持 Overleaf 新编辑器（CodeMirror 6）。

### 关键变更

1. **文档访问方式**
   - ❌ 旧方式: `window.editor.sharejs_docs[docId]`
   - ✅ 新方式: `document.querySelector('.cm-editor').__cm_view.state.doc`

2. **文件名获取**
   - 从 URL 路径提取: `/project/main.tex` → `main.tex`
   - 备选: 从页面标题提取

3. **用户 ID 获取**
   - 尝试 localStorage
   - 尝试 URL 路径
   - 尝试全局变量

4. **操作追踪**
   - 简化版差异检测
   - 存储上一次文档内容用于对比

## 测试步骤

### 1. 重新加载扩展

```bash
# 扩展已重新构建
cd packages/extension
npm run build
```

在浏览器中：
1. 打开 `chrome://extensions/`
2. 找到 Overleaf CC Extension
3. 点击刷新按钮

### 2. 打开 Overleaf 并测试

1. 访问任何 Overleaf 项目
2. 打开浏览器控制台（F12）
3. 在编辑器中输入一些文字

### 3. 预期结果

**控制台应该显示:**

```
[EditMonitor] Started monitoring document edits
[EditMonitor] Sending edit event: {
  type: 'edit_event',
  project_id: '...',
  data: {
    doc_id: '...',
    doc_name: 'main.tex',
    version: 1234567890,
    ops: [...],
    meta: {
      user_id: '...',
      source: 'local',
      timestamp: 1234567890
    }
  }
}
```

**Mirror Server 应该显示:**

```
============================================================
[EditMonitor] Document edited: main.tex
  Project ID: ...
  Doc ID: ...
  Version: 1234567890
  Source: local
  User ID: ...
  Time: 2026-3-6 xx:xx:xx

  Operations:
    1. Insert "abc" at position 0
============================================================
```

### 4. 故障排除

如果仍然看到错误，请在控制台运行：

```javascript
// 检查 CodeMirror 元素
const cmEditor = document.querySelector('.cm-editor');
console.log('CodeMirror element:', cmEditor);

// 检查 view 对象
const view = cmEditor?.__cm_view || cmEditor?.cmView || cmEditor?.view;
console.log('CodeMirror view:', view);
console.log('View state:', view?.state);
console.log('View doc:', view?.state?.doc);

// 检查文档内容
if (view?.state?.doc) {
  console.log('Document content:', view.state.doc.toString().substring(0, 100));
  console.log('Document version:', view.state.doc.version);
}
```

把输出结果告诉我，我会进一步调试。

## 已知限制

1. **OT 操作简化**
   - 当前实现使用简化的差异检测
   - 只追踪简单的插入/删除操作
   - 不支持精确的光标位置和复杂编辑

2. **多文件支持**
   - 当前只监听第一个 `.cm-editor` 元素
   - Overleaf 可能同时打开多个文件

3. **版本号**
   - 使用时间戳代替文档版本号
   - CodeMirror 6 的 `doc.version` 可能不存在

## 下一步改进（如果需要）

如果基本功能可用，未来可以改进：

1. **精确的 OT 操作捕获**
   - 监听 CodeMirror 6 的 `transaction` 事件
   - 提取精确的文本变更位置和内容

2. **多文件支持**
   - 为每个打开的文件创建独立的监听器
   - 通过 `doc:changed` 事件的 `docId` 匹配文件

3. **实时同步**
   - 实现双向同步
   - 支持冲突解决

## 测试检查清单

- [ ] 扩展加载成功（无错误）
- [ ] 编辑器输入触发 `doc:changed` 事件
- [ ] EditMonitor 找到 CodeMirror 文档对象
- [ ] 成功提取文件名
- [ ] 成功提取用户 ID（可以是 'unknown'）
- [ ] WebSocket 发送消息成功
- [ ] Mirror Server 接收并打印消息
- [ ] 操作列表不为空或合理地显示 "no operations"
