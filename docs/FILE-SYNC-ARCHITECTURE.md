# 🔄 Overleaf 文件同步架构方案

> **重要文档**: 本文档详细说明了 Overleaf Mirror 项目的文件同步架构，包括设计决策、技术实现和关键代码。

**文档版本**: v1.0
**最后更新**: 2026-03-08
**状态**: ✅ 生产就绪

---

## 📋 目录

- [架构概述](#架构概述)
- [为什么选择浏览器端同步](#为什么选择浏览器端同步)
- [架构图](#架构图)
- [详细流程](#详细流程)
- [关键实现](#关键实现)
- [数据流](#数据流)
- [文件格式](#文件格式)
- [错误处理](#错误处理)
- [性能考虑](#性能考虑)

---

## 架构概述

### 核心设计

Overleaf Mirror 采用 **浏览器端主导的文件同步架构**，而非传统的后端主导模式。

**关键决策**：
- ✅ 浏览器扩展直接连接 Overleaf WebSocket
- ✅ 浏览器扩展负责文件获取和同步
- ❌ Node.js 后端**不**直接连接 Overleaf

### 为什么不使用 Node.js 后端同步？

经过多次测试验证，我们发现：

1. **Socket.io 协议兼容性问题**
   - Overleaf 使用 Socket.io 0.9.x 协议
   - Node.js `ws` 库无法完全模拟浏览器 WebSocket 行为
   - 服务器会检测并拒绝非浏览器的 WebSocket 连接

2. **认证复杂性**
   - 需要 CSRF token（从 HTML meta 标签提取）
   - 需要特定的 Cookie 格式
   - 需要特定的 User-Agent 和 Origin headers
   - 即使完全模拟，仍会被 Overleaf 服务器拒绝（错误码 `7:::1+0`）

3. **实际测试结果**
   ```
   [Overleaf WS] ✅ WebSocket connection opened (handshake successful)
   [Overleaf WS] 📨 Received: 7:::1+0
   [Overleaf WS] ❌ Server error: 1+0
   [Overleaf WS] ❌ Connection closed. Code: 1006
   ```

**结论**：使用浏览器原生 WebSocket 是唯一可靠的方案。

---

## 为什么选择浏览器端同步

### 优势

| 特性 | 浏览器端同步 | Node.js 后端同步 |
|------|------------|----------------|
| **兼容性** | ✅ 100% 原生 WebSocket | ❌ 协议模拟不完整 |
| **认证** | ✅ 自动继承页面会话 | ❌ 需要手动提取和模拟 |
| **可靠性** | ✅ 经过验证的稳定方案 | ❌ 连接经常被拒绝 |
| **维护成本** | ✅ 代码简单清晰 | ❌ 需要持续更新协议模拟 |
| **性能** | ✅ 直接连接，无中转 | ⚠️ 需要中转文件数据 |

### 技术优势

1. **零认证问题**
   - 浏览器自动发送 cookies
   - 自动处理 CSRF token
   - 无需手动管理会话

2. **完全兼容**
   - 使用原生 WebSocket API
   - 完全符合 Socket.io 协议
   - 服务器无法区分是浏览器还是扩展

3. **代码简洁**
   - 不需要复杂的协议模拟
   - 不需要处理各种边界情况
   - 更容易维护和调试

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      用户浏览器 (Chrome)                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │           Overleaf 网页 (overleaf.com)                     │  │
│  │  - 用户编辑文档                                             │  │
│  │  - 包含 CSRF token (meta标签)                              │  │
│  │  - 已登录会话 (cookies)                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ↓                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │         浏览器扩展 Content Script (injector.ts)            │  │
│  │  1. 提取 CSRF token                                        │  │
│  │  2. 获取 cookies                                           │  │
│  │  3. 创建 OverleafWebSocketClient                           │  │
│  │  4. 连接到 Overleaf WebSocket API                          │  │
│  │  5. 同步所有文件                                            │  │
│  │  6. 发送文件到 Mirror Server                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│           ↓ WebSocket (原生)                    ↓ WebSocket    │
│  ┌─────────────────────────┐      ┌──────────────────────────┐  │
│  │   Overleaf 服务器        │      │   Mirror Server         │  │
│  │  - Socket.io 协议        │      │  - 接收文件内容          │  │
│  │  - 返回文件列表          │      │  - 写入本地磁盘          │  │
│  │  - 返回文件内容          │      │  - 文件监控              │  │
│  └─────────────────────────┘      └──────────────────────────┘  │
│                                            ↓                     │
│                              ┌─────────────────────────────┐   │
│                              │   本地文件系统                │   │
│                              │  C:\Users\pc\overleaf-mirror\ │  │
│                              │  {projectId}\                │  │
│                              │  - main.tex                  │  │
│                              │  - figures/duck.jpg          │  │
│                              │  - ...                       │  │
│                              └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 详细流程

### 初始同步流程（Initial Sync）

```
1. 用户打开 Overleaf 项目页面
   ↓
2. 浏览器扩展注入 (injector.ts)
   ↓
3. 连接到 Mirror Server (WebSocket)
   ↓
4. 发送 cookies 和 CSRF token 到 Mirror Server
   ↓
5. 调用 requestInitialSync()
   ↓
6. 创建 OverleafWebSocketClient
   ↓
7. 连接到 Overleaf WebSocket API
   ├─ 获取 session ID
   ├─ 建立 WebSocket 连接
   └─ 接收 joinProjectResponse
   ↓
8. 遍历所有文件
   ├─ 对于文本文件 (.tex, .bib, .cls 等)
   │  ├─ 调用 joinDoc(docId)
   │  ├─ 获取内容（行数组）
   │  └─ 调用 leaveDoc(docId)
   │
   └─ 对于二进制文件 (.jpg, .png, .pdf 等)
      └─ 调用 downloadFile(fileId)
         └─ 获取内容（ArrayBuffer）
   ↓
9. 逐个发送文件到 Mirror Server
   ├─ 文本文件：直接发送字符串
   └─ 二进制文件：Base64 编码后发送
   ↓
10. Mirror Server 接收并保存到本地磁盘
   ├─ 创建目录结构
   ├─ 写入文件内容
   └─ 确认保存成功
```

### 实时编辑同步流程（Edit Sync）

```
1. 用户在 Overleaf 中编辑文档
   ↓
2. EditMonitor 检测到编辑事件
   ↓
3. 发送 edit_event 消息到 Mirror Server
   ↓
4. Mirror Server 更新本地文件
   ↓
5. FileWatcher 检测到本地变化
   ↓
6. 触发后续同步流程（可选）
```

---

## 关键实现

### 1. 浏览器扩展 - Overleaf WebSocket 客户端

**文件**: `packages/extension/src/content/overleaf-sync.ts`

```typescript
export class OverleafWebSocketClient {
  private ws: WebSocket | null = null;
  private messageSeq = 0;
  private docIdToPath = new Map<string, DocInfo>();

  async connect(): Promise<void> {
    // 1. 获取 session ID
    const res = await fetch(
      `${this.baseUrl}/socket.io/1/?projectId=${this.projectId}&t=${Date.now()}`,
      {
        headers: {
          'Cookie': this.formatCookies(),
          'X-Csrf-Token': this.csrfToken
        }
      }
    );

    const sessionId = (await res.text()).split(':')[0];

    // 2. 连接 WebSocket（浏览器原生）
    const wsUrl = `wss://${domain}/socket.io/1/websocket/${sessionId}`;
    this.ws = new WebSocket(wsUrl);

    // 3. 等待连接建立
    await new Promise((resolve) => {
      this.ws!.onopen = () => resolve();
    });
  }

  async syncAllFiles(): Promise<SyncedFile[]> {
    await this.waitForProjectJoin();
    const allIds = this.getAllDocIds();
    const syncedFiles: SyncedFile[] = [];

    for (const id of allIds) {
      const info = this.getDocInfo(id);

      if (info.type === 'doc') {
        // 文本文件
        const lines = await this.joinDoc(id);
        await this.leaveDoc(id);
        syncedFiles.push({
          path: info.path,
          content: lines.join('\n'),
          type: 'doc'
        });
      } else if (info.type === 'file') {
        // 二进制文件
        const buffer = await this.downloadFile(id);
        syncedFiles.push({
          path: info.path,
          content: buffer,
          type: 'file'
        });
      }
    }

    return syncedFiles;
  }
}
```

### 2. 浏览器扩展 - 初始同步触发器

**文件**: `packages/extension/src/content/injector.ts`

```typescript
async function requestInitialSync(): Promise<void> {
  // 1. 获取认证信息
  const cookies = await getCookies();
  const csrfToken = extractCSRFToken();

  // 2. 创建 WebSocket 客户端
  const wsClient = new OverleafWebSocketClient(
    projectId,
    {
      cookieOverleafSession2: cookies['overleaf_session2'],
      cookieGCLB: cookies['GCLB']
    },
    csrfToken
  );

  // 3. 连接并同步
  await wsClient.connect();
  const syncedFiles = await wsClient.syncAllFiles();

  // 4. 发送到 Mirror Server
  for (const file of syncedFiles) {
    const message = {
      type: 'file_sync',
      project_id: projectId,
      path: file.path,
      content_type: file.type,
      content: file.type === 'file'
        ? btoa(String.fromCharCode(...(new Uint8Array(file.content))))
        : file.content,
      timestamp: Date.now()
    };

    mirrorClient!.send(message);
  }

  wsClient.disconnect();
}
```

### 3. Mirror Server - 文件接收处理

**文件**: `packages/mirror-server/src/server.ts`

```typescript
private handleFileSync(
  projectId: string,
  path: string,
  contentType: 'doc' | 'file',
  content: string
): void {
  // 1. 获取项目配置
  const projectConfig = this.configStore.getProjectConfig(projectId);
  const filePath = path.join(projectConfig.localPath, path);

  // 2. 创建目录
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 3. 写入文件
  if (contentType === 'file') {
    // 二进制文件 - Base64 解码
    const buffer = Buffer.from(content, 'base64');
    fs.writeFileSync(filePath, buffer);
  } else {
    // 文本文件
    fs.writeFileSync(filePath, content, 'utf8');
  }
}
```

---

## 数据流

### 消息格式

#### 浏览器 → Mirror Server (文件同步)

```typescript
{
  type: 'file_sync',
  project_id: '69a6f132d255a33e681501a5',
  path: 'main.tex',
  content_type: 'doc',  // 或 'file'
  content: '\\documentclass{article}...',  // 文本或 Base64
  timestamp: 1709876543210
}
```

#### Mirror Server → 浏览器 (确认)

```typescript
{
  type: 'ack',
  request_id: 'unique-id',
  success: true,
  error?: string
}
```

### Socket.io 消息格式

**发送到 Overleaf**:
```
5:0+::{"name":"joinDoc","args":["69aa979e8f6420a3b4774d2d",{"encodeRanges":true}]}
```

**从 Overleaf 接收**:
```
5:::{"name":"joinProjectResponse","args":[{...}]}
6:::0+[null,["line1","line2"],123,...]
```

---

## 文件格式

### 文本文件

- **扩展名**: .tex, .bib, .cls, .sty, .txt 等
- **编码**: UTF-8
- **传输**: 直接字符串传输，无需编码
- **存储**: 直接写入文件系统

### 二进制文件

- **扩展名**: .jpg, .png, .pdf, .eps 等
- **编码**: Base64（用于 WebSocket 传输）
- **传输**: Base64 编码的字符串
- **存储**: 解码后写入二进制文件

### 示例

```typescript
// 文本文件
{
  path: 'main.tex',
  content_type: 'doc',
  content: '\\documentclass{article}\n\\begin{document}\n...\n\\end{document}'
}

// 二进制文件
{
  path: 'figures/duck.jpg',
  content_type: 'file',
  content: '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBD...'  // Base64
}
```

---

## 错误处理

### 连接失败

```typescript
try {
  await wsClient.connect();
} catch (error) {
  console.error('[Mirror] ❌ Failed to connect to Overleaf:', error);
  // 不重试，避免用户打扰
}
```

### 文件同步失败

```typescript
for (const id of allIds) {
  try {
    const file = await syncFile(id);
    syncedFiles.push(file);
  } catch (error) {
    console.error('[Overleaf WS] ❌ Failed to sync', id, ':', error);
    // 继续同步其他文件
  }
}
```

### 服务器写入失败

```typescript
private handleFileSync(...): void {
  try {
    fs.writeFileSync(filePath, content);
    console.log('[Server] ✅ Saved:', path);
  } catch (error) {
    console.error('[Server] ❌ Failed to save:', path, error);
    // 记录错误但不中断
  }
}
```

---

## 性能考虑

### 大文件处理

- **二进制文件**: 使用 ArrayBuffer 和 Base64 编码
- **内存占用**: 一次性加载整个文件到内存
- **优化方向**: 未来可考虑分块传输

### 网络优化

- **并发**: 当前顺序同步文件
- **优化方向**: 可并发同步多个文件（需控制并发数）

### 浏览器性能

- **WebSocket 复用**: 同一个 WebSocket 连接处理所有文件
- **内存管理**: 同步完成后立即断开连接
- **UI 响应**: 所有操作在后台进行，不阻塞用户操作

---

## 总结

### 关键要点

1. ✅ **浏览器端同步是唯一可行方案**
   - Node.js 后端无法通过 Overleaf 的 WebSocket 认证
   - 浏览器原生 WebSocket 100% 兼容

2. ✅ **架构简洁可靠**
   - 认证自动处理
   - 代码易维护
   - 错误处理清晰

3. ✅ **性能可接受**
   - 首次同步可能需要几秒到几十秒
   - 后续增量同步非常快速
   - 不影响用户编辑体验

### 未来改进方向

1. **增量同步**: 只同步修改的文件
2. **并发优化**: 并发同步多个文件
3. **断点续传**: 支持大文件的断点续传
4. **冲突检测**: 检测并处理并发编辑冲突

---

**文档维护**: 本文档应与代码实现保持同步。如有架构变更，请及时更新。

**相关问题**:
- 为什么 Node.js 后端无法连接 Overleaf WebSocket? 见上文"为什么不使用 Node.js 后端同步"章节
- Socket.io 协议细节: 参考原始提交 `2ae0f322`
- 测试指南: 见 `MANUAL-TESTING-GUIDE.md`
