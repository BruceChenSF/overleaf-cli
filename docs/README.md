# 📚 Overleaf Mirror 文档中心

> **项目文档索引** - 快速找到你需要的文档

---

## 🎯 快速开始（必读）

如果你是新来的开发 Agent 或用户，**强烈建议按以下顺序阅读**：

### 1. [主 README.md](../README.md) ⭐⭐⭐
**阅读时间**: 5 分钟
**重要性**: 🔥 **必读**

**内容概要**:
- 项目概述和功能状态
- 快速安装和使用指南
- 项目结构说明
- 故障排查基础

**适合人群**: 所有人（必读）

---

### 2. [ARCHITECTURE.md](./ARCHITECTURE.md) ⭐⭐⭐
**阅读时间**: 5 分钟
**重要性**: 🔥 **核心架构**

**内容概要**:
- 项目架构一图览
- 为什么选择浏览器端同步
- 关键代码文件索引
- 30 秒理解同步流程

**适合人群**: 所有人（必读）

---

### 3. [FILE-OPERATIONS-SYNC.md](./FILE-OPERATIONS-SYNC.md) ⭐⭐⭐⭐⭐
**阅读时间**: 15 分钟
**重要性**: 🔥🔥🔥 **最新完整技术方案**

**内容概要**:
- ✅ 文件创建、删除、重命名的完整实现
- 🏗️ 详细的数据流向图
- 🗺️ docIdToPath 映射表说明
- 📦 所有消息类型定义
- 🧪 测试指南和调试技巧

**适合人群**: 开发者、AI Agent（**强烈推荐优先阅读**）

---

## 📖 核心技术文档

### [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) ⭐⭐⭐
**阅读时间**: 15 分钟

- 详细的架构决策过程
- 为什么 Node.js 后端无法连接 Overleaf WebSocket
- 完整的数据流和消息格式
- 错误处理和性能考虑

### [overleaf-api-reference.md](./overleaf-api-reference.md) ⭐⭐
**阅读时间**: 20 分钟

- Overleaf API 完整参考
- 所有相关端点说明
- 请求/响应格式
- 认证机制详解

---

## 🧪 测试文档

### [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) ⭐⭐
**阅读时间**: 10 分钟

- 手动测试完整流程
- 测试用例和预期结果
- 常见问题诊断

---

## 📋 项目管理文档

### [PROGRESS-REPORT.md](./PROGRESS-REPORT.md) ⭐⭐
**最后更新**: 2026-03-09

- 当前开发进度（90% 完成）
- Phase 1 所有功能详细说明
- Phase 2 开发计划
- 性能指标和测试状态

### [INSTALLATION.md](./INSTALLATION.md) ⭐
**阅读时间**: 5 分钟

- 详细安装步骤
- 依赖说明
- 平台特定注意事项

### [troubleshooting.md](./troubleshooting.md) ⭐
**阅读时间**: 5 分钟

- 常见问题解决
- 错误诊断方法
- 调试技巧

### [known-issues.md](./known-issues.md)
**阅读时间**: 3 分钟

- 当前已知问题
- 限制和注意事项
- 临时解决方案

---

## 📂 计划目录（`docs/plans/`）

历史设计和实现计划文档，供参考使用：

- `2026-03-06-overleaf-mirror-design.md` - 原始设计文档
- `2026-03-06-overleaf-mirror-implementation.md` - 实现计划

---

## 🔍 快速查找

### 我想了解...

| 我想了解 | 查看文档 |
|---------|---------|
| **项目是什么** | [README.md](../README.md) |
| **如何安装使用** | [README.md](../README.md#快速开始) |
| **架构设计** | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **文件同步原理** | [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) |
| **文件操作实现** | [FILE-OPERATIONS-SYNC.md](./FILE-OPERATIONS-SYNC.md) |
| **Overleaf API** | [overleaf-api-reference.md](./overleaf-api-reference.md) |
| **如何测试** | [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) |
| **当前进度** | [PROGRESS-REPORT.md](./PROGRESS-REPORT.md) |
| **遇到问题** | [troubleshooting.md](./troubleshooting.md) |

---

## 📊 文档状态

| 文档 | 状态 | 最后更新 | 准确性 |
|------|------|---------|--------|
| README.md | ✅ 最新 | 2026-03-09 | 100% |
| ARCHITECTURE.md | ✅ 最新 | 2026-03-08 | 100% |
| FILE-OPERATIONS-SYNC.md | ✅ 最新 | 2026-03-09 | 100% |
| FILE-SYNC-ARCHITECTURE.md | ✅ 最新 | 2026-03-08 | 100% |
| PROGRESS-REPORT.md | ✅ 最新 | 2026-03-09 | 100% |
| overleaf-api-reference.md | ✅ 稳定 | 2026-03-06 | 100% |
| MANUAL-TESTING-GUIDE.md | ✅ 稳定 | 2026-03-08 | 100% |
| INSTALLATION.md | ✅ 稳定 | 2026-03-03 | 100% |
| troubleshooting.md | ✅ 稳定 | 2026-03-06 | 100% |
| known-issues.md | ⚠️ 需更新 | 2026-03-03 | 80% |

---

## 🗂️ 已清理的文档

以下文档已被移除（过时或不再需要）：

- ❌ `diagnostics-new-editor.md` - 新编辑器调试，已解决
- ❌ `diagnostics-overleaf-api.md` - API 诊断，已过时
- ❌ `postmortem-api-interception.md` - API 拦截复盘，方案已废弃
- ❌ `test-codemirror6-fix.md` - CodeMirror 修复测试，已完成
- ❌ `test-socket-interception.md` - Socket 拦截测试，已替代
- ❌ `quick-test.md` - 临时测试文档

---

## 🤝 文档贡献

如果你发现文档有错误或需要补充：

1. 检查文档是否准确反映当前代码
2. 更新文档内容
3. 更新"最后更新"日期
4. 提交 PR

---

**文档维护**: Overleaf Mirror Team
**最后更新**: 2026-03-09
