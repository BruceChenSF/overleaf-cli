# 快速测试指南

## 环境准备

### 1. 启动 Mirror Server

```bash
cd packages/mirror-server
npm run build
node dist/cli.js start
```

预期输出：
```
Starting Overleaf Mirror Server...
Mirror server listening on port 3456
```

### 2. 构建并加载扩展

```bash
cd packages/extension
npm run build
```

然后在 Chrome 中加载：
1. 打开 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `packages/extension/` 目录

## 测试场景

### 测试 1: 扩展连接测试

**目的：** 验证扩展能成功连接到本地服务器

**步骤：**
1. 确保服务器正在运行
2. 打开任何 Overleaf 项目页面（例如：https://www.overleaf.com/project/xxxxx）
3. 打开浏览器 DevTools (F12) → Console
4. 查看日志

**预期输出：**
```
[Mirror] Initializing for project: xxxxx
[MirrorClient] Connected to server
[Mirror] Initialization complete
[Interceptor] API interception enabled
```

**服务器端预期输出：**
```
New client connected
```

---

### 测试 2: API 拦截测试

**目的：** 验证扩展能拦截 Overleaf API 调用

**步骤：**
1. 在 Overleaf 编辑器中打开任意文件
2. 修改文件内容（随便输入一些文字）
3. 查看 DevTools Console

**预期输出：**
```
[Interceptor] API interception enabled
```

**服务器端预期输出：**
```
Received mirror request: /project/xxxxx/doc
Received mirror request: /project/xxxxx/doc/xxxxx
```

---

### 测试 3: 文件监听测试

**目的：** 验证文件监听器能检测本地文件变更

**步骤：**
1. 打开 Overleaf 项目（触发连接）
2. 在另一个终端，进入镜像目录：
   ```bash
   cd ~/overleaf-mirror/<project-id>/
   ```
3. 创建一个测试文件：
   ```bash
   echo "test content" > test.txt
   ```
4. 修改测试文件：
   ```bash
   echo "modified content" > test.txt
   ```
5. 删除测试文件：
   ```bash
   rm test.txt
   ```

**预期输出（服务器端）：**
```
[FileWatcher] File added: /Users/<username>/overleaf-mirror/<project-id>/test.txt
[FileWatcher] File modified: /Users/<username>/overleaf-mirror/<project-id>/test.txt
[FileWatcher] File deleted: /Users/<username>/overleaf-mirror/<project-id>/test.txt
```

---

### 测试 4: 连接恢复测试

**目的：** 验证扩展能自动重连

**步骤：**
1. 确保扩展已连接到服务器
2. 停止服务器 (Ctrl+C)
3. 等待 3 秒
4. 重新启动服务器：
   ```bash
   node dist/cli.js start
   ```

**预期输出（扩展端）：**
```
[MirrorClient] Disconnected from server
[MirrorClient] Attempting to reconnect...
[MirrorClient] Connected to server
```

---

## 故障排查

### 问题：扩展无法连接到服务器

**检查：**
1. 服务器是否正在运行？
   ```bash
   netstat -an | grep 3456
   ```
   应该看到端口 3456 在监听

2. 浏览器控制台是否有错误？
   - 检查是否有 WebSocket 连接错误
   - 检查是否有 CORS 错误

3. manifest.json 中是否配置了正确的 host_permissions？
   ```json
   "host_permissions": [
     "https://*.overleaf.com/*",
     "ws://localhost:3456/*"
   ]
   ```

### 问题：文件监听没有日志输出

**检查：**
1. 是否收到了 sync 消息？
   - 服务器日志应该显示：`Received sync command: xxx`

2. 镜像目录是否存在？
   ```bash
   ls ~/overleaf-mirror/
   ```

3. 文件监听器是否启动？
   - 服务器日志应该显示：`[FileWatcher] Watching directory: /Users/xxx/overleaf-mirror/<project-id>`

---

## 当前功能状态

### ✅ 已实现
- [x] WebSocket 服务器基础设施
- [x] 浏览器扩展加载和连接
- [x] API 拦截（Overleaf → 本地服务器）
- [x] 文件监听（仅日志，未实现同步）
- [x] 自动重连机制
- [x] SVG 图标

### ⏳ 待实现（未来阶段）
- [ ] 实际的 Overleaf API 调用处理
- [ ] 本地文件 → Overleaf 同步
- [ ] 冲突检测和解决
- [ ] 增量同步优化

---

## 下一步

1. **测试基础连接：** 按照上述测试场景验证所有功能
2. **报告问题：** 如果遇到任何错误，记录详细的错误信息和复现步骤
3. **准备下一阶段：** 基础设施验证通过后，可以实现实际的文件同步逻辑
