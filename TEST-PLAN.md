# Overleaf CC 测试计划

> **版本:** v0.1.0 Alpha
> **日期:** 2026-03-03
> **环境:** Windows 11 + PowerShell + Node.js v24

---

## 📋 测试前准备清单

在开始测试前，确保以下环境已就绪：

- [ ] Node.js 18+ 已安装（当前：v24.10.0 ✓）
- [ ] npm 可用（当前：11.6.1 ✓）
- [ ] Chrome 浏览器已安装
- [ ] Overleaf 账号已登录（cn.overleaf.com）

---

## 🚀 快速开始

### Step 0: 运行预检查（2分钟）

```powershell
.\test-quick-verify.ps1
```

**预期结果：**
- 如果显示 `[ERROR]` → 执行下面的修复步骤
- 如果显示 `[SUCCESS]` → 直接进入 Step 1

### Step 0.5: 修复构建问题（如果预检查失败）

```powershell
cd packages\bridge
npm install
npm run build
cd ..\
```

重新运行预检查验证。

---

## Phase 1: 组件隔离测试（10分钟）

### Test 1.1: Bridge 服务器启动

**目的：** 验证 Bridge 服务器可以独立启动

**步骤：**
```powershell
cd packages\bridge
node dist\cli.js
```

**预期输出：**
```
[Bridge] WebSocket server listening on port 3456
```

**验证点：**
- [ ] 服务器启动无错误
- [ ] 端口 3456 正常监听
- [ ] 无崩溃或异常退出

**如果失败：**
```powershell
# 检查端口占用
netstat -an | findstr 3456

# 如果端口被占用，找到进程并关闭
Get-NetTCPConnection -LocalPort 3456 | Select-Object OwningProcess
Stop-Process -Id <进程ID>
```

---

### Test 1.2: Chrome 扩展加载

**目的：** 验证扩展可以正确加载到 Chrome

**步骤：**
1. 打开 Chrome，访问 `chrome://extensions/`
2. 右上角启用 **"开发者模式"**
3. 点击 **"加载已解压的扩展程序"**
4. 浏览到：`C:\Home\CodeProjects\overleaf-cc\dist`
5. 点击"选择文件夹"

**验证点：**
- [ ] 扩展出现在列表中
- [ ] 无错误图标（红色警告）
- [ ] 扩展名称显示为 "Overleaf CC"
- [ ] 图标正确显示（16x16, 48x48, 128x128）

**如果失败：**
- 检查 `dist/manifest.json` 语法
- 验证所有引用文件存在
- 查看扩展页面错误提示

---

## Phase 2: 集成测试（20分钟）

### Test 2.1: WebSocket 连接和认证

**目的：** 验证扩展能连接到 Bridge 服务器并通过认证

**前置条件：**
- Bridge 服务器正在运行
- Chrome 扩展已加载
- 已登录 Overleaf

**步骤：**

1. **保持 Bridge 服务器运行**（Test 1.1 的窗口）

2. **打开新 PowerShell 窗口监控 Bridge 日志**（可选）
   ```powershell
   # 如果想要实时查看日志
   # 不需要操作，Bridge 输出在原窗口
   ```

3. **打开 Overleaf 项目**
   - 访问：https://cn.overleaf.com/project/YOUR_PROJECT_ID

4. **点击工具栏的 "Terminal" 按钮**

5. **观察两个窗口的输出**

**Bridge 服务器窗口应显示：**
```
[Bridge] Client connected
[Bridge] Auth request for project 69a6f13...
[Sync] Fetching project files from Overleaf...
[Sync] Found N documents
[Sync] Downloaded: main.tex
[Sync] Downloaded: references.bib
[Sync] Downloaded: figure1.png
[Sync] Initial sync complete
[Sync] Watching for file changes...
```

**终端窗口应显示：**
```
Overleaf CC Terminal
Project ID: 69a6f132d255a33e681501a5

Connecting to bridge server...
Connected!
Files are being synchronized from Overleaf...

Type commands or use Claude Code CLI.

overleaf:~$ _
```

