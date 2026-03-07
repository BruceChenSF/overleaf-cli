# Mirror Server 功能测试指南

> **测试目的：** 验证 Mirror Server 文件系统同步功能是否正常工作
>
> **测试时间：** 预计 30-45 分钟
>
> **前置要求：** 已完成所有 10 个开发任务，测试全部通过

---

## 📋 测试前准备

### 1. 环境检查

```bash
# 确认当前在项目根目录
cd C:\Home\CodeProjects\overleaf-cc

# 检查 git 状态
git status

# 确认所有测试通过
cd packages/mirror-server
npm test

# 构建 extension
cd ../extension
npm run build
```

**✅ 预期结果：**
- 66 个测试全部通过
- TypeScript 编译成功
- Extension 构建成功，生成 `dist/` 目录

### 2. 启动 Mirror Server

```bash
# 在终端 1：启动 Mirror Server
cd packages/mirror-server
npm start
```

**✅ 预期输出：**
```
[Server] Mirror Server starting...
[Server] HTTP server listening on port 3456
[Server] WebSocket server listening on port 3456
[Server] ProjectConfigStore initialized
```

### 3. 加载浏览器扩展

1. 打开 Chrome/Edge 浏览器
2. 访问 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `C:\Home\CodeProjects\overleaf-cc\packages\extension\`

**✅ 预期结果：**
- 扩展加载成功，图标显示在工具栏
- Console 中无错误信息

---

## 🧪 测试场景

### 场景 1：首次编辑文档（文件创建）

**目标：** 验证首次编辑文档时，本地文件被自动创建

**步骤：**

1. **打开 Overleaf 项目**
   - 访问 https://cn.overleaf.com
   - 登录并打开一个项目
   - 打开任意 `.tex` 文件

2. **观察 Mirror Server 日志**
   ```
   预期看到连接日志：
   [Server] WebSocket client connected
   [Server] Stored cookies for project {project_id}
   ```

3. **在 Overleaf 中编辑文档**
   - 输入一些文本，例如：`Hello World`
   - 等待 2-3 秒

4. **检查 Mirror Server 日志**
   ```
   预期看到：
   ============================================================
   [EditMonitor] Document edited: main.tex
     Project ID: {project_id}
     Local Path: C:\Users\{username}\overleaf-mirror\{project_id}\
     Doc ID: {doc_id}
     Version: {version}
     Source: local
     User ID: {user_id}
     Time: 2026-03-07 22:30:45

     Operations:
       1. Insert "Hello World" at position 0
   ============================================================

   [Server] Created TextFileSyncManager for {project_id}
   [TextFileSync] Created initial file: main.tex (12345 chars)
   ```

5. **验证本地文件**
   ```bash
   # Windows
   dir C:\Users\{username}\overleaf-mirror\{project_id}

   # 或者查看文件内容
   type C:\Users\{username}\overleaf-mirror\{project_id}\main.tex
   ```

**✅ 预期结果：**
- 目录 `~/overleaf-mirror/{project_id}/` 被创建
- 文件 `main.tex` 存在
- 文件内容与 Overleaf 中一致

---

### 场景 2：实时编辑同步（OT 操作）

**目标：** 验证编辑操作实时同步到本地文件

**前提：** 场景 1 已完成，本地文件已存在

**步骤：**

1. **在 Overleaf 中继续编辑**
   - 在文档开头插入文本：`\section{Introduction}`
   - 在文档中间删除一些文本
   - 添加更多内容

2. **观察 Mirror Server 日志**
   ```
   预期看到：
   ============================================================
   [EditMonitor] Document edited: main.tex
     Operations:
       1. Insert "\section{Introduction}" at position 0
       2. Delete "old text" at position 25
       3. Insert "new content" at position 25
   ============================================================

   [TextFileSync] Applied 3 operations to main.tex
   ```

3. **实时查看本地文件**
   ```bash
   # Windows PowerShell - 实时监控文件变化
   Get-Content C:\Users\{username}\overleaf-mirror\{project_id}\main.tex -Wait
   ```

**✅ 预期结果：**
- 每次编辑后，本地文件立即更新
- 操作日志显示正确的位置和内容
- 无延迟或明显滞后

---

### 场景 3：创建新文件

**目标：** 验证在 Overleaf 中创建新文件时，本地也创建

**步骤：**

1. **在 Overleaf 中创建新文件**
   - 点击 "New File"
   - 命名为 `chapter1.tex`
   - 输入内容：`\chapter{Chapter 1}`

2. **观察 Mirror Server 日志**
   ```
   预期看到：
   [HTTP] Received: POST /project/{id}/doc
   [FileHandler] Created: chapter1.tex
   ```

3. **验证本地文件**
   ```bash
   dir C:\Users\{username}\overleaf-mirror\{project_id}
   type C:\Users\{username}\overleaf-mirror\{project_id}\chapter1.tex
   ```

**✅ 预期结果：**
- 本地出现 `chapter1.tex` 文件
- 文件内容与 Overleaf 一致

---

### 场景 4：删除文件

**目标：** 验证删除操作同步到本地

**步骤：**

1. **在 Overleaf 中删除文件**
   - 选择一个测试文件（不要删除重要文件！）
   - 点击删除
   - 确认删除

2. **观察 Mirror Server 日志**
   ```
   预期看到：
   [HTTP] Received: DELETE /project/{id}/doc/{doc_id}
   [FileHandler] Deleted: test.tex
   ```

3. **验证本地文件**
   ```bash
   dir C:\Users\{username}\overleaf-mirror\{project_id}
   ```

**✅ 预期结果：**
- 本地对应文件被删除
- 其他文件保持不变

---

### 场景 5：二进制文件同步（可选）

**目标：** 验证二进制文件（PDF、图片）同步

**⚠️ 注意：** 默认情况下 `syncBinaryFiles: false`，需要手动启用

**步骤：**

1. **启用二进制文件同步**
   - 编辑配置文件：`%USERPROFILE%\.overleaf-mirror\config.json`
   - 将 `syncBinaryFiles` 改为 `true`

   ```json
   {
     "version": "1.0.0",
     "defaultMirrorDir": "C:\\Users\\{username}\\overleaf-mirror",
     "projects": {
       "{project_id}": {
         "projectId": "{project_id}",
         "localPath": "C:\\Users\\{username}\\overleaf-mirror\\{project_id}",
         "createdAt": 1234567890,
         "lastSyncAt": 1234567890,
         "syncBinaryFiles": true
       }
     }
   }
   ```

2. **重启 Mirror Server**
   - 在终端按 Ctrl+C 停止
   - 重新运行 `npm start`

3. **在 Overleaf 中上传图片**
   - 上传一张图片（例如 `figure.png`）

4. **等待 1-2 分钟**（二进制文件使用定期轮询，默认 60 秒）

5. **观察 Mirror Server 日志**
   ```
   预期看到：
   [BinarySync] Starting with interval 60000ms
   [BinarySync] Updating: figure.png
   [BinarySync] Downloaded: figure.png (12345 bytes)
   ```

6. **验证本地文件**
   ```bash
   dir C:\Users\{username}\overleaf-mirror\{project_id}
   ```

**✅ 预期结果：**
- 本地出现 `figure.png` 文件
- 文件大小与 Overleaf 一致

---

### 场景 6：多项目测试

**目标：** 验证多个 Overleaf 项目可以独立同步

**步骤：**

1. **打开第二个 Overleaf 项目**
   - 在新的标签页打开另一个项目

2. **编辑第二个项目的文件**

3. **观察 Mirror Server 日志**
   ```
   预期看到：
   [Server] WebSocket client connected (新的 client_id)
   [Server] Stored cookies for project {different_project_id}
   ```

4. **验证本地目录结构**
   ```bash
   dir C:\Users\{username}\overleaf-mirror
   ```

**✅ 预期结果：**
- 两个项目目录独立存在
- 配置文件中包含两个项目配置
- 各项目文件互不影响

---

### 场景 7：配置文件持久化

**目标：** 验证项目配置被正确保存

**步骤：**

1. **查看配置文件**
   ```bash
   type %USERPROFILE%\.overleaf-mirror\config.json
   ```

**✅ 预期内容结构：**
```json
{
  "version": "1.0.0",
  "defaultMirrorDir": "C:\\Users\\{username}\\overleaf-mirror",
  "projects": {
    "{project_id}": {
      "projectId": "{project_id}",
      "localPath": "C:\\Users\\{username}\\overleaf-mirror\\{project_id}",
      "createdAt": 1234567890123,
      "lastSyncAt": 1234567890456,
      "syncBinaryFiles": false
    }
  }
}
```

2. **重启 Mirror Server**
   - 停止 server (Ctrl+C)
   - 重新启动 `npm start`
   - 重新编辑 Overleaf 文档

3. **验证配置被保留**
   - `lastSyncAt` 应该更新
   - 项目配置保持不变

**✅ 预期结果：**
- 配置文件被创建
- 重启后配置仍然有效
- `lastSyncAt` 持续更新

---

## 🔧 故障排查

### 问题 1：没有看到日志输出

**检查：**
```bash
# Mirror Server 是否在运行
# 检查端口 3456 是否被占用
netstat -ano | findstr :3456
```

**解决：**
- 确保 Mirror Server 正在运行
- 检查浏览器控制台是否有扩展错误

### 问题 2：本地文件未创建

**检查：**
```bash
# 目录是否存在
dir C:\Users\{username}\overleaf-mirror

