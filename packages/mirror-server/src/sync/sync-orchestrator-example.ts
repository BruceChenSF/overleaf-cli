/**
 * SyncOrchestrator 集成示例
 *
 * 这个文件展示了如何用 SyncOrchestrator 替换现有的复杂标记机制
 */

import { SyncOrchestrator, OperationSource, OperationType } from './sync-orchestrator';

// ============================================================
// 示例 1: 文件重命名（Overleaf → 本地）
// ============================================================

/**
 * 之前：复杂的标记机制
 */
async function handleFileRenamed_OLD(
  projectId: string,
  oldName: string,
  newName: string,
  syncManager: any, // OverleafSyncManager
  projectConfig: any
): Promise<void> {
  // 1. 标记旧文件正在重命名（分散在 syncManager 中）
  syncManager.markRenaming(oldName);

  // 2. 创建新文件名的标记文件（文件系统标记）
  const syncId = startFileSync(projectId, projectConfig.localPath, newName);

  // 3. 执行重命名
  fs.renameSync(oldPath, newPath);

  // 4. 等待 FileWatcher 确认
  endFileSync(syncId);

  // 5. 延迟清除重命名标记（hack!）
  setTimeout(() => {
    syncManager.clearRenaming(oldName);
  }, 2000); // 2秒 timeout
}

/**
 * 现在：使用 SyncOrchestrator（简洁清晰）
 */
async function handleFileRenamed_NEW(
  orchestrator: SyncOrchestrator,
  projectId: string,
  oldName: string,
  newName: string,
  projectConfig: any
): Promise<void> {
  // 1. 开始操作（orchestrator 自动追踪）
  const context = orchestrator.startOperation(
    'overleaf', // 来源：Overleaf
    'rename',
    newName,
    oldName,
    { projectId }
  );

  try {
    // 2. 执行重命名
    fs.renameSync(oldPath, newPath);

    // 3. 完成操作
    orchestrator.completeOperation(context.operationId);
  } catch (error) {
    // 4. 失败时标记
    orchestrator.failOperation(context.operationId, error);
    throw error;
  }
}

// ============================================================
// 示例 2: FileWatcher 检测到文件删除
// ============================================================

/**
 * 之前：需要检查多个标记
 */
function handleFileDelete_OLD(
  path: string,
  syncManager: any, // OverleafSyncManager
  projectId: string
): boolean {
  // 检查 1: 是否在重命名中？
  if (syncManager.isRenaming(path)) {
    console.log('Ignoring delete for renaming file');
    syncManager.clearRenaming(path);
    return false;
  }

  // 检查 2: 是否有 .syncing 标记文件？
  const syncId = isFileBeingSynced(projectDir, path);
  if (syncId) {
    console.log('Ignoring server delete');
    acknowledgeFileSync(syncId);
    return false;
  }

  // 检查 3: ... 其他各种检查 ...

  // 允许处理删除
  return true;
}

/**
 * 现在：统一的事件过滤
 */
function handleFileDelete_NEW(
  orchestrator: SyncOrchestrator,
  path: string
): boolean {
  // 统一的过滤逻辑
  const result = orchestrator.shouldProcessEvent(
    'local', // 来源：本地文件系统
    'delete',
    path
  );

  if (!result.shouldProcess) {
    console.log(`Ignoring delete: ${result.reason}`);
    if (result.relatedOperation) {
      console.log(`Related operation: ${result.relatedOperation.operationId}`);
    }
    return false;
  }

  return true;
}

// ============================================================
// 示例 3: 完整的重命名流程（带注释）
// ============================================================

async function completeRenameFlow(
  orchestrator: SyncOrchestrator,
  projectId: string,
  oldName: string,
  newName: string
): Promise<void> {
  console.log(`=== Starting rename: ${oldName} → ${newName} ===`);

  // 步骤 1: Overleaf 触发重命名
  const context = orchestrator.startOperation(
    'overleaf',
    'rename',
    newName,
    oldName,
    { projectId }
  );
  console.log(`[Orchestrator] Started operation: ${context.operationId}`);

  // 步骤 2: 执行本地重命名
  console.log(`[Server] Renaming local file...`);
  fs.renameSync(oldPath, newPath);
  console.log(`[Server] Rename completed`);

  // 步骤 3: FileWatcher 检测到变化
  console.log(`[FileWatcher] Detected file changes...`);

  // 步骤 3a: 检测到旧文件删除
  const deleteResult = orchestrator.shouldProcessEvent('local', 'delete', oldName);
  console.log(`[FileWatcher] Delete event for ${oldName}: ${deleteResult.shouldProcess ? 'ALLOWED' : 'BLOCKED'}`);
  console.log(`[FileWatcher] Reason: ${deleteResult.reason}`);

  // 步骤 3b: 检测到新文件创建
  const createResult = orchestrator.shouldProcessEvent('local', 'create', newName);
  console.log(`[FileWatcher] Create event for ${newName}: ${createResult.shouldProcess ? 'ALLOWED' : 'BLOCKED'}`);
  console.log(`[FileWatcher] Reason: ${createResult.reason}`);

  // 步骤 4: 完成操作
  orchestrator.completeOperation(context.operationId);
  console.log(`[Orchestrator] Completed operation: ${context.operationId}`);
  console.log(`=== Rename flow complete ===`);
}

