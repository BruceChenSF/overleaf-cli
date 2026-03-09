# 如何启用本地到 Overleaf 的文件同步

**目标**: 启用 Phase 2 功能 - 本地文件编辑自动同步到 Overleaf

---

## 📍 方法 1: 手动编辑配置文件（推荐）

### 步骤 1: 找到配置文件

配置文件位置：
- **Windows**: `C:\Users\YourUser\.overleaf-mirror\config.json`
- **Linux/macOS**: `~/.overleaf-mirror/config.json`

### 步骤 2: 编辑配置文件

打开配置文件，您会看到类似这样的结构：

```json
{
  "version": "1.0.0",
  "defaultMirrorDir": "~/overleaf-mirror",
  "projects": {
    "69a6f132d255a33e681501a5": {
      "projectId": "69a6f132d255a33e681501a5",
      "localPath": "C:/Users/YourUser/overleaf-mirror/69a6f132d255a33e681501a5",
      "createdAt": 1709876543210,
      "lastSyncAt": 1709876543210,
      "syncBinaryFiles": false
    }
  }
}
```

### 步骤 3: 添加 enableFileSync 字段

在您的项目配置中添加 `"enableFileSync": true`：

```json
{
  "version": "1.0.0",
  "defaultMirrorDir": "~/overleaf-mirror",
  "projects": {
    "69a6f132d255a33e681501a5": {
      "projectId": "69a6f132d255a33e681501a5",
      "localPath": "C:/Users/YourUser/overleaf-mirror/69a6f132d255a33e681501a5",
      "createdAt": 1709876543210,
      "lastSyncAt": 1709876543210,
      "syncBinaryFiles": false,
      "enableFileSync": true
    }
  }
}
```

**重要**: 确保在 `syncBinaryFiles` 字段后面添加逗号，然后添加 `"enableFileSync": true`

### 步骤 4: 保存文件

保存配置文件。

### 步骤 5: 重启 Mirror Server

如果 Mirror Server 正在运行，需要重启：

```bash
# 在 Mirror Server 终端按 Ctrl+C 停止
# 然后重新启动
cd packages/mirror-server
npm start
```

---

## 📍 方法 2: 通过命令行启用（需要临时实现）

**注意**: 当前版本还没有命令行工具来启用文件同步，所以请使用方法 1。

未来版本可能会支持：
```bash
npm run enable-file-sync --project=69a6f132d255a33e681501a5
```

---

## ✅ 验证文件同步已启用

### 检查 1: Mirror Server 启动日志

启动 Mirror Server 后，打开 Overleaf 项目，您应该看到：

```
[Server] Starting file sync for project: 69a6f132d255a33e681501a5
[FileWatcher] Watching directory: C:/Users/pc/overleaf-mirror/69a6f132d255a33e681501a5
[FileWatcher] Change callback registered
[OverleafSyncManager] Initializing 15 mappings
[OverleafSyncManager] ✅ Initialized path → docId mappings
```

### 检查 2: 测试文件同步

1. 找到本地项目目录
2. 编辑一个文件（如 `main.tex`）
3. 等待 1-2 秒
4. 查看日志：

**Mirror Server 应该显示**:
```
[FileWatcher] File modified: main.tex
[OverleafSyncManager] Syncing to Overleaf: update main.tex
[OverleafSyncManager] ✅ Sent sync request: update main.tex
```

**浏览器扩展 Console 应该显示**:
```
[Mirror] Received sync_to_overleaf request: {...}
[APIHandler] update main.tex
[APIHandler] ✅ Updated: main.tex
```

### 检查 3: 确认 Overleaf 更新

刷新 Overleaf 页面，检查您编辑的文件内容是否已更新。

---

## ❌ 如果文件同步未启用

### 问题 1: 没有看到 "Starting file sync" 日志

**原因**: `enableFileSync` 未设置为 `true`

**解决**:
1. 检查配置文件是否正确保存
2. 确认 JSON 格式正确（可以在线验证 JSON）
3. 重启 Mirror Server