# 检查配置文件
type %USERPROFILE%\.overleaf-mirror\config.json
```

**可能原因：**
- Cookie 未正确传递
- 文档扩展名不在白名单中（仅支持 `.tex`, `.bib`, `.txt` 等文本文件）

### 问题 3：编辑未同步

**检查日志中是否有：**
```
[EditMonitor] No API client available, skipping file operations
```

**解决：**
- 刷新 Overleaf 页面
- 检查浏览器扩展是否正确加载
- 重新连接 WebSocket

---

## ✅ 成功标准

所有测试通过的标准：

- ✅ 场景 1-4 全部通过（核心功能）
- ✅ 本地文件系统与 Overleaf 保持同步
- ✅ Mirror Server 日志显示完整操作信息
- ✅ 配置文件正确创建和更新
- ✅ 无明显错误或异常

**可选测试：**
- 场景 5：二进制文件同步
- 场景 6：多项目独立同步

---

## 🧹 清理测试数据

测试完成后，可以清理：

```bash
# 停止 Mirror Server (Ctrl+C)

# 删除测试数据
rmdir /s C:\Users\{username}\overleaf-mirror

# 或仅删除特定项目
rmdir /s C:\Users\{username}\overleaf-mirror\{project_id}

# 删除配置文件
del %USERPROFILE%\.overleaf-mirror\config.json
```

---

## 📊 测试记录模板

| 场景 | 测试时间 | 结果 | 问题描述 | 解决方案 |
|------|---------|------|---------|---------|
| 场景 1：首次编辑创建文件 | | ✅/❌ | | |
| 场景 2：实时编辑同步 | | ✅/❌ | | |
| 场景 3：创建新文件 | | ✅/❌ | | |
| 场景 4：删除文件 | | ✅/❌ | | |
| 场景 5：二进制文件同步 | | ✅/❌/⏭️ | | |
| 场景 6：多项目测试 | | ✅/❌/⏭️ | | |
| 场景 7：配置持久化 | | ✅/❌ | | |

**测试人员：** _______________
**测试日期：** _______________
**总体评价：** _______________
