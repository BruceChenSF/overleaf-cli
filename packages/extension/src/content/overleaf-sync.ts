/**
 * Overleaf WebSocket Client for Browser Extension
 * Connects to Overleaf's WebSocket API to fetch all file contents
 * Uses native browser WebSocket (100% compatible)
 */

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

interface SyncedFile {
  path: string;
  content: string | ArrayBuffer;
  type: 'doc' | 'file';
}

/**
 * Overleaf WebSocket Client for Browser
 */
export class OverleafWebSocketClient {
  private ws: WebSocket | null = null;
  private messageSeq = 0;
  private pendingRequests = new Map<number, (response: any) => void>();
  private docIdToPath = new Map<string, DocInfo>();
  private projectJoined = false;
  private baseUrl: string;

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
      throw new Error(`Failed to connect: ${res.status}`);
    }

    const data = await res.text();
    const sessionId = data.split(':')[0];
    console.log('[Overleaf WS] ✅ Got session ID:', sessionId);

    // Step 2: Connect WebSocket (browser native WebSocket)
    const domain = this.baseUrl.replace('https://', '');
    const wsUrl = `wss://${domain}/socket.io/1/websocket/${sessionId}?projectId=${this.projectId}`;
    console.log('[Overleaf WS] 🔌 Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not initialized'));

      this.ws.onopen = () => {
        console.log('[Overleaf WS] ✅ Connected');
        setTimeout(() => resolve(), 200);
      };

      this.ws.onerror = (error) => {
        console.error('[Overleaf WS] ✗ Error:', error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('[Overleaf WS] Connection closed');
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

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
    return cookies.join('; ');
  }

  /**
   * Handle WebSocket messages
   */
  private handleMessage(data: string): void {
    // Heartbeat ping - reply with pong
    if (data.match(/^2::/)) {
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
      const errorMsg = data.substring(4);
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

    console.log(`[Overleaf WS] ✅ Processed ${this.docIdToPath.size} items in project`);
  }

  /**
   * Send request to Overleaf WebSocket
   */
  private sendRequest(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const seq = this.messageSeq;
      this.messageSeq++;
      this.pendingRequests.set(seq, resolve);

      const payload = `5:${seq}+::` + JSON.stringify(message);
      console.log('[Overleaf WS] 📤 Sending:', payload.substring(0, 200));

      this.ws.send(payload);

      setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 60000);
    });
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
        reject(new Error('Timeout waiting for project join'));
      }, 5000);
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
  async downloadFile(fileRefId: string): Promise<ArrayBuffer> {
    const fileInfo = this.docIdToPath.get(fileRefId);
    if (!fileInfo || fileInfo.type !== 'file') {
      throw new Error(`File ${fileRefId} not found or is not a file`);
    }

    if (!fileInfo.hash) {
      throw new Error(`File ${fileRefId} does not have a hash`);
    }

    console.log(`[Overleaf WS] Downloading file: ${fileInfo.path} (hash: ${fileInfo.hash})`);

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

      const buffer = await response.arrayBuffer();
      console.log(`[Overleaf WS] Downloaded ${fileInfo.path} (${buffer.byteLength} bytes)`);
      return buffer;
    } catch (error) {
      console.error(`[Overleaf WS] Failed to download ${fileInfo.path}:`, error);
      throw error;
    }
  }

  /**
   * Sync all files and return their contents
   */
  async syncAllFiles(): Promise<SyncedFile[]> {
    console.log('[Overleaf WS] 🔄 Starting file sync...');

    await this.waitForProjectJoin();

    const allIds = this.getAllDocIds();
    console.log('[Overleaf WS] ✅ Found', allIds.length, 'files in project');

    const syncedFiles: SyncedFile[] = [];

    for (const id of allIds) {
      try {
        const info = this.getDocInfo(id);
        if (!info) {
          console.warn('[Overleaf WS] ⚠️ No info found for', id, ', skipping');
          continue;
        }

        console.log('[Overleaf WS] 📥 Syncing:', info.path);

        if (info.type === 'doc') {
          const lines = await this.joinDoc(id);
          await this.leaveDoc(id);
          const content = lines.join('\n');
          syncedFiles.push({
            path: info.path,
            content: content,
            type: 'doc'
          });
          console.log('[Overleaf WS] ✅ Synced:', info.path, `(${content.length} chars, ${lines.length} lines)`);
        } else if (info.type === 'file') {
          const buffer = await this.downloadFile(id);
          syncedFiles.push({
            path: info.path,
            content: buffer,
            type: 'file'
          });
          console.log('[Overleaf WS] ✅ Synced:', info.path, `(${buffer.byteLength} bytes, binary)`);
        }
      } catch (error) {
        console.error('[Overleaf WS] ❌ Failed to sync', id, ':', error);
      }
    }

    console.log('[Overleaf WS] ✅ Sync complete:', syncedFiles.length, 'files');
    return syncedFiles;
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
}