### 问题 2: 配置文件不存在

**原因**: 项目从未同步过

**解决**:
1. 打开 Overleaf 项目
2. 等待初始同步完成
3. 配置文件会自动创建
4. 然后添加 `enableFileSync: true`

### 问题 3: 配置文件位置错误

**原因**: 配置文件在用户主目录下

**解决**:
- Windows: `C:\Users\YourUser\.overleaf-mirror\config.json`
- 不要在项目目录中查找

---

## 📝 完整配置示例

```json
{
  "version": "1.0.0",
  "defaultMirrorDir": "C:/Users/pc/overleaf-mirror",
  "projects": {
    "69a6f132d255a33e681501a5": {
      "projectId": "69a6f132d255a33e681501a5",
      "projectName": "My LaTeX Project",
      "localPath": "C:/Users/pc/overleaf-mirror/69a6f132d255a33e681501a5",
      "createdAt": 1709876543210,
      "lastSyncAt": 1709876543210,
      "syncBinaryFiles": false,
      "enableFileSync": true
    },
    "another-project-id": {
      "projectId": "another-project-id",
      "localPath": "C:/Users/pc/overleaf-mirror/another-project-id",
      "createdAt": 1709876543210,
      "lastSyncAt": 0,
      "syncBinaryFiles": true,
      "enableFileSync": false
    }
  }
}
```

**说明**:
- 第一个项目：文件同步已启用（`enableFileSync: true`）
- 第二个项目：文件同步未启用（`enableFileSync: false` 或不设置）

---

## 🎯 快速启用清单

- [ ] 找到配置文件：`~/.overleaf-mirror/config.json`
- [ ] 找到您的项目 ID（从 Overleaf URL 或配置文件）
- [ ] 在项目配置中添加 `"enableFileSync": true`
- [ ] 保存配置文件
- [ ] 重启 Mirror Server
- [ ] 打开 Overleaf 项目
- [ ] 查看日志确认文件同步已启动
- [ ] 编辑本地文件测试同步

---

## 💡 提示

1. **项目 ID 位置**: Overleaf 项目 URL 中的一部分
   - 例如：`https://cn.overleaf.com/project/69a6f132d255a33e681501a5`
   - 项目 ID 就是：`69a6f132d255a33e681501a5`

2. **本地路径位置**: 配置文件中的 `localPath` 字段
   - 这是文件存储的本地目录
   - 文件监控会监听这个目录

3. **何时启用**: 建议在初始同步完成后启用
   - 确保所有文件都已同步到本地
   - path → docId 映射已建立

4. **性能考虑**: 文件同步会持续监控本地文件
   - 每次文件变化都会触发同步（500ms 防抖）
   - 对于大项目，建议只在需要时启用

---

## 🔍 配置文件详细说明

### ProjectConfig 字段说明

| 字段 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `projectId` | string | ✅ | - | Overleaf 项目 ID |
| `projectName` | string | ❌ | - | 项目名称（可选） |
| `localPath` | string | ✅ | 自动生成 | 本地文件存储路径 |
| `createdAt` | number | ✅ | 当前时间 | 配置创建时间 |
| `lastSyncAt` | number | ✅ | 0 | 最后同步时间 |
| `syncBinaryFiles` | boolean | ✅ | false | 是否同步二进制文件 |
| `enableFileSync` | boolean | ❌ | false | **是否启用本地→Overleaf同步** |

### GlobalConfig 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | string | 配置文件格式版本 |
| `defaultMirrorDir` | string | 项目默认存储目录 |
| `projects` | object | 所有项目配置（key 是 projectId） |

---

## 📚 相关文档

- **手动测试指南**: `docs/MANUAL-TESTING-PHASE2.md`
- **调试日志覆盖**: `docs/DEBUG-LOG-COVERAGE.md`
- **项目进度**: `docs/PROGRESS-REPORT.md`
- **主 README**: `README.md`

---

**配置指南版本**: 1.0
**最后更新**: 2026-03-09
**作者**: Claude Code Assistant
