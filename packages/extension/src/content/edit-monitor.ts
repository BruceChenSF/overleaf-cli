import { EditEventData } from '@overleaf-cc/shared';
import { MirrorClient } from '../client';

/**
 * EditMonitor - Overleaf CodeMirror 6 编辑监听器
 *
 * 监听 Overleaf 新编辑器（CodeMirror 6）的编辑操作，
 * 提取精确的 OT 操作并发送到 Mirror Server。
 *
 * @class
 * @example
 * ```typescript
 * const monitor = new EditMonitor(projectId, mirrorClient);
 * await monitor.start();
 * // ... 监听编辑 ...
 * monitor.stop();
 * ```
 */
export class EditMonitor {
  private projectId: string;
  private mirrorClient: MirrorClient;
  private monitoring = false;
  private editorView: any | null = null;
  private mutationObserver: MutationObserver | null = null;
  private readonly DETECTION_TIMEOUT = 5000; // 5秒超时

  constructor(projectId: string, mirrorClient: MirrorClient) {
    this.projectId = projectId;
    this.mirrorClient = mirrorClient;
  }

  /**
   * 立即查找 EditorView 实例
   *
   * 尝试从已存在的 DOM 元素中获取 EditorView。
   *
   * @returns EditorView | null
   * @private
   */
  private findEditorViewImmediate(): any | null {
    // 方法 1: 通过 .cm-content.cmView.view（用户验证的路径）
    const cmContent = document.querySelector('.cm-content');
    const view = (cmContent as any)?.cmView?.view;

    if (view && this.validateEditorView(view)) {
      console.log('[EditMonitor] Found EditorView via .cm-content.cmView.view');
      return view;
    }

    // 方法 2: 尝试其他可能的路径（备用）
    const cmEditor = document.querySelector('.cm-editor');
    const altView = (cmEditor as any)?.__cm_view || (cmEditor as any)?.cmView;

    if (altView && this.validateEditorView(altView)) {
      console.log('[EditMonitor] Found EditorView via .cm-editor.__cm_view');
      return altView;
    }

    return null;
  }

  /**
   * 验证 EditorView 实例的有效性
   *
   * @param view - 待验证的对象
   * @returns boolean
   * @private
   */
  private validateEditorView(view: any): boolean {
    return (
      view &&
      typeof view.state === 'object' &&
      typeof view.dispatch === 'function' &&
      typeof view.state.doc === 'object' &&
      typeof view.state.doc.toString === 'function'
    );
  }

  /**
   * 启动编辑监听
   *
   * 检测 CodeMirror 6 EditorView 实例并设置监听器。
   * 超时时间：5 秒
   *
   * @returns Promise<void>
   */
  async start(): Promise<void> {
    if (this.monitoring) {
      console.warn('[EditMonitor] Already monitoring');
      throw new Error('[EditMonitor] Already monitoring');
    }

    console.log('[EditMonitor] Starting CodeMirror 6 detection...');

    try {
      // 检测 EditorView
      const editorView = await this.detectEditorView();

      if (!editorView) {
        console.warn('[EditMonitor] Failed to detect CodeMirror 6 EditorView');
        return;
      }

      this.editorView = editorView;
      console.log('[EditMonitor] ✅ EditorView detected successfully');

      // 设置 transaction 监听器
      this.setupTransactionListener();

      this.monitoring = true;
      console.log('[EditMonitor] Started monitoring');

    } catch (error) {
      console.error('[EditMonitor] Failed to start:', error);
      throw error;
    }
  }

  /**
   * 停止编辑监听
   */
  stop(): void {
    if (!this.monitoring) return;
    this.monitoring = false;

    // 停止 MutationObserver
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }

    // 清理 EditorView 引用
    this.editorView = null;

    console.log('[EditMonitor] Stopped monitoring');
  }

  /**
   * 检测 CodeMirror 6 EditorView 实例
   *
   * 通过 MutationObserver 监听 DOM 变化，检测 .cm-content 元素的创建。
   * 超时时间：5 秒
   *
   * @returns Promise<EditorView | null> EditorView 实例或 null（检测失败）
   * @private
   */
  private detectEditorView(): Promise<any | null> {
    return new Promise((resolve) => {
      // 阶段 1: 立即检查
      const immediateView = this.findEditorViewImmediate();
      if (immediateView) {
        resolve(immediateView);
        return;
      }

      console.log('[EditMonitor] EditorView not found immediately, starting MutationObserver...');

      // 阶段 2: 启动 MutationObserver
      const observer = new MutationObserver(() => {
        const view = this.findEditorViewImmediate();
        if (view) {
          console.log('[EditMonitor] EditorView detected via MutationObserver');
          observer.disconnect();
          this.mutationObserver = null;
          resolve(view);
        }
      });

      // 监听整个 document.body
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      this.mutationObserver = observer;

      // 阶段 3: 超时处理
      setTimeout(() => {
        if (this.mutationObserver) {
          observer.disconnect();
          this.mutationObserver = null;
          console.warn('[EditMonitor] EditorView detection timeout (5s)');
          resolve(null);
        }
      }, this.DETECTION_TIMEOUT);
    });
  }

  /**
   * 设置 transaction 监听器
   *
   * 注册 CodeMirror 6 的 StateField.updateListener 来监听编辑事务。
   *
   * @private
   */
  private setupTransactionListener(): void {
    if (!this.editorView) {
      console.error('[EditMonitor] Cannot setup listener: no EditorView');
      return;
    }

    console.log('[EditMonitor] Setting up transaction listener...');

    // TODO: 实现实际的监听器注册
    // 这需要根据 CodeMirror 6 的实际 API 来实现
    // 可能需要劫持 EditorState 或者使用插件系统

    console.log('[EditMonitor] Transaction listener setup complete');
  }

  /**
   * 处理编辑事务
   *
   * @param transaction - CodeMirror transaction 对象
   * @private
   */
  private handleTransaction(transaction: Transaction): void {
    try {
      // 1. 过滤：跳过没有实际变更的 transaction
      if (!transaction.docChanged) {
        return;
      }

      console.log('[EditMonitor] Transaction detected, docChanged=true');

      // 2. 提取变更
      const changes = transaction.changes;
      if (!changes) {
        console.warn('[EditMonitor] No changes in transaction');
        return;
      }

      // TODO: 转换为 ops
      // const ops = this.convertChangesToOps(changes, transaction.startState);

      // TODO: 发送编辑事件
      // this.sendEditEvent(ops, this.getTransactionSource(transaction));

    } catch (error) {
      console.error('[EditMonitor] Error handling transaction:', error);
    }
  }

  /**
   * 判断 transaction 的来源（本地或远程）
   *
   * @param transaction - CodeMirror transaction 对象
   * @returns 'local' | 'remote'
   * @private
   */
  private getTransactionSource(transaction: Transaction): 'local' | 'remote' {
    // 检查是否有用户交互事件
    if (transaction.isUserEvent) {
      const hasUserEvent = transaction.isUserEvent("input") ||
                           transaction.isUserEvent("paste") ||
                           transaction.isUserEvent("delete");
      if (hasUserEvent) {
        return 'local';
      }
    }

    // 默认为远程
    return 'remote';
  }
}
