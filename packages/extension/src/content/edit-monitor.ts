import { EditEventData, TEXT_FILE_EXTENSIONS } from '@overleaf-cc/shared';
import { MirrorClient } from '../client';

/**
 * EditMonitor - Overleaf 编辑监听器
 *
 * 通过劫持 WebSocket 监听 Overleaf 的编辑操作，
 * 提取 OT 操作并发送到 Mirror Server。
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

  constructor(projectId: string, mirrorClient: MirrorClient) {
    this.projectId = projectId;
    this.mirrorClient = mirrorClient;
  }

  /**
   * 启动编辑监听
   *
   * 注入页面脚本来劫持 WebSocket。
   *
   * @returns Promise<void>
   */
  async start(): Promise<void> {
    if (this.monitoring) {
      console.warn('[EditMonitor] Already monitoring');
      throw new Error('[EditMonitor] Already monitoring');
    }

    console.log('[EditMonitor] 🚀 Starting edit monitoring...');

    try {
      // 设置 WebSocket 消息监听
      this.setupWebSocketMonitor();

      this.monitoring = true;
      console.log('[EditMonitor] ✅ Monitoring started successfully');

    } catch (error) {
      console.error('[EditMonitor] ❌ Failed to start:', error);
      throw error;
    }
  }

  /**
   * 停止编辑监听
   */
  stop(): void {
    if (!this.monitoring) return;
    this.monitoring = false;
    console.log('[EditMonitor] Stopped monitoring');
  }

  /**
   * 设置 WebSocket 消息监听
   *
   * 注入页面脚本来劫持 WebSocket.send()。
   *
   * @private
   */
  private setupWebSocketMonitor(): void {
    console.log('[EditMonitor] 🔌 Setting up WebSocket monitoring (via page script)...');

    // 检查是否已经注入
    if (document.getElementById('__overleaf_cc_socket_hook_loaded__')) {
      console.log('[EditMonitor] Socket hook already loaded');
      return;
    }

    // 创建标记
    const marker = document.createElement('div');
    marker.id = '__overleaf_cc_socket_hook_loaded__';
    marker.style.display = 'none';
    document.body.appendChild(marker);

    // 监听来自页面脚本的消息
    window.addEventListener('message', (event) => {
      // 安全检查
      if (event.source !== window) return;

      const { type, data } = event.data;

      if (type === 'OVERLEAF_CC_EDIT_EVENT') {
        console.log('[EditMonitor] 📨 Received edit event from page script:', data);
        this.handleEditEvent(data);
      }
    });

    // 注入页面脚本
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dist/edit-monitor-bridge.js');
    script.onload = () => {
      console.log('[EditMonitor] ✅ Page script loaded');
      script.remove();
    };
    script.onerror = () => {
      console.error('[EditMonitor] ❌ Failed to load page script');
      script.remove();
    };

    (document.head || document.documentElement).appendChild(script);
  }

  /**
   * 处理编辑事件
   *
   * @param data - 编辑事件数据
   * @private
   */
  private handleEditEvent(data: any): void {
    try {
      const { doc_id, ops, version } = data;

      if (!ops || !Array.isArray(ops)) {
        console.warn('[EditMonitor] ⚠️ Invalid ops in event:', data);
        return;
      }

      // 获取文档名称
      const docName = this.getDocName();

      // 检查文件扩展名
      const extension = this.getExtension(docName);
      if (!TEXT_FILE_EXTENSIONS.has(extension)) {
        console.log(`[EditMonitor] ⏭️ Skipped (extension not in whitelist): ${extension}`);
        return;
      }

      // 构造编辑事件数据
      const editData: EditEventData = {
        doc_id: doc_id,
        doc_name: docName,
        version: version || Date.now(),
        ops: ops,
        meta: {
          user_id: this.getCurrentUserId(),
          source: 'local',
          timestamp: Date.now()
        }
      };

      // 构造消息
      const message = {
        type: 'edit_event' as const,
        project_id: this.projectId,
        data: editData
      };

      console.log('[EditMonitor] 📤 Forwarding edit event to Mirror Server');

      // 通过 WebSocket 发送到 Mirror Server
      this.mirrorClient.send(message);
      console.log('[EditMonitor] ✅ Edit event sent successfully');

    } catch (error) {
      console.error('[EditMonitor] ❌ Error handling edit event:', error);
    }
  }

  /**
   * 获取当前文档名称
   *
   * @returns string
   * @private
   */
  private getDocName(): string {
    // 从 URL 路径提取文件名
    const urlPath = window.location.pathname;
    const match = urlPath.match(/\/project\/[^/]+\/(.+)$/);
    if (match && match[1]) {
      return match[1];
    }
    return 'document.tex';
  }

  /**
   * 获取当前用户 ID
   *
   * @returns string
   * @private
   */
  private getCurrentUserId(): string {
    // 尝试从 localStorage 获取
    try {
      const userInfo = localStorage.getItem('user');
      if (userInfo) {
        const user = JSON.parse(userInfo);
        if (user.id) return user.id;
        if (user._id) return user._id;
      }
    } catch (e) {
      // 忽略
    }

    // 从 URL 路径获取
    const urlPath = window.location.pathname;
    const userMatch = urlPath.match(/\/user\/([^\\/]+)/);
    if (userMatch && userMatch[1]) {
      return userMatch[1];
    }

    return 'unknown';
  }

  /**
   * 获取文件扩展名
   *
   * @param filename - 文件名
   * @returns 扩展名（包含点号，如 '.tex'）
   * @private
   */
  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }
}
