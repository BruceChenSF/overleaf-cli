/**
 * Overleaf WebSocket Client for Node.js
 * Connects to Overleaf's WebSocket API to fetch file structure and content
 */

import WebSocket from 'ws';
import fetch from 'node-fetch';

interface OverleafAuth {
  cookieOverleafSession2: string;
  cookieGCLB?: string;
}

interface OverleafDoc {
  _id: string;
  name: string;
}

interface OverleafFileRef {
  _id: string;
  name: string;
  created: string;
  hash: string;
}

interface OverleafFolder {
  _id: string;
  name: string;
  folders: OverleafFolder[];
  fileRefs: OverleafFileRef[];
  docs: OverleafDoc[];
}

interface OverleafProject {
  _id: string;
  name: string;
  rootDoc_id: string;
  rootFolder: OverleafFolder[];
}

interface OverleafJoinProjectResponse {
  permissionLevel: string;
  project: OverleafProject;
  protocolVersion: number;
  publicId: string;
}

interface DocInfo {
  id: string;
  path: string;
  name: string;
  type: 'doc' | 'file';
  hash?: string;
}

/**
 * Overleaf WebSocket Client
 * Connects to Overleaf's WebSocket API to fetch all file contents
 */
export class OverleafWebSocketClient {
  private ws: WebSocket | null = null;
  private messageSeq = 0;
  private pendingRequests = new Map<number, (response: any) => void>();
  private docIdToPath = new Map<string, DocInfo>();
  private projectJoined = false;
  private baseUrl: string;
  private messageCount = 0; // Track total messages received

  constructor(
    private projectId: string,
    private auth: OverleafAuth,
    private csrfToken: string,
    domain: string = 'cn.overleaf.com'
  ) {
    this.baseUrl = `https://${domain}`;
  }

