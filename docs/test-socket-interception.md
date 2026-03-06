# Socket.io 拦截方案测试指南

## 设计变更说明

### 原始问题

之前的实现尝试访问 Overleaf 内部 API（CodeMirror/ShareJS 对象），这种方式有以下问题：

1. **不稳定性**：Overleaf 内部 API 可能随时变化
2. **访问限制**：CodeMirror 6 的 view 对象无法直接访问
3. **设计偏离**：不是监听网络通信，而是依赖内部实现

### 新方案：Socket.io 消息拦截

基于 Overleaf 源码分析，我们采用**网络通信拦截**方案：

**Overleaf 编辑同步架构**：
```
用户编辑
  ↓
CodeMirror 6 捕获变化
  ↓
转换为 OT 操作
  ↓
submitOp(ops)
  ↓
Socket.io emit('applyOtUpdate', docId, ops, version)
  ↓
后端 Document Updater Service
```

**我们的拦截点**：
```
Socket.io emit('applyOtUpdate', ...)
  ↓ [拦截]
  └─> 读取 ops 数据
  └─> 转发到 Mirror Server
  └─> 原始请求继续发送
```

### 关键优势

1. ✅ **不依赖内部实现**：拦截网络通信，而非内存对象
2. ✅ **数据完整性**：直接获取完整的 OT 操作
3. ✅ **实时性**：拦截发送到后端的操作，保证实时同步
4. ✅ **非侵入性**：不影响 Overleaf 正常功能

## 技术实现

### 拦截方法

```typescript
// 1. 找到 Socket.io 实例
const socket = findSocketInstance();

// 2. 保存原始 emit 方法
originalEmit = socket.emit.bind(socket);

// 3. 替换为拦截方法
socket.emit = (event, ...args) => {
  if (event === 'applyOtUpdate') {
    // 拦截编辑操作
    handleApplyOtUpdate(...args);
  }

  // 调用原始方法（不影响 Overleaf）
  return originalEmit(event, ...args);
};
```

### 数据格式

**applyOtUpdate 事件参数**：
```javascript
// 格式 1 (可能): (docId, ops, version)
socket.emit('applyOtUpdate', '69aa95859ea9439c79dac890', [
  { p: 10, i: 'Hello' }
], 1234567890)

// 格式 2 (可能): { docId, ops, version }
socket.emit('applyOtUpdate', {
  docId: '69aa95859ea9439c79dac890',
  ops: [{ p: 10, i: 'Hello' }],
  version: 1234567890
})
```

**发送到 Mirror Server 的数据**：
```json
{
  "type": "edit_event",
  "project_id": "69a6f132d255a33e681501a5",
  "data": {
    "doc_id": "69aa95859ea9439c79dac890",
    "doc_name": "main.tex",
    "version": 1234567890,
    "ops": [
      { "p": 10, "i": "Hello" }
    ],
    "meta": {
      "user_id": "...",
      "source": "local",
      "timestamp": 1234567890
    }
  }
}
```

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
3. 点击刷新按钮 🔄

### 2. 启动 Mirror Server

```bash
cd packages/mirror-server
npm run dev
```

### 3. 打开 Overleaf 并测试

1. 访问任何 Overleaf 项目
2. 打开浏览器控制台（F12）
3. 在编辑器中输入一些文字

### 4. 预期结果

#### 控制台输出

```
[Mirror] Project ID: 69a6f132d255a33e681501a5
[Mirror] Initializing WebSocket connection...
[MirrorClient] Connected to server
[EditMonitor] Started monitoring via Socket.io interception
[EditMonitor] Found Socket.io instance, intercepting emit...
[EditMonitor] Socket.io interception installed
[Mirror] Initialization complete

[EditMonitor] applyOtUpdate intercepted: [...]
[EditMonitor] Sending edit event: {...}
```

#### Mirror Server 输出

```
============================================================
[EditMonitor] Document edited: main.tex
  Project ID: 69a6f132d255a33e681501a5
  Doc ID: 69aa95859ea9439c79dac890
  Version: 1234567890
  Source: local
  User ID: ...
  Time: 2026-3-6 xx:xx:xx

  Operations:
    1. Insert "Hello" at position 10
============================================================
```

## 故障排除

### 问题 1: Socket.io 实例找不到

**症状**：
```
[EditMonitor] Started monitoring via Socket.io interception
// 没有后续输出
```

**诊断**：在控制台运行
```javascript
// 查找 Socket.io 实例
Object.keys(window).filter(key => {
  const obj = window[key];
  return obj && typeof obj.emit === 'function';
}).forEach(key => console.log(key, window[key]));
```

**解决**：如果找不到，可能需要：
1. 等待页面完全加载
2. 从 React 组件内部查找
3. 监听 WebSocket 连接事件

### 问题 2: applyOtUpdate 事件未触发

**症状**：
```
[EditMonitor] Found Socket.io instance, intercepting emit...
[EditMonitor] Socket.io interception installed
// 编辑时没有输出 applyOtUpdate intercepted
```

**诊断**：在控制台运行
```javascript
// 列出所有 Socket.io 事件
// 找到 socket 对象后，监听所有 emit 调用
const socket = window.socket; // 替换为实际找到的 key
const originalEmit = socket.emit.bind(socket);
socket.emit = function(event, ...args) {
  console.log('Socket emit:', event, args);
  return originalEmit(event, ...args);
};
```

**解决**：根据输出找到实际的事件名称，更新代码中的事件名。

### 问题 3: 参数格式不匹配

**症状**：
```
[EditMonitor] applyOtUpdate intercepted: [...]
// 但后续没有 Sending edit event
```

**诊断**：查看 `applyOtUpdate intercepted` 的参数格式，可能是：
- 单个对象参数
- 数组参数
- 其他格式

**解决**：根据实际格式调整 `handleApplyOtUpdate()` 方法。

## 测试检查清单

- [ ] 扩展加载成功（无错误）
- [ ] 找到 Socket.io 实例
- [ ] 成功安装拦截器
- [ ] 编辑时触发 `applyOtUpdate` 事件
- [ ] 成功解析 ops 数据
- [ ] 成功提取文件名
- [ ] 文件扩展名过滤正常工作
- [ ] WebSocket 发送消息成功
- [ ] Mirror Server 接收并打印消息
- [ ] Overleaf 编辑功能不受影响

## 下一步

如果基础功能正常，可以考虑：

1. **双向同步**：从 Mirror Server 接收远程操作并应用到 Overleaf
2. **冲突解决**：实现 OT 算法来处理并发编辑
3. **离线编辑**：支持离线时缓存操作，联网后同步
4. **多文件支持**：同时跟踪多个文件的编辑

## 相关文件

- `packages/extension/src/content/edit-monitor.ts` - EditMonitor 实现
- `packages/extension/src/client.ts` - MirrorClient (WebSocket 通信)
- `packages/mirror-server/src/handlers/edit-monitor.ts` - 服务端处理
- `packages/shared/src/types.ts` - 共享类型定义