// ============================================================
// 示例 4: 集成到现有代码
// ============================================================

/**
 * 在 MirrorServer 类中添加 SyncOrchestrator
 */
class MirrorServer_WithOrchestrator {
  private orchestrator: SyncOrchestrator;

  constructor() {
    // 创建编排器实例
    this.orchestrator = new SyncOrchestrator({
      operationTimeout: 30000,
      enableDebugLogging: true
    });
  }

  /**
   * 处理来自 Overleaf 的文件重命名
   */
  private handleFileRenamed(
    projectId: string,
    oldName: string,
    newName: string
  ): void {
    // 使用编排器追踪操作
    const context = this.orchestrator.startOperation(
      'overleaf',
      'rename',
      newName,
      oldName,
      { projectId }
    );

    try {
      console.log('[Server] Renaming file:', oldName, '->', newName);
      const projectConfig = this.configStore.getProjectConfig(projectId);
      const oldPath = path.join(projectConfig.localPath, oldName);
      const newPath = path.join(projectConfig.localPath, newName);

      // 检查文件是否存在
      if (!fs.existsSync(oldPath)) {
        console.log('[Server] ⚠️ Old file not found:', oldPath);
        this.orchestrator.failOperation(context.operationId);
        return;
      }

      // 执行重命名
      fs.renameSync(oldPath, newPath);
      console.log('[Server] ✅ Renamed file:', oldName, '->', newName);

      // 更新映射
      const syncManager = this.syncManagers.get(projectId);
      if (syncManager) {
        syncManager.updateMapping(newName, context.operationId); // 使用 operationId 作为临时标识
      }

      // 完成操作
      this.orchestrator.completeOperation(context.operationId);
    } catch (error) {
      console.error('[Server] ❌ Failed to rename file:', error);
      this.orchestrator.failOperation(context.operationId, error);
    }
  }

  /**
   * FileWatcher 检测到文件变化时的处理
   */
  private onFileWatcherEvent(
    projectId: string,
    type: OperationType,
    path: string,
    oldPath?: string
  ): void {
    // 使用编排器过滤事件
    const result = this.orchestrator.shouldProcessEvent(
      'local',
      type,
      path,
      oldPath
    );

    if (!result.shouldProcess) {
      console.log(`[FileWatcher] Event ignored: ${result.reason}`);
      return;
    }

    // 事件通过过滤，继续处理
    console.log(`[FileWatcher] Event allowed: ${type} ${path}`);

    // 开始本地同步操作
    const context = this.orchestrator.startOperation(
      'local',
      type,
      path,
      oldPath,
      { projectId }
    );

    // 继续原有的同步逻辑...
    // this.syncToOverleaf(...);
  }
}

// ============================================================
// 优势总结
// ============================================================

/**
 * 1. 集中化管理
 *    - 所有操作追踪在一个地方
 *    - 不需要分散的标记文件和内存 Set
 *
 * 2. 清晰的过滤规则
 *    - shouldProcessEvent() 提供统一的过滤逻辑
 *    - 规则明确，易于理解和调试
 *
 * 3. 无需 timeout hack
 *    - 不需要 2 秒 timeout 清除标记
 *    - 操作完成立即清除
 *
 * 4. 更好的调试能力
 *    - 可以查看所有活跃操作
 *    - 每个事件都有明确的拒绝原因
 *
 * 5. 类型安全
 *    - TypeScript 类型定义
 *    - 编译时检查
 *
 * 6. 易于扩展
 *    - 添加新规则只需修改 shouldProcessEvent()
 *    - 不需要修改多处代码
 */
