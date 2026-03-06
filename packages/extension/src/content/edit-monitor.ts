import { EditEventData, TEXT_FILE_EXTENSIONS, AnyOperation } from '@overleaf-cc/shared';
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

    // 方案1: 拦截 WebSocket（在连接建立前）
    this.interceptWebSocket();

    // 方案2: 监听 doc:changed 事件
    window.addEventListener('doc:changed', this.handleDocChanged);

    // 方案3: 拦截 fetch 和 XHR（捕获 HTTP 请求）
    this.interceptNetworkRequests();

    console.log('[EditMonitor] Started monitoring with multiple strategies');
  }

  stop(): void {
    if (!this.monitoring) return;
    this.monitoring = false;

    window.removeEventListener('doc:changed', this.handleDocChanged);

    console.log('[EditMonitor] Stopped monitoring');
  }

  /**
   * 处理 doc:changed 事件（简化版）
   * 直接记录编辑事件，不尝试访问内部对象
   */
  private handleDocChanged = (event: Event): void => {
    const now = Date.now();
    if (now - this.lastEditTime < this.THROTTLE_MS) {
      return;
    }
    this.lastEditTime = now;

    const customEvent = event as CustomEvent<{ id: string }>;
    const docId = customEvent.detail.id;

    console.log('[EditMonitor] doc:changed event:', docId);

    // 提取基本信息并发送
    this.processEditEvent(docId, [], Date.now());
  }

  /**
   * 拦截 WebSocket 构造函数
   * 必须在页面加载前执行
   */
  private interceptWebSocket(): void {
    const OriginalWebSocket = (window as any).WebSocket;

    (window as any).WebSocket = function(url: string, protocols?: string | string[]) {
      console.log('[EditMonitor] WebSocket connecting to:', url);

      const ws = new OriginalWebSocket(url, protocols);

      // 拦截 send 方法
      const originalSend = ws.send.bind(ws);
      ws.send = function(data: any) {
        console.log('[EditMonitor] WebSocket sending:', data);

        // 尝试解析数据
        try {
          const parsed = JSON.parse(data);
          console.log('[EditMonitor] WebSocket data parsed:', parsed);

          // 如果是编辑相关的消息
          if (parsed.doc_id || parsed.docId || parsed.ops) {
            console.log('[EditMonitor] 🎯 Captured edit operation via WebSocket!');
            // 这里可以进一步处理
          }
        } catch (e) {
          // 不是 JSON
        }

        return originalSend(data);
      };

      return ws;
    };

    // 复制原型和常量
    (window as any).WebSocket.prototype = OriginalWebSocket.prototype;
    (window as any).WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    (window as any).WebSocket.OPEN = OriginalWebSocket.OPEN;
    (window as any).WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    (window as any).WebSocket.CLOSED = OriginalWebSocket.CLOSED;

    console.log('[EditMonitor] WebSocket interceptor installed');
  }

  /**
   * 拦截网络请求（fetch 和 XMLHttpRequest）
   */
  private interceptNetworkRequests(): void {
    // 拦截 fetch
    const originalFetch = window.fetch;
    window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.includes('/project/') || url.includes('/doc/') || url.includes('/document/')) {
        console.log('[EditMonitor] Fetch request:', url, init);
      }

      return originalFetch.apply(this, [input, init]);
    };

    // 拦截 XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method: string, url: string | URL) {
      this._url = url.toString();

      if (url.toString().includes('/project/') || url.toString().includes('/doc/')) {
        console.log('[EditMonitor] XHR request:', method, url);
      }

      return originalXHROpen.apply(this, [method, url]);
    };

    XMLHttpRequest.prototype.send = function(body?: Document | BodyInit | null) {
      if (this._url && (this._url.includes('/project/') || this._url.includes('/doc/'))) {
        console.log('[EditMonitor] XHR body:', body);
      }

      return originalXHRSend.apply(this, [body]);
    };

    console.log('[EditMonitor] Network request interceptor installed');
  }

  /**
   * 处理编辑事件并提取文档信息
   */
  private processEditEvent(docId: string, ops: AnyOperation[], version: number): void {
    // 从 localStorage 或 DOM 获取文件名
    const docName = this.getDocNameFromDocId(docId);

    console.log('[EditMonitor] Processing edit event:', {
      docId,
      docName,
      ops,
      version
    });

    // 过滤文件扩展名
    const extension = this.getExtension(docName);
    console.log('[EditMonitor] File extension:', extension);

    if (!TEXT_FILE_EXTENSIONS.has(extension)) {
      // 静默跳过非文本文件
      console.log('[EditMonitor] Skipped (extension not in whitelist):', extension);
      return;
    }

    // 构造编辑事件数据
    const editData: EditEventData = {
      doc_id: docId,
      doc_name: docName,
      version: version,
      ops: ops,
      meta: {
        user_id: this.getCurrentUserId(),
        source: 'local',
        timestamp: Date.now()
      }
    };

    // 发送到 Mirror Server
    this.sendEditEvent(editData);
  }

  /**
   * 从 docId 获取文件名
   * 方法1: 从 DOM 中选中的文件
   * 方法2: 从 localStorage 推断
   */
  private getDocNameFromDocId(docId: string): string {
    // 方法1: 查找有 'selected' 类的文件名元素
    const selectedElements = document.querySelectorAll('.selected, [class*="selected"]');

    for (let i = 0; i < selectedElements.length; i++) {
      const el = selectedElements[i];
      const text = el.textContent ? el.textContent.trim() : '';

      // 查找包含 .tex 的短文本
      if (text && text.includes('.tex') && text.length < 50) {
        // 提取文件名（去除菜单文字等）
        const match = text.match(/([a-zA-Z0-9_-]+\.tex)/);
        if (match) {
          console.log('[EditMonitor] Extracted filename from selected element:', match[1]);
          return match[1];
        }
      }
    }

    // 方法2: 从 localStorage 的 doc.open_id 获取当前打开的 docId，然后匹配
    try {
      const projectId = this.projectId;
      const openDocKey = `doc.open_id.${projectId}`;
      const openDocId = localStorage.getItem(openDocKey);

      if (openDocId === docId) {
        // 当前打开的文档，尝试查找匹配的文件名
        console.log('[EditMonitor] Current doc matches open doc:', docId);

        // 从所有包含 .tex 的元素中查找
        const allSpans = document.querySelectorAll('span');
        for (let i = 0; i < allSpans.length; i++) {
          const span = allSpans[i];
          const text = span.textContent ? span.textContent.trim() : '';

          // 检查是否在有 selected 类的父元素中
          let parent = span.parentElement;
          let hasSelectedParent = false;
          let depth = 0;

          while (parent && depth < 5) {
            if (parent.className && parent.className.includes('selected')) {
              hasSelectedParent = true;
              break;
            }
            parent = parent.parentElement;
            depth++;
          }

          if (hasSelectedParent && text && text.includes('.tex') && text.length < 50) {
            const match = text.match(/([a-zA-Z0-9_-]+\.tex)/);
            if (match) {
              console.log('[EditMonitor] Extracted filename from selected parent:', match[1]);
              return match[1];
            }
          }
        }
      }
    } catch (e) {
      console.error('[EditMonitor] Error accessing localStorage:', e);
    }

    // 方法3: 最后的备用方案
    console.log('[EditMonitor] Using default filename');
    return 'document.tex';
  }

  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }

  private getCurrentUserId(): string {
    // 尝试从多个可能的位置获取用户 ID
    // 1. 从 localStorage（Overleaf 可能存储用户信息）
    try {
      const userInfo = localStorage.getItem('user');
      if (userInfo) {
        const user = JSON.parse(userInfo);
        if (user.id) return user.id;
        if (user._id) return user._id;
      }
    } catch (e) {
      // 忽略解析错误
    }

    // 2. 从 URL 路径（如果包含用户信息）
    const urlPath = window.location.pathname;
    const userMatch = urlPath.match(/\/user\/([^\/]+)/);
    if (userMatch && userMatch[1]) {
      return userMatch[1];
    }

    // 3. 检查全局变量（新编辑器可能使用不同的变量名）
    const possibleKeys = ['currentUser', 'user', 'ide_user', 'overleaf_user'];
    for (const key of possibleKeys) {
      const obj = (window as any)[key];
      if (obj?.id) return obj.id;
      if (obj?._id) return obj._id;
    }

    return 'unknown';
  }


  private sendEditEvent(data: EditEventData): void {
    const message = {
      type: 'edit_event' as const,
      project_id: this.projectId,
      data
    };

    console.log('[EditMonitor] Sending edit event:', JSON.stringify(message, null, 2));

    // 通过 WebSocket 发送到 mirror server
    try {
      this.mirrorClient.send(message);
      console.log('[EditMonitor] ✅ Send successful');
    } catch (error) {
      console.error('[EditMonitor] ❌ Send failed:', error);
    }
  }
}