**验证点：**
- [ ] WebSocket 连接成功
- [ ] 认证消息发送
- [ ] 文件初始同步完成
- [ ] 显示 Connected! 消息
- [ ] 显示命令提示符 `overleaf:~$`

**如果失败：**

**症状 A: "Failed to connect to bridge server"**
- 检查 Bridge 服务器是否运行
- 检查端口 3456 是否开放
- 检查 Windows 防火墙设置

**症状 B: "Could not find Overleaf session cookie"**
- 确保已登录 Overleaf
- 刷新 Overleaf 页面
- 检查 Cookie 设置

**症状 C: "Project context not found"**
- 关闭终端窗口
- 刷新 Overleaf 页面
- 重新点击 Terminal 按钮

---

### Test 2.2: 文件同步验证

**目的：** 验证 Overleaf 文件正确同步到本地文件系统

**步骤：**

1. **在 Bridge 服务器窗口中观察日志**
   - 应看到 `[Sync] Downloaded: xxx` 消息

2. **打开文件管理器，检查本地文件**
   ```powershell
   cd packages\bridge\overleaf-workspace
   dir
   ```

3. **验证项目目录存在**
   ```powershell
   cd <PROJECT_ID>
   dir
   ```

4. **检查文件内容**
   ```powershell
   # 查看某个 .tex 文件
   Get-Content main.tex
   ```

**验证点：**
- [ ] `overleaf-workspace/<PROJECT_ID>/` 目录已创建
- [ ] 包含所有 Overleaf 项目文件
- [ ] 文件内容与 Overleaf 一致
- [ ] 文件目录结构正确

**如果失败：**
- 检查 Bridge 日志中的 API 错误
- 验证 Session Cookie 有效性
- 手动测试 Overleaf API：
  ```powershell
  # 获取 cookie (在浏览器控制台运行)
  document.cookie

  # 测试 API（替换 cookie 和 project_id）
  curl -H "Cookie: overleaf_session_id=<YOUR_COOKIE>" ^
    https://cn.overleaf.com/api/project/<PROJECT_ID>/docs
  ```

---

### Test 2.3: 命令执行测试

**目的：** 验证可以通过终端执行命令

**步骤：**

1. **确保终端已打开**（Test 2.1 完成）

2. **测试基本命令**（在终端窗口中输入）

   **Test 2.3.1: Node.js 版本**
   ```bash
   node --version
   ```

   **预期：** 终端显示 `v24.10.0`

   **Bridge 日志：** `[Bridge] Executing: node --version`

   **Test 2.3.2: npm 版本**
   ```bash
   npm --version
   ```

   **预期：** 终端显示 `11.6.1`

   **Test 2.3.3: 简单 Node 命令**
   ```bash
   node -e "console.log('Hello from terminal')"
   ```

   **预期：** 终端显示 `Hello from terminal`

3. **测试命令历史和编辑**
   - 按 `↑` `↓` 箭头键
   - 按 `Backspace` 删除
   - 输入新命令

**验证点：**
- [ ] 命令执行成功
- [ ] 输出正确显示在终端
- [ ] Bridge 日志显示执行记录
- [ ] 命令历史可用
- [ ] 文本编辑正常

**如果失败：**
- 检查 Node.js 是否在系统 PATH 中
- 验证工作目录权限
- 检查 Bridge 服务器日志的错误信息

---

### Test 2.4: Claude Code 集成（可选）

**目的：** 验证可以运行 Claude Code CLI

**前置条件：**
- Claude Code CLI 已安装：`npm install -g @anthropic-ai/claude-code`

**步骤：**

1. **验证 Claude Code 安装**
   ```powershell
   claude --version
   ```

   **预期：** 显示 Claude Code 版本号

2. **在终端中运行 Claude**
   ```bash
   claude --version
   ```

3. **尝试简单 Claude 命令**
   ```bash
   claude "List files in current directory"
   ```

