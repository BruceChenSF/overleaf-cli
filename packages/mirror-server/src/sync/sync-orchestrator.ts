/**
 * SyncOrchestrator - 中心化同步编排器
 *
 * 核心功能：
 * 1. 追踪所有正在进行的同步操作
 * 2. 防止循环同步（通过操作来源追踪）
 * 3. 提供清晰的状态转换
 * 4. 简化事件过滤逻辑
 *
 * 替代了之前的分散标记机制：
 * - ❌ .syncing 文件标记
 * - ❌ renamingFiles Set
 * - ❌ FileWatcher 停止/重启
 * - ❌ 各种 timeout hack
 */

export type OperationSource = 'overleaf' | 'local';

export type OperationType = 'create' | 'update' | 'delete' | 'rename';

export type OperationStatus = 'pending' | 'executing' | 'completed' | 'failed';

/**
 * 操作上下文 - 追踪单个同步操作的状态
 */
export interface OperationContext {
  operationId: string;
  source: OperationSource;
  type: OperationType;
  path: string;
  oldPath?: string; // For rename operations
  status: OperationStatus;
  createdAt: number;
  metadata?: Record<string, any>;
}

/**
 * 编排器配置
 */
export interface OrchestratorConfig {
  operationTimeout?: number; // 操作超时时间（默认 30 秒）
  enableDebugLogging?: boolean;
}

/**
 * 事件过滤结果
 */
export interface EventFilterResult {
  shouldProcess: boolean;
  reason?: string;
  relatedOperation?: OperationContext;
}

/**
 * SyncOrchestrator 类
 */
export class SyncOrchestrator {
  private operations = new Map<string, OperationContext>();
  private pathToOperation = new Map<string, string>(); // path -> operationId
  private config: Required<OrchestratorConfig>;

  constructor(config: OrchestratorConfig = {}) {
    this.config = {
      operationTimeout: config.operationTimeout || 30000,
      enableDebugLogging: config.enableDebugLogging ?? true
    };

    // 定期清理超时的操作
    setInterval(() => {
      this.cleanupTimeoutOperations();
    }, 5000);
  }

  /**
   * 开始一个同步操作
   *
   * @param source - 操作来源
   * @param type - 操作类型
   * @param path - 文件路径
   * @param oldPath - 旧路径（重命名操作）
   * @returns 操作上下文
   */
  startOperation(
    source: OperationSource,
    type: OperationType,
    path: string,
    oldPath?: string,
    metadata?: Record<string, any>
  ): OperationContext {
    const operationId = this.generateOperationId(source, type, path);

    const context: OperationContext = {
      operationId,
      source,
      type,
      path,
      oldPath,
      status: 'executing',
      createdAt: Date.now(),
      metadata
    };

    this.operations.set(operationId, context);
    this.pathToOperation.set(path, operationId);

    // For rename operations, also track the old path
    if (oldPath) {
      this.pathToOperation.set(oldPath, operationId);
    }

    this.log(`🚀 Started operation: ${this.formatOperation(context)}`);

    return context;
  }

  /**
   * 完成一个同步操作
   *
   * @param operationId - 操作 ID
   */
  completeOperation(operationId: string): void {
    const context = this.operations.get(operationId);
    if (!context) {
      this.log(`⚠️ Cannot complete unknown operation: ${operationId}`);
      return;
    }

    context.status = 'completed';

    // Clean up path mappings
    this.pathToOperation.delete(context.path);
    if (context.oldPath) {
      this.pathToOperation.delete(context.oldPath);
    }

    this.log(`✅ Completed operation: ${this.formatOperation(context)}`);

    // Remove from operations map after a short delay (for debugging)
    setTimeout(() => {
      this.operations.delete(operationId);
    }, 5000);
  }

  /**
   * 标记操作失败
   *
   * @param operationId - 操作 ID
   * @param error - 错误信息
   */
  failOperation(operationId: string, error?: Error): void {
    const context = this.operations.get(operationId);
    if (!context) {
      this.log(`⚠️ Cannot fail unknown operation: ${operationId}`);
      return;
    }

    context.status = 'failed';
    context.metadata = context.metadata || {};
    context.metadata.error = error?.message;

    // Clean up path mappings
    this.pathToOperation.delete(context.path);
    if (context.oldPath) {
      this.pathToOperation.delete(context.oldPath);
    }

    this.log(`❌ Failed operation: ${this.formatOperation(context)}`);

    // Remove from operations map after a short delay
    setTimeout(() => {
      this.operations.delete(operationId);
    }, 5000);
  }

