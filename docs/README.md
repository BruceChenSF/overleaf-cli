# 📚 Overleaf Mirror 文档中心

> **项目文档索引** - 快速找到你需要的文档

---

## 🎯 快速开始（必读）

如果你是新来的开发 Agent 或用户，**强烈建议按以下顺序阅读**：

### 1. [ARCHITECTURE.md](./ARCHITECTURE.md) ⭐⭐⭐
**阅读时间**: 5 分钟
**重要性**: 🔥 **必读**

**内容概要**:
- 项目架构一图览
- 为什么选择浏览器端同步
- 关键代码文件索引
- 30 秒理解同步流程

**适合人群**: 所有人（必读）

---

### 🔥🔥🔥 [TECHNICAL-SOLUTION.md](./TECHNICAL-SOLUTION.md) ⭐⭐⭐⭐⭐
**阅读时间**: 20 分钟
**重要性**: 🔥🔥🔥 **最新完整技术方案**

**内容概要**:
- ✅ **核心功能已实现** - 初始同步 + 实时编辑同步
- 🏗️ 完整架构图和系统设计
- 🐛 所有关键 Bug 的详细修复过程
- 📦 消息格式和数据结构
- 🧪 测试状态和性能指标
- 🚀 部署和使用指南

**适合人群**: 开发者、AI Agent、架构师（**强烈推荐优先阅读**）

---

### 2. [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) ⭐⭐⭐
**阅读时间**: 15 分钟
**重要性**: 🔥 **核心架构文档**

**内容概要**:
- 详细的架构决策过程
- 为什么 Node.js 后端无法连接 Overleaf WebSocket
- 完整的数据流和消息格式
- 错误处理和性能考虑

**适合人群**: 开发者、架构师

---

## 📖 详细文档

### 3. [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) ⭐⭐
**阅读时间**: 10 分钟
**重要性**: 测试和验证

**内容概要**:
- 测试前准备
- 8 个测试场景详解
- 预期结果和验证方法
- 故障排查指南

**适合人群**: 测试人员、用户、开发者

---

### 4. [PROGRESS-REPORT.md](./PROGRESS-REPORT.md) ⭐
**阅读时间**: 10 分钟
**重要性**: 项目进度跟踪

**内容概要**:
- 已完成功能列表
- 待办事项
- 已知问题和限制
- 单元测试覆盖率

**适合人群**: 项目管理者、开发者

---

## 🗂️ 文档分类

### 按角色分类

#### 👨‍💻 开发者
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 快速了解项目
- [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) - 深入理解架构
- [PROGRESS-REPORT.md](./PROGRESS-REPORT.md) - 了解项目状态

#### 🧪 测试人员
- [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) - 测试指南
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 理解系统行为

#### 👤 用户
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 了解工作原理
- [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) - 验证功能

#### 🤖 AI Agent
- [ARCHITECTURE.md](./ARCHITECTURE.md) - **首选**，快速理解架构
- [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) - 详细技术实现
- [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) - 测试验证

---

### 按主题分类

#### 架构设计
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构概览
- [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) - 文件同步详细设计

#### 测试和质量
- [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) - 手动测试指南
- [PROGRESS-REPORT.md](./PROGRESS-REPORT.md) - 测试覆盖率

#### 项目管理
- [PROGRESS-REPORT.md](./PROGRESS-REPORT.md) - 项目进度报告

---

## 🔍 快速查找

### 我想了解...

| 问题 | 推荐文档 |
|------|---------|
| 项目如何工作？ | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 为什么用浏览器扩展同步？ | [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) ⭐️ |
| 如何测试功能？ | [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) |
| 有哪些已知问题？ | [PROGRESS-REPORT.md](./PROGRESS-REPORT.md) |
| 关键代码文件在哪？ | [ARCHITECTURE.md](./ARCHITECTURE.md) - "关键代码文件" |
| 消息格式是什么？ | [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) - "数据流" |
| 如何开始开发？ | [ARCHITECTURE.md](./ARCHITECTURE.md) - "快速开始" |
| 同步失败怎么办？ | [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) - "常见问题" |

---

## 📝 文档维护

### 文档更新原则

1. **代码变更同步更新**: 架构变更时立即更新相关文档
2. **版本标记**: 每个文档顶部标注最后更新日期和版本
3. **交叉引用**: 文档之间相互引用，形成知识网络
4. **示例驱动**: 多用代码示例、日志示例、配置示例

### 文档优先级

- 🔥 **高优先级**: [ARCHITECTURE.md](./ARCHITECTURE.md)、[FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md)
  - 这些文档是其他 Agent 理解项目的基础
  - 必须保持最新和准确

- ⚠️ **中优先级**: [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md)
  - 用于验证功能
  - 随功能更新而更新

- 📊 **低优先级**: [PROGRESS-REPORT.md](./PROGRESS-REPORT.md)
  - 项目跟踪用
  - 定期更新即可

---

## 🤝 AI Agent 使用指南

### 给 AI Agent 的建议

如果你是 AI Agent（如 Claude Code、GitHub Copilot 等），请按以下顺序使用文档：

1. **首先**: 阅读 [ARCHITECTURE.md](./ARCHITECTURE.md)（5 分钟）
   - 理解核心架构
   - 知道关键文件位置
   - 了解设计决策

2. **然后**: 根据任务选择深入阅读
   - 修改文件同步逻辑 → [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md)
   - 添加新功能 → [PROGRESS-REPORT.md](./PROGRESS-REPORT.md)
   - 修复 bug → [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md)

3. **最后**: 参考代码实现
   - 查看 packages/extension/src/content/overleaf-sync.ts
   - 查看 packages/mirror-server/src/server.ts

### 常见任务参考

| 任务 | 参考文档 | 关键文件 |
|------|---------|---------|
| 修改同步逻辑 | [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) | overleaf-sync.ts, server.ts |
| 添加新消息类型 | [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) - "消息格式" | types.ts |
| 优化性能 | [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) - "性能考虑" | overleaf-sync.ts |
| 修复认证问题 | [FILE-SYNC-ARCHITECTURE.md](./FILE-SYNC-ARCHITECTURE.md) - "为什么选择浏览器端同步" | injector.ts |
| 添加测试 | [MANUAL-TESTING-GUIDE.md](./MANUAL-TESTING-GUIDE.md) | *.test.ts |

---

## 📊 文档统计

| 文档 | 行数 | 阅读时间 | 最后更新 |
|------|------|---------|---------|
| README.md (本文件) | ~400 | 5 分钟 | 2026-03-08 |
| ARCHITECTURE.md | ~500 | 5 分钟 | 2026-03-08 |
| FILE-SYNC-ARCHITECTURE.md | ~800 | 15 分钟 | 2026-03-08 |
| MANUAL-TESTING-GUIDE.md | ~600 | 10 分钟 | 2026-03-08 |
| PROGRESS-REPORT.md | ~400 | 10 分钟 | - |

**总阅读时间**: ~45 分钟

---

## 🔗 外部资源

### 相关技术
- [Socket.io 0.9.x 文档](https://socket.io/docs/4.0/)
- [Chrome Extension API](https://developer.chrome.com/docs/extensions/)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Operational Transformation](https://en.wikipedia.org/wiki/Operational_transformation)

### 项目链接
- GitHub Repository (待添加)
- Issue Tracker (待添加)
- Release Notes (待添加)

---

**文档维护**: 本索引由 AI Agent 自动维护。如有新增文档，请及时更新。

**最后更新**: 2026-03-08
**维护者**: Claude Code Assistant