**验证点：**
- [ ] Claude Code 启动
- [ ] 能查看文件系统
- [ ] 能执行基本操作

**如果失败：**
- 验证 Claude Code 已正确安装
- 检查是否在工作目录中
- 查看 Claude Code 错误消息

---

## Phase 3: 错误处理测试（10分钟）

### Test 3.1: Bridge 服务器未运行

**目的：** 验证错误消息清晰有用

**步骤：**

1. **确保 Bridge 服务器未运行**

2. **在 Overleaf 点击 Terminal 按钮**

3. **观察错误消息**

**预期输出：**
```
Failed to connect to bridge server

Please make sure the bridge server is running:
  1. Install: npm install -g @overleaf-cc/bridge
  2. Run: overleaf-cc-bridge
```

**验证点：**
- [ ] 显示清晰的错误消息
- [ ] 提供安装和运行说明
- [ ] 无技术性错误堆栈
- [ ] 终端不会崩溃

---

### Test 3.2: 网络中断和重连

**目的：** 验证网络断开时的行为

**步骤：**

1. **建立连接**（Test 2.1 完成）

2. **中断连接**
   - 在 Bridge 服务器窗口按 `Ctrl+C`

3. **在终端输入命令**
   ```bash
   node --version
   ```

4. **观察重连行为**
   - 应看到重连尝试
   - 最终显示"Connection lost"消息

5. **重启 Bridge 服务器**
   ```powershell
   cd packages\bridge
   node dist\cli.js
   ```

6. **刷新 Overleaf 页面**

7. **重新点击 Terminal 按钮**

**验证点：**
- [ ] 连接中断时有错误提示
- [ ] 重启 Bridge 后能重新连接
- [ ] 不需要重启浏览器

---

### Test 3.3: 无效命令处理

**目的：** 验证命令解析和错误提示

**步骤：**

在终端中尝试无效命令：

```bash
invalid-command
```

**预期输出：**
```
Command not found: invalid-command
Type "help" for available commands.
```

测试 `help` 命令：
```bash
help
```

**预期输出：**
```
Available commands:
  claude   - Run Claude Code CLI
  npm      - Run npm commands
  node     - Run Node.js
  npx      - Run npx packages
  clear    - Clear terminal
  help     - Show this help
```

**验证点：**
- [ ] 无效命令有友好的错误消息
- [ ] help 命令显示可用命令列表
- [ ] 无崩溃或异常

---

## Phase 4: 完整工作流测试（15分钟）

### Test 4.1: 完整用户流程

**目的：** 模拟真实用户使用场景

**场景：编辑 LaTeX 文件

**步骤：**

1. **启动环境**
   ```powershell
   # 终端 1: Bridge 服务器
   cd packages\bridge
   node dist\cli.js
   ```

2. **打开 Chrome**
   - 访问 `chrome://extensions/`
   - 确认扩展已加载

3. **打开 Overleaf 项目**
   - 访问你的项目
   - 点击 Terminal 按钮

4. **验证连接**
   - 看到 "Connected!" 消息
   - 看到 "Files are being synchronized..." 消息

5. **测试命令**
   ```bash
   node --version
   npm --version
   ls
   ```

6. **测试 help**
   ```bash
   help
   ```

7. **测试 clear**
   ```bash
   clear
   ```

8. **关闭终端**
   - 关闭终端窗口

**验证点：**
- [ ] 完整流程无障碍
- [ ] 所有功能正常工作
- [ ] 用户体验流畅

---

## Phase 5: 性能和压力测试（可选，10分钟）

### Test 5.1: 大文件同步

**目的：** 测试大文件同步性能

**步骤：**

1. **在 Overleaf 中创建大文件**
   - 新建文档，粘贴大量内容（>1MB）

2. **点击 Terminal 按钮**，触发同步

3. **观察同步时间和内存使用**

**验证点：**
- [ ] 文件能在合理时间内同步（<30秒）
- [ ] Bridge 服务器内存使用正常
- [ ] 终端响应不卡顿

