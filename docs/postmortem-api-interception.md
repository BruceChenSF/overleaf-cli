# API 拦截调试复盘

## 问题概述

**目标**：拦截 Overleaf 浏览器扩展中的 API 请求，转发到本地 mirror server

**最终方案**：使用 Chrome webRequest API（background service worker）

## 调试历程

### 尝试 1：Content Script + fetch Proxy（❌ 不工作）

**方案**：在 content script 中使用 Proxy 包装 `window.fetch`

**问题**：Overleaf 在 `<head>` 内联脚本中缓存了原始 fetch：
```javascript
// Overleaf 的代码（在我们之前执行）
const originalFetch = window.fetch;
```

即使我们在 `document_start` 执行，页面脚本仍然更早。

### 尝试 2：Object.defineProperty 锁定（❌ 无效）

**方案**：使用 `Object.defineProperty(window, 'fetch', { writable: false, configurable: false })`

**问题**：
- 时机已经太晚，Overleaf 已经缓存了 fetch
- 锁定失败：`writable` 仍然是 `true`

### 尝试 3：Proxy 隐藏拦截（❌ 不解决问题）

**方案**：使用 JavaScript Proxy 包装 fetch，使其难以检测

**问题**：同样的时机问题，Overleaf 仍然使用缓存的引用

### 尝试 4：webRequest API（✅ 成功！）

**方案**：在 background service worker 中使用 `chrome.webRequest.onBeforeRequest`

**优点**：
- 在浏览器层面拦截，比任何页面代码都早
- 无法被页面脚本干扰或绕过
- 干净、简单、符合扩展最佳实践

## 根本原因

**不是代码问题，是配置错误！**

所有尝试 1-3 的方案**都可能工作**，如果当时就知道正确的 URL 格式。

### 真实问题

Overleaf API 实际 URL：
```
POST https://cn.overleaf.com/project/69a6f132d255a33e681501a5/doc
```

我们的 URL filter：
```javascript
urls: ['https://*.cn.overleaf.com/api/project/*']  // ❌ 错误：假设有 /api/ 前缀
```

**URL 不匹配** → 没有任何请求被拦截！

## 清理成果

### 移除的冗余代码

1. **`packages/extension/src/content/interceptor.ts`**（完全删除）
   - fetch Proxy 拦截器
   - XMLHttpRequest 拦截器
   - Object.defineProperty 锁定逻辑
   - 172 行复杂代码

2. **Content script 简化**
   - 移除 `setupAPIInterceptor()` 调用
   - 仅保留：项目 ID 提取 + WebSocket 连接

3. **日志清理**
   - 移除过度详细的调试日志
   - 保留关键操作日志

### 打包体积优化

```
background.js:  2.44 kB → 2.23 kB  (-0.21 kB, -8.6%)
content.js:     5.70 kB → 2.99 kB  (-2.71 kB, -47.5%)
```

## 教训总结

### 1. 先诊断，后假设

**错误做法**：
```
发现问题 → 假设原因 → 实现复杂方案 → 失败 → 更复杂的方案
```

**正确做法**：
```
发现问题 → 收集数据 → 确定根因 → 最简方案 → 验证
```

### 2. 使用合适的工具

- **Network 标签**：查看实际请求
- **curl 命令**：复现请求，确认 URL 格式
- **Console 日志**：逐步验证假设

### 3. YAGNI 原则

过早优化是万恶之源：
- 不需要 Proxy 隐藏（我们没有隐私需求）
- 不需要 Object.defineProperty 锁定（webRequest 更可靠）
- 不需要 XMLHttpRequest 拦截（Overleaf 不用 XHR）

### 4. 平台 API > 页面 Hack

**优先级**：
1. 平台提供的 API（webRequest）
2. 标准协议（Service Worker Fetch Events）
3. 页面级 Hack（fetch Proxy、defineProperty）

## 最终架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Overleaf Page                          │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  Content Script  │         │  Overleaf Code   │         │
│  │  - Extract ID    │         │  - Original API  │         │
│  │  - WebSocket     │         │    calls         │         │
│  └──────────────────┘         └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
            │                           │
            │ chrome.runtime.sendMessage │
            ▼                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Background Service Worker                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  chrome.webRequest.onBeforeRequest                   │  │
│  │  - Listen to POST/PUT/DELETE on /project/*          │  │
│  │  - Extract request body                              │  │
│  │  - Forward to local server via HTTP                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ fetch('http://localhost:3456/api/mirror')
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Mirror Server (Local)                     │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  HTTP Endpoint   │         │  File Watcher    │         │
│  │  /api/mirror     │         │  (chokidar)      │         │
│  └──────────────────┘         └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## 关键配置

### manifest.json
```json
{
  "permissions": ["webRequest"],
  "host_permissions": [
    "https://*.overleaf.com/*",
    "https://*.cn.overleaf.com/*",
    "http://localhost:3456/*"
  ],
  "background": {
    "service_worker": "dist/background.js"
  }
}
```

### background/index.ts
```typescript
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (['POST', 'PUT', 'DELETE'].includes(details.method)) {
      if (shouldInterceptRequest(details.url)) {
        forwardToMirrorServer({
          url: details.url,
          method: details.method,
          projectId: extractProjectId(details.url),
          requestBody: details.requestBody
        });
      }
    }
  },
  {
    urls: [
      'https://*.overleaf.com/project/*/doc*',
      'https://*.cn.overleaf.com/project/*/doc*',
      // ... more patterns
    ]
  },
  ['requestBody']
);
```

## 验证方法

**测试命令**：
```bash
# 1. 启动 mirror server
cd packages/mirror-server
node dist/cli.js start

# 2. 重新加载扩展
chrome://extensions/ → 刷新

# 3. 测试拦截
在 Overleaf 中创建文件

# 4. 查看日志
Background Console: [Background] Intercepted: POST ...
Mirror Server:      [HTTP] Received: POST /project/...
```

## 相关文件

- ✅ `packages/extension/src/background/index.ts` - webRequest 拦截器
- ✅ `packages/extension/src/content/injector.ts` - 简化为仅 WebSocket
- ✅ `packages/mirror-server/src/server.ts` - HTTP API endpoint
- ❌ `packages/extension/src/content/interceptor.ts` - 已删除

## 参考资料

- [Chrome webRequest API](https://developer.chrome.com/docs/extensions/reference/webRequest/)
- [Manifest V3 Migration](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Content Scripts vs Background Scripts](https://developer.chrome.com/docs/extensions/mv3/content_scripts/)
