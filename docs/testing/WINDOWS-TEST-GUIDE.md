# Windows 快速测试指南

## 🚀 开始测试（Windows 用户）

### Step 1: 运行预检查（2分钟）

**三种方式任选其一：**

**方式 A：双击批处理文件（最简单）**
```
双击 test-quick-verify.bat
```

**方式 B：PowerShell 脚本**
```powershell
# 在 PowerShell 中运行
.\test-quick-verify.ps1
```

如果遇到执行策略错误，先运行：
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\test-quick-verify.ps1
```

**方式 C：手动检查**
```cmd
# 检查 Node.js
node --version

# 检查构建
dir packages\bridge\dist\cli.js
dir dist\manifest.json
```

---

### Step 2: 启动 Bridge 服务器

打开 **命令提示符** 或 **PowerShell**：

```cmd
cd C:\Home\CodeProjects\overleaf-cc\packages\bridge
node dist\cli.js
```

**预期输出：**
```
[Bridge] WebSocket server listening on port 3456
```

**保持此窗口运行！** 不要关闭它。

---

### Step 3: 加载 Chrome 扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 右上角开启 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 浏览到：`C:\Home\CodeProjects\overleaf-cc\dist`
5. 点击"选择文件夹"

**预期：** 扩展出现在列表中，无错误图标

---

### Step 4: 测试集成（20分钟）

#### Test 4.1: 认证和文件同步

1. 打开 Overleaf 项目（如 https://cn.overleaf.com/project/YOUR_ID）
2. 点击工具栏的 **"Terminal"** 按钮
3. 观察两个窗口：

   **Bridge 服务器窗口应显示：**
   ```
   [Bridge] Client connected
   [Bridge] Auth request for project 69a6f13...
   [Sync] Fetching project files from Overleaf...
   [Sync] Found N documents
   [Sync] Downloaded: main.tex
   [Sync] Initial sync complete
   [Sync] Watching for file changes...
   ```

   **终端窗口应显示：**
   ```
   Overleaf CC Terminal
   Project ID: 69a6f13...

   Connecting to bridge server...
   Connected!
   Files are being synchronized from Overleaf...

   Type commands or use Claude Code CLI.

   overleaf:~$ _
   ```

4. **验证文件已下载：**
   ```cmd
   # 在新命令提示符中
   dir C:\Home\CodeProjects\overleaf-cc\packages\bridge\overleaf-workspace\[PROJECT_ID]\
   ```
   应该看到 Overleaf 中的文件

#### Test 4.2: 命令执行

在终端窗口中尝试：

```bash
node --version
```

**预期：** 显示 `v18.x.x`，同时 bridge 服务器显示：
```
[Bridge] Executing: node --version
[Bridge] Command exited with code 0
```

```bash
npm --version
```

**预期：** 显示 npm 版本号

#### Test 4.3: Claude Code 集成（如果已安装）

如果已安装 Claude Code CLI：

```bash
claude --version
```

**预期：** 显示 Claude Code 版本

---

### Step 5: 错误处理测试

#### Test 5.1: Bridge 未运行

1. 关闭 Bridge 服务器窗口（Ctrl+C）
2. 在 Overleaf 点击 Terminal 按钮
3. **预期错误消息：**
   ```
   Failed to connect to bridge server

   Please make sure the bridge server is running:
     1. Install: npm install -g @overleaf-cc/bridge
     2. Run: overleaf-cc-bridge
   ```

#### Test 5.2: 重连测试

1. 重新启动 Bridge 服务器
2. 刷新 Overleaf 页面
3. 再次点击 Terminal 按钮
4. **预期：** 成功连接

---

## 🐛 常见 Windows 问题

### 问题 1: "Node.js not found"

**解决方案：**
1. 下载 Node.js: https://nodejs.org/
2. 安装 LTS 版本（18+）
3. 重启命令提示符
4. 验证：`node --version`

### 问题 2: 端口 3456 被占用

**检查哪个进程占用：**
```powershell
Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue | Select-Object OwningProcess
```

**解决方案：**
- 杀死占用进程，或
- 使用其他端口：`node dist\cli.js --port 3457`

### 问题 3: PowerShell 执行策略错误

**临时绕过：**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\test-quick-verify.ps1
```

**永久修改（需要管理员）：**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 问题 4: 文件路径空格问题

**使用引号：**
```cmd
cd "C:\Home\CodeProjects\overleaf-cc"
```

### 问题 5: 权限错误