---

### Test 5.2: 多文件同时修改

**目的：** 测试并发修改处理

**步骤：**

1. **在 Overleaf 中快速修改多个文件**

2. **在本地工作区也修改文件**

3. **观察同步行为**

**验证点：**
- [ ] 所有修改都被捕获
- [ ] 无文件损坏
- [ ] 最终状态一致

---

## 📊 测试结果记录表

使用此表格记录测试结果：

| 测试项 | 状态 | 备注 | 时间戳 |
|--------|------|------|--------|
| Phase 1.1: Bridge 启动 | ☐ PASS ☐ FAIL | | |
| Phase 1.2: 扩展加载 | ☐ PASS ☐ FAIL | | |
| Phase 2.1: 连接和认证 | ☐ PASS ☐ FAIL | | |
| Phase 2.2: 文件同步 | ☐ PASS ☐ FAIL | | |
| Phase 2.3: 命令执行 | ☐ PASS ☐ FAIL | | |
| Phase 2.4: Claude Code | ☐ PASS ☐ FAIL | | |
| Phase 3.1: Bridge 未运行 | ☐ PASS ☐ FAIL | | |
| Phase 3.2: 网络中断 | ☐ PASS ☐ FAIL | | |
| Phase 3.3: 无效命令 | ☐ PASS ☐ FAIL | | |
| Phase 4.1: 完整流程 | ☐ PASS ☐ FAIL | | |

**总体评估：**
- 总测试数：9
- 通过：___
- 失败：___
- 通过率：___%

**发布决定：**
- [ ] 通过率 ≥ 90% → 可以发布 v0.1.0 Alpha
- [ ] 通过率 < 90% → 需要修复后重新测试

---

## 🐛 问题记录模板

当测试失败时，使用此模板记录：

```markdown
## 测试失败：[测试名称]

**失败步骤：**
1.
2.
3.

**实际输出：**
[粘贴输出]

**预期输出：**
[应该看到什么]

**错误消息：**
[如果有]

**调查过程：**
1. 检查了日志：
2. 验证了配置：
3. 尝试了：

**根本原因：**
[实际原因]

**修复方法：**
[如何修复]

**验证：**
[如何验证修复有效]
```

---

## ✅ 测试完成检查清单

测试完成后，确认：

- [ ] 所有测试已执行
- [ ] 结果已记录在表格中
- [ ] 失败的测试已记录问题详情
- [ ] 截图已保存（关键步骤）
- [ ] Bridge 日志已保存（如有问题）
- [ ] 浏览器控制台日志已检查

---

## 🎯 下一步行动

### 如果所有测试通过（通过率 ≥ 90%）

1. **打标签**
   ```powershell
   git tag -a v0.1.0 -m "First alpha release"
   git push origin v0.1.0
   ```

2. **发布 Bridge CLI**
   ```powershell
   cd packages\bridge
   npm publish --access public
   ```

3. **创建 GitHub Release**
   - 上传扩展压缩包
   - 写发布说明
   - 包含安装指南

### 如果测试失败

1. **优先修复阻塞性问题**（导致核心功能无法工作）
2. **重新测试修复的功能**
3. **更新测试结果记录**
4. **重复直到通过率 ≥ 90%**

---

## 📞 需要帮助？

如果测试过程中遇到问题：

1. **查看文档**
   - `docs/INSTALLATION.md` - 安装说明
   - `docs/testing/WINDOWS-TEST-GUIDE.md` - Windows 测试指南
   - `docs/testing/WINDOWS-ENCODING-FIX.md` - 编码问题解决方案

2. **检查日志**
   - Bridge 服务器窗口的输出
   - Chrome 扩展 Service Worker 日志
   - 浏览器控制台（F12）

3. **提供诊断信息**
   - 完整的错误消息
   - 复现步骤
   - 相关日志输出
   - 环境信息（OS, Node.js 版本等）

---

**祝测试顺利！** 🚀