  /**
   * 检查事件是否应该被处理（防止循环同步）
   *
   * 核心逻辑：
   * 1. 如果事件来源与正在进行的操作来源相同，拒绝（防止自己触发自己）
   * 2. 如果事件相关路径正在被处理，检查操作类型和来源
   * 3. 根据规则决定是否处理该事件
   *
   * @param source - 事件来源
   * @param type - 事件类型
   * @param path - 文件路径
   * @param oldPath - 旧路径（重命名操作）
   * @returns 过滤结果
   */
  shouldProcessEvent(
    source: OperationSource,
    type: OperationType,
    path: string,
    oldPath?: string
  ): EventFilterResult {
    // 检查当前路径是否有正在进行的操作
    const operationId = this.pathToOperation.get(path);
    const oldPathOperationId = oldPath ? this.pathToOperation.get(oldPath) : null;

    // 如果没有相关操作，允许处理
    if (!operationId && !oldPathOperationId) {
      return { shouldProcess: true, reason: 'No conflicting operation' };
    }

    // 获取相关的操作上下文
    const relatedOperation = operationId
      ? this.operations.get(operationId)
      : this.operations.get(oldPathOperationId!);

    if (!relatedOperation) {
      return { shouldProcess: true, reason: 'Operation context not found' };
    }

    // 规则 1: 相同来源的事件应该被忽略（防止循环）
    if (relatedOperation.source === source) {
      return {
        shouldProcess: false,
        reason: `Same source (${source}) - preventing circular sync`,
        relatedOperation
      };
    }

    // 规则 2: 特殊处理重命名操作
    if (relatedOperation.type === 'rename') {
      // 如果是重命名的删除事件，忽略（FileWatcher 检测到的旧文件删除）
      if (type === 'delete' && path === relatedOperation.oldPath) {
        return {
          shouldProcess: false,
          reason: 'Delete event during rename - ignored',
          relatedOperation
        };
      }

      // 如果是重命名后新文件的创建/更新事件，忽略（FileWatcher 检测到的新文件）
      if (type === 'create' || type === 'update') {
        if (path === relatedOperation.path) {
          return {
            shouldProcess: false,
            reason: 'File event during rename - ignored',
            relatedOperation
          };
        }
      }
    }

    // 规则 3: 如果操作已经完成，允许处理新事件
    if (relatedOperation.status === 'completed' || relatedOperation.status === 'failed') {
      return { shouldProcess: true, reason: 'Previous operation completed' };
    }

    // 默认：如果正在执行中，暂不处理
    return {
      shouldProcess: false,
      reason: `Operation in progress (${relatedOperation.status})`,
      relatedOperation
    };
  }

  /**
   * 获取当前所有活跃的操作
   */
  getActiveOperations(): OperationContext[] {
    return Array.from(this.operations.values()).filter(
      op => op.status === 'executing'
    );
  }

  /**
   * 获取指定路径的操作
   */
  getOperationForPath(path: string): OperationContext | undefined {
    const operationId = this.pathToOperation.get(path);
    return operationId ? this.operations.get(operationId) : undefined;
  }

  /**
   * 清理超时的操作
   */
  private cleanupTimeoutOperations(): void {
    const now = Date.now();
    const timeoutOps: string[] = [];

    for (const [id, context] of this.operations.entries()) {
      if (context.status === 'executing' &&
          now - context.createdAt > this.config.operationTimeout) {
        timeoutOps.push(id);
      }
    }

    for (const id of timeoutOps) {
      this.failOperation(id, new Error('Operation timeout'));
      this.log(`⏱️ Cleaned up timeout operation: ${id}`);
    }
  }

  /**
   * 生成唯一的操作 ID
   */
  private generateOperationId(
    source: OperationSource,
    type: OperationType,
    path: string
  ): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${source}-${type}-${path.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}-${random}`;
  }

  /**
   * 格式化操作信息用于日志
   */
  private formatOperation(context: OperationContext): string {
    const base = `${context.source}:${context.type}(${context.path})`;
    if (context.oldPath) {
      return `${base} [${context.oldPath} → ${context.path}]`;
    }
    return base;
  }

  /**
   * 日志输出
   */
  private log(message: string): void {
    if (this.config.enableDebugLogging) {
      console.log(`[SyncOrchestrator] ${message}`);
    }
  }

  /**
   * 清理所有操作（用于测试或重置）
   */
  clear(): void {
    this.operations.clear();
    this.pathToOperation.clear();
    this.log('🧹 Cleared all operations');
  }
}