**以管理员身份运行命令提示符：**
1. 右键"命令提示符"
2. 选择"以管理员身份运行"

---

## 📊 Windows 测试检查清单

使用此表格追踪进度：

| # | 测试项 | 状态 | 备注 |
|---|--------|------|------|
| 1 | 预检查脚本通过 | ☐ | 双击 test-quick-verify.bat |
| 2 | Bridge 服务器启动 | ☐ | 看到 "listening on port 3456" |
| 3 | 扩展加载到 Chrome | ☐ | chrome://extensions/ 无错误 |
| 4 | WebSocket 连接成功 | ☐ | 看到 "Connected!" 消息 |
| 5 | 文件初始同步 | ☐ | 看到 "Downloaded: X files" |
| 6 | 文件在本地存在 | ☐ | 检查 overleaf-workspace 目录 |
| 7 | node 命令执行 | ☐ | 显示版本号 |
| 8 | npm 命令执行 | ☐ | 显示版本号 |
| 9 | Bridge 未运行错误 | ☐ | 显示清晰的错误消息 |
| 10| 重连成功 | ☐ | 重启 bridge 后能连接 |

---

## 🎯 完整测试流程（一气呵成）

**准备三个命令提示符窗口：**

**窗口 1 - Bridge 服务器：**
```cmd
cd C:\Home\CodeProjects\overleaf-cc\packages\bridge
node dist\cli.js
```

**窗口 2 - 文件监控（可选）：**
```cmd
# 每 5 秒刷新文件列表
cd C:\Home\CodeProjects\overleaf-cc\packages\bridge\overleaf-workspace
:loop
dir /s
timeout /t 5
goto loop
```

**窗口 3 - 手动检查（需要时）：**
```cmd
# 随时检查文件状态
cd C:\Home\CodeProjects\overleaf-cc\packages\bridge\overleaf-workspace\[PROJECT_ID]
dir
```

**Chrome 浏览器：**
1. 加载扩展
2. 打开 Overleaf 项目
3. 点击 Terminal 按钮
4. 测试命令

---

## 📝 记录测试结果

创建测试日志文件：

```cmd
notepad test-results-windows.txt
```

记录格式：
```
Date: 2026-03-03
OS: Windows 11
Node.js: v20.11.0
Test Results:
- [✓] Pre-check passed
- [✓] Bridge server started
- [✓] Extension loaded
- [✓] Authentication successful
- [✓] File sync working
- [✓] Commands executing
- [✓] Error handling OK

Issues Found:
1. None / List any issues here

Overall: PASS / FAIL
```

---

## 🔍 调试技巧（Windows）

### 查看详细日志

**Bridge 服务器：**
- 日志直接输出在控制台
- 重定向到文件：
  ```cmd
  node dist\cli.js > bridge.log 2>&1
  ```

**Chrome 扩展：**
1. 访问 `chrome://extensions/`
2. 找到 "Overleaf CC"
3. 点击 "Service worker" → 打开 DevTools
4. 查看 Console 标签

**Overleaf 页面：**
1. 在 Overleaf 项目页面
2. 按 F12 打开 DevTools
3. 查看 Console 标签

### 网络检查

**检查 WebSocket 连接：**
1. DevTools → Network 标签
2. 筛选 "WS" (WebSocket)
3. 查看 `ws://localhost:3456` 连接状态

**检查 Overleaf API 调用：**
1. Bridge 日志显示：`[Bridge] Fetching: https://...`
2. 检查返回状态码

### 截图工具

**Windows 截图快捷键：**
- `Win + Shift + S` - 区域截图（保存到剪贴板）
- `PrtScn` - 全屏截图
- `Alt + PrtScn` - 活动窗口截图

---

## ✅ 测试完成检查清单

完成所有测试后，确认：

- [ ] 所有 10 个测试项通过
- [ ] 测试结果已记录
- [ ] 发现的问题已记录
- [ ] 截图已保存（如适用）
- [ ] 可以继续下一步（发布/调试）

---

## 🚀 下一步

**如果所有测试通过：**
- 准备发布 v0.1.0 Alpha
- 创建 GitHub Release
- 写用户文档

**如果测试失败：**
- 查看 `docs/testing/systematic-test-plan.md` 中的"调试失败测试"部分
- 收集证据：日志、截图、错误消息
- 应用 systematic-debugging 流程

---

**需要帮助？** 告诉我具体的错误信息，我会帮你诊断！