  /**
   * Connect to Overleaf WebSocket
   */
  async connect(): Promise<void> {
    console.log('[Overleaf WS] Fetching session ID...');

    // Step 1: Get session ID
    const cookies = this.formatCookies();
    console.log('[Overleaf WS] 📤 Session ID request cookies:', cookies.substring(0, 100) + '...');

    const res = await fetch(
      `${this.baseUrl}/socket.io/1/?projectId=${this.projectId}&t=${Date.now()}`,
      {
        headers: {
          'Accept': 'text/plain',
          'Cookie': cookies,
          ...(this.csrfToken && { 'X-Csrf-Token': this.csrfToken })
        },
      }
    );

    if (res.status !== 200) {
      console.error('[Overleaf WS] ❌ Failed to get session ID. Status:', res.status);
      const body = await res.text();
      console.error('[Overleaf WS] ❌ Response body:', body);
      throw new Error(`Failed to connect: ${res.status}`);
    }

    const data = await res.text();
    console.log('[Overleaf WS] 📦 Session ID response (raw):', data);
    console.log('[Overleaf WS] 📦 Response parts:', data.split(':'));

    const sessionId = data.split(':')[0];
    console.log('[Overleaf WS] ✅ Got session ID:', sessionId);

    // Step 2: Connect WebSocket
    const domain = this.baseUrl.replace('https://', '');
    const wsUrl = `wss://${domain}/socket.io/1/websocket/${sessionId}?projectId=${this.projectId}`;
    console.log('[Overleaf WS] 🔌 Connecting to WebSocket:', wsUrl);

    // Important: Must send cookies with WebSocket handshake for authentication
    const wsHeaders = {
      'Cookie': cookies,
      'Origin': this.baseUrl,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };
    console.log('[Overleaf WS] 📤 WebSocket handshake headers:');
    console.log('  - Cookie:', wsHeaders.Cookie.substring(0, 100) + '...');
    console.log('  - Origin:', wsHeaders.Origin);
    console.log('  - User-Agent:', wsHeaders['User-Agent'].substring(0, 50) + '...');

    this.ws = new WebSocket(wsUrl, { headers: wsHeaders });

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not initialized'));

      this.ws.on('open', () => {
        console.log('[Overleaf WS] ✅ WebSocket connection opened (handshake successful)');
        console.log('[Overleaf WS] 📡 Ready state:', this.ws?.readyState);
        console.log('[Overleaf WS] ⏳ Waiting 200ms for server messages before resolving...');
        // Wait a bit before resolving to let handshake complete
        setTimeout(() => {
          console.log('[Overleaf WS] ✅ Wait complete, resolving connection promise');
          resolve();
        }, 200);
      });

      this.ws.on('error', (error) => {
        console.error('[Overleaf WS] ❌ WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        const reasonStr = reason ? reason.toString() : 'no reason';
        console.error('[Overleaf WS] ❌ Connection closed. Code:', code, 'Reason:', reasonStr);
        console.error('[Overleaf WS] ❌ Total messages received:', this.messageCount);
        console.error('[Overleaf WS] ❌ Close code meanings:');
        console.error('   - 1000: Normal closure');
        console.error('   - 1001: Endpoint going away');
        console.error('   - 1002: Protocol error');
        console.error('   - 1003: Unsupported data');
        console.error('   - 1006: Abnormal closure (no close frame received)');
        console.error('   - 1007: Inconsistent data');
        console.error('   - 1008: Policy violation');
        console.error('   - 1009: Message too big');
      });

      this.ws.on('message', (data: Buffer) => {
        this.messageCount++;
        const msgStr = data.toString();
        console.log('[Overleaf WS] 📨 Received message #' + this.messageCount + ':', msgStr.substring(0, 200));
        this.handleMessage(msgStr);
      });

      setTimeout(() => reject(new Error('Connection timeout')), 30000);
    });
  }

  /**
   * Format cookies for HTTP header
   */
  private formatCookies(): string {
    const cookies = [`overleaf_session2=${this.auth.cookieOverleafSession2}`];
    if (this.auth.cookieGCLB) {
      cookies.push(`GCLB=${this.auth.cookieGCLB}`);
    }
    const cookieStr = cookies.join('; ');
    console.log('[Overleaf WS] 🍪 Using cookies:', cookieStr.substring(0, 50) + '...');
    console.log('[Overleaf WS] 🍪 Session2 length:', this.auth.cookieOverleafSession2?.length || 0);
    console.log('[Overleaf WS] 🍪 CSRF token:', this.csrfToken ? this.csrfToken.substring(0, 20) + '...' : '(none)');
    return cookieStr;
  }

  /**
   * Handle WebSocket messages
   */
  private handleMessage(data: string): void {
    // Heartbeat ping - reply with pong
    if (data.match(/^2::/)) {
      console.log('[Overleaf WS] 💓 Received ping, sending pong');
      this.ws?.send('2::');
      return;
    }

    // Data message (5:::)
    if (data.match(/^5:::(.*)/)) {
      const match = data.match(/^5:::(.*)/);
      if (match) {
        try {
          const message = JSON.parse(match[1]);
          console.log('[Overleaf WS] 📦 Data message:', message.name || '(no name)');
          this.handleDataMessage(message);
        } catch (e) {
          console.error('[Overleaf WS] Failed to parse data message:', e);
        }
      }
      return;
    }

    // Response with data
    if (data.match(/^6:::\d+\+/)) {
      const responseHeader = data.match(/^6:::\d+/) || [];
      const responseHeaderText = responseHeader[0]!;
      const seq = parseInt(responseHeaderText.split(':').pop() || '0');
      const responseBodyText = data.slice(responseHeaderText.length + 1);

      console.log('[Overleaf WS] 📨 Response for seq:', seq);

      try {
        const contentData = JSON.parse(responseBodyText);
        const callback = this.pendingRequests.get(seq);
        if (callback) {
          this.pendingRequests.delete(seq);
          callback(contentData);
        }
      } catch (e) {
        console.error('[Overleaf WS] Failed to parse response:', e);
      }
      return;
    }

    // Error message (7:::)
    if (data.match(/^7:::/)) {
      const errorMsg = data.substring(4); // Remove "7:::" prefix
      console.error('[Overleaf WS] ❌ Server error:', errorMsg);
      return;
    }

    console.log('[Overleaf WS] ⚠️ Unhandled message:', data.substring(0, 100));
  }

  /**
   * Handle data messages from Overleaf
   */
  private handleDataMessage(message: any): void {
    if (message.name === 'joinProjectResponse') {
      console.log('[Overleaf WS] Received joinProjectResponse');
      this.processProjectStructure(message.args[0] as OverleafJoinProjectResponse);
      this.projectJoined = true;
    }
  }

  /**
   * Process project structure and build docId -> path mapping
   */
  private processProjectStructure(response: OverleafJoinProjectResponse): void {
    const queue: OverleafFolder[] = [...response.project.rootFolder];

    console.log('[Overleaf WS] Processing project structure...');

    // Process folder structure with BFS traversal
    while (queue.length > 0) {
      const folder = queue.shift();
      if (!folder) continue;

      // Process documents in current folder
      for (const doc of folder.docs) {
        // Build path: folder.name/doc.name, removing "rootFolder/" prefix
        const path = `${folder.name}/${doc.name}`.replace(/^rootFolder\//, '');
        this.docIdToPath.set(doc._id, {
          id: doc._id,
          path: path,
          name: doc.name,
          type: 'doc'
        });
        console.log(`[Overleaf WS] Mapped doc ${doc._id} -> ${path}`);
      }

      // Process file references (images, etc.) in current folder
      for (const fileRef of folder.fileRefs) {
        // Build path: folder.name/fileRef.name, removing "rootFolder/" prefix
        const path = `${folder.name}/${fileRef.name}`.replace(/^rootFolder\//, '');
        this.docIdToPath.set(fileRef._id, {
          id: fileRef._id,
          path: path,
          name: fileRef.name,
          type: 'file',
          hash: fileRef.hash
        });
        console.log(`[Overleaf WS] Mapped file ${fileRef._id} -> ${path} (hash: ${fileRef.hash})`);
      }

      // Add subfolders to queue
      if (folder.folders && folder.folders.length > 0) {
        queue.push(...folder.folders);
      }
    }

    console.log(`[Overleaf WS] Processed ${this.docIdToPath.size} items in project`);
  }

  /**
   * Send request to Overleaf WebSocket
   */
  private async sendRequest(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const seq = this.messageSeq;
      this.messageSeq++;
      this.pendingRequests.set(seq, resolve);

      // Correct Socket.io message format: 5:{seq}+::{JSON}
      const payload = `5:${seq}+::` + JSON.stringify(message);
      console.log('[Overleaf WS] 📤 Sending:', payload.substring(0, 200));

      this.ws.send(payload);

      setTimeout(() => {
        console.log('[Overleaf WS] ⏰ Timeout waiting for response to seq:', seq);
        reject(new Error('Request timeout'));
      }, 60000); // 增加到 60 秒
    });
  }

  /**
   * Join project to fetch project structure
   */
  async joinProject(): Promise<void> {
    console.log('[Overleaf WS] Joining project:', this.projectId);

    // Check if we already received joinProjectResponse (auto-sent by server)
    if (this.projectJoined) {
      console.log('[Overleaf WS] ✅ Already joined (received auto joinProjectResponse)');
      return;
    }

    // Wait a bit for Socket.io handshake to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    const response = await this.sendRequest({
      name: 'joinProject',
      args: [this.projectId]
    });

    console.log('[Overleaf WS] ✅ Join project response received');
    return response;
  }

  /**
   * Wait for project to be joined
   */
  async waitForProjectJoin(): Promise<void> {
    console.log('[Overleaf WS] Waiting for project join...');

    return new Promise((resolve, reject) => {
      if (this.projectJoined) {
        console.log('[Overleaf WS] ✅ Project already joined');
        resolve();
        return;
      }

      const checkInterval = setInterval(() => {
        if (this.projectJoined) {
          clearInterval(checkInterval);
          console.log('[Overleaf WS] ✅ Project join completed');
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        console.error('[Overleaf WS] ❌ Timeout waiting for project join');
        reject(new Error('Timeout waiting for project join'));
      }, 5000); // 5 second timeout (should be instant)
    });
  }

  /**
   * Get all document and file IDs
   */
  getAllDocIds(): string[] {
    return Array.from(this.docIdToPath.keys());
  }

  /**
   * Get document info by ID
   */
  getDocInfo(id: string): DocInfo | undefined {
    return this.docIdToPath.get(id);
  }

  /**
   * Join a document to fetch its content
   */
  async joinDoc(docId: string): Promise<string[]> {
    console.log(`[Overleaf WS] Joining doc: ${docId}`);

    const contentData = await this.sendRequest({
      name: 'joinDoc',
      args: [docId, { encodeRanges: true }],
    });

    // Parse response: [null, escapedLines[], version, ops, comments]
    const escapedLines = contentData[1] || [];
    const version = contentData[2] || 0;

    console.log(`[Overleaf WS] Got doc content: ${docId}, version: ${version}, lines: ${escapedLines.length}`);

    // Decode UTF-8
    const decodedLines = escapedLines.map((line: string) => {
      try {
        const bytes = new Uint8Array([...line].map((c) => c.charCodeAt(0)));
        return new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
        console.error('[Overleaf WS] Failed to decode line:', e);
        return line;
      }
    });

    return decodedLines;
  }

  /**
   * Leave a document
   */
  async leaveDoc(docId: string): Promise<void> {
    console.log(`[Overleaf WS] Leaving doc: ${docId}`);
    await this.sendRequest({
      name: 'leaveDoc',
      args: [docId]
    });
  }

  /**
   * Download binary file by blob hash
   */
  async downloadFile(fileRefId: string): Promise<Buffer> {
    const fileInfo = this.docIdToPath.get(fileRefId);
    if (!fileInfo || fileInfo.type !== 'file') {
      throw new Error(`File ${fileRefId} not found or is not a file`);
    }

    if (!fileInfo.hash) {
      throw new Error(`File ${fileRefId} does not have a hash`);
    }

    console.log(`[Overleaf WS] Downloading file: ${fileInfo.path} (hash: ${fileInfo.hash})`);

    // Use the correct URL format: /project/{projectId}/blob/{hash}
    const fileUrl = `${this.baseUrl}/project/${this.projectId}/blob/${fileInfo.hash}`;

    try {
      const response = await fetch(fileUrl, {
        headers: {
          Cookie: this.formatCookies()
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
      }

      const buffer = await response.buffer();
      console.log(`[Overleaf WS] Downloaded ${fileInfo.path} (${buffer.length} bytes)`);
      return buffer;
    } catch (error) {
      console.error(`[Overleaf WS] Failed to download ${fileInfo.path}:`, error);
      throw error;
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Get the domain
   */
  private get domain(): string {
    return this.baseUrl.replace('https://', '');
  }
}
