import { EditEventData, TEXT_FILE_EXTENSIONS } from '@overleaf-cc/shared';
import { MirrorClient } from '../client';

export class EditMonitor {
  private projectId: string;
  private mirrorClient: MirrorClient;
  private monitoring = false;
  private lastEditTime = 0;
  private readonly THROTTLE_MS = 100;

  constructor(projectId: string, mirrorClient: MirrorClient) {
    this.projectId = projectId;
    this.mirrorClient = mirrorClient;
  }

  start(): void {
    if (this.monitoring) return;
    this.monitoring = true;

    // 监听 Overleaf 的 doc:changed 事件
    window.addEventListener('doc:changed', this.handleDocChanged);

    console.log('[EditMonitor] Started monitoring document edits');
  }

  stop(): void {
    if (!this.monitoring) return;
    this.monitoring = false;

    window.removeEventListener('doc:changed', this.handleDocChanged);

    console.log('[EditMonitor] Stopped monitoring');
  }

  private handleDocChanged = (event: Event): void => {
    // 节流：100ms 内的重复触发只处理一次
    const now = Date.now();
    if (now - this.lastEditTime < this.THROTTLE_MS) {
      return;
    }
    this.lastEditTime = now;

    const customEvent = event as CustomEvent<{ id: string }>;
    const docId = customEvent.detail.id;

    // 获取文档对象
    const doc = this.getShareJsDoc(docId);
    if (!doc) {
      console.warn(`[EditMonitor] Document ${docId} not found`);
      return;
    }

    // 提取文档信息
    const docInfo = this.extractDocInfo(docId, doc);
    if (!docInfo) return;

    // 发送到 mirror server
    this.sendEditEvent(docInfo);
  }

  private getShareJsDoc(docId: string): any {
    const editor = (window as any).editor;
    if (!editor || !editor.sharejs_docs) {
      return null;
    }
    return editor.sharejs_docs[docId];
  }

  private extractDocInfo(docId: string, doc: any): EditEventData | null {
    try {
      // 1. 检查文档对象是否有效
      if (!doc || typeof doc.getVersion !== 'function') {
        console.warn(`[EditMonitor] Invalid doc object for ${docId}`);
        return null;
      }

      // 2. 获取版本号
      const version = doc.getVersion();
      if (typeof version !== 'number' || version < 0) {
        console.warn(`[EditMonitor] Invalid version: ${version}`);
        return null;
      }

      // 3. 获取文档名称
      const docName = this.getDocName(docId);

      // 4. 过滤文件扩展名
      const extension = this.getExtension(docName);
      if (!TEXT_FILE_EXTENSIONS.has(extension)) {
        // 静默跳过，不打印日志
        return null;
      }

      // 5. 获取 ops
      const ops = doc.getPendingOp() || doc.getInflightOp() || [];
      if (!Array.isArray(ops)) {
        console.warn(`[EditMonitor] Invalid ops for ${docId}`);
        return null;
      }

      return {
        doc_id: docId,
        doc_name: docName,
        version,
        ops,
        meta: {
          user_id: this.getCurrentUserId(),
          source: 'local',
          timestamp: Date.now()
        }
      };
    } catch (error) {
      console.error(`[EditMonitor] Error extracting doc info for ${docId}:`, error);
      return null;
    }
  }

  private getDocName(docId: string): string {
    const editor = (window as any).editor;
    const docs = editor?.docs;
    return docs?.[docId]?.name || `unknown-${docId}`;
  }

  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }

  private getCurrentUserId(): string {
    const editor = (window as any).editor;
    return editor?.user?.id || 'unknown';
  }

  private sendEditEvent(data: EditEventData): void {
    const message = {
      type: 'edit_event' as const,
      project_id: this.projectId,
      data
    };

    console.log('[EditMonitor] Sending edit event:', message);

    // TODO: Temporary workaround - MirrorClient.send() will be added in Task 6
    // Directly access the WebSocket for now
    this.sendMessageDirectly(message);
  }

  private sendMessageDirectly(message: any): void {
    // Access the private WebSocket directly via type assertion
    // This is a temporary workaround pending Task 6 implementation
    const client = this.mirrorClient as any;
    const ws = client.ws as WebSocket | null;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[EditMonitor] WebSocket is not connected');
      return;
    }

    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[EditMonitor] Failed to send message:', error);
    }
  }
}
