/**
 * Overleaf WebSocket Client
 * Connects to Overleaf's WebSocket API to fetch all file contents
 */

interface OverleafAuth {
  cookieOverleafSession2: string;
  cookieGCLB: string;
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

type ChangeEventHandler = (change: FileChange) => void;

interface FileChange {
  type: 'modified' | 'created' | 'deleted';
  path: string;
  docId?: string;
}

interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
};

export class OverleafWebSocketClient {
  private ws: WebSocket | null = null;
  private messageSeq = 0;
  private pendingRequests = new Map<number, (response: any) => void>();
  private docIdToPath = new Map<string, DocInfo>(); // docId/fileId -> {id, path, name, type}
  private projectJoined = false;
  private onChangeCallback?: ChangeEventHandler;

  /**
   * Execute a function with retry logic and exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG,
    context: string = 'operation'
  ): Promise<T> {
    let lastError: Error | undefined;
    let delay = config.initialDelay;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.warn(`[Overleaf WS] ${context} failed (attempt ${attempt}/${config.maxAttempts}):`, error);

        if (attempt < config.maxAttempts) {
          console.log(`[Overleaf WS] Retrying ${context} in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
        }
      }
    }

    throw new Error(`${context} failed after ${config.maxAttempts} attempts: ${lastError?.message}`);
  }

  /**
   * Connect to Overleaf WebSocket
   */
  async connect(projectId: string, auth: OverleafAuth, csrfToken: string): Promise<void> {
    const domain = window.location.hostname;
    const baseUrl = `https://${domain}`;

    // Step 1: Get session ID
    console.log('[Overleaf WS] Fetching session ID...');
    const res = await fetch(
      `${baseUrl}/socket.io/1/?projectId=${projectId}&t=${Date.now()}`,
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Csrf-Token': csrfToken,
          Cookie: `overleaf_session2=${auth.cookieOverleafSession2}; GCLB=${auth.cookieGCLB}`,
        },
      }
    );

    if (res.status !== 200) {
      throw new Error(`Failed to connect: ${res.status}`);
    }

    const data = await res.text();
    const sessionId = data.split(':')[0];
    console.log('[Overleaf WS] Got session ID:', sessionId);

    // Step 2: Connect WebSocket
    const wsUrl = `wss://${domain}/socket.io/1/websocket/${sessionId}?projectId=${projectId}`;
    console.log('[Overleaf WS] Connecting to WebSocket:', wsUrl);

    this.ws = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      if (!this.ws) return reject(new Error('WebSocket not initialized'));

      this.ws.onopen = async () => {
        console.log('[Overleaf WS] ✓ Connected');
        try {
          // Step 3: Send joinProject request
          await this.sendJoinProject(projectId);
          resolve();
        } catch (error) {
          reject(error);
        }
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

      setTimeout(() => reject(new Error('Connection timeout')), 10000);
    });
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
      const contentData = JSON.parse(responseBodyText);

      const callback = this.pendingRequests.get(seq);
      if (callback) {
        this.pendingRequests.delete(seq);
        callback(contentData);
      }
    }
  }

  /**
   * Handle data messages from Overleaf
   */
  private handleDataMessage(message: any): void {
    // Log all message names for debugging
    if (message.name !== 'otUpdateApplied') {
      console.log(`[Overleaf WS] Received message: ${message.name}`);
    }

    if (message.name === 'joinProjectResponse') {
      console.log('[Overleaf WS] ✓ Received joinProjectResponse');
      // Set flag immediately so waitForProjectJoin doesn't timeout
      this.projectJoined = true;
      this.processProjectStructure(message.args[0] as OverleafJoinProjectResponse);
    } else if (message.name === 'otUpdateApplied') {
      // File was modified in Overleaf
      console.log(`🔍 [Overleaf WS] otUpdateApplied received:`, message.args);
      const arg0 = message.args[0] as { doc: string; v: number };
      const docInfo = this.docIdToPath.get(arg0.doc);
      console.log(`🔍 [Overleaf WS] Doc lookup result:`, docInfo);
      console.log(`🔍 [Overleaf WS] Has callback:`, !!this.onChangeCallback);
      if (docInfo && this.onChangeCallback) {
        console.log(`📝 [Overleaf CC] File modified in Overleaf: ${docInfo.path}`);
        this.onChangeCallback({
          type: 'modified',
          path: docInfo.path,
          docId: arg0.doc
        });
      } else {
        if (!docInfo) {
          console.warn(`⚠️ [Overleaf WS] Unknown docId: ${arg0.doc}`);
        }
        if (!this.onChangeCallback) {
          console.warn(`⚠️ [Overleaf WS] No onChangeCallback registered`);
        }
      }
    } else if (message.name === 'reciveNewDoc' || message.name === 'newDocCreated') {
      // A new document was created in Overleaf
      console.log(`📢 [Overleaf WS] ${message.name} received:`, message.args);

      // message.args format varies - try to extract docId and doc info
      const docId = message.args[0] as string;
      const docInfo = message.args[1] as any; // Could be object with path, name, etc.

      // Try different formats
      const docPath = docInfo?.path || docInfo?.name || (typeof message.args[1] === 'string' ? message.args[1] : undefined);
      const docName = docInfo?.name || docPath || `doc_${docId}`;

      console.log(`📝 [Overleaf CC] File created in Overleaf: ${docPath} (id: ${docId})`);

      // Update docId mapping (fetch interceptor handles the actual creation event)
      if (docId && docPath) {
        this.docIdToPath.set(docId, {
          id: docId,
          path: docPath,
          name: docName,
          type: 'doc'
        });
        console.log(`✅ [Overleaf WS] Mapped doc ${docId} -> ${docPath} (fetch interceptor handles creation)`);
      }
      // NOTE: Don't trigger onChange here - fetch interceptor will handle file creation
      console.log(`ℹ️  [Overleaf WS] ${message.name} processed - waiting for fetch interceptor to handle creation`);
    } else if (message.name === 'reciveNewFile' || message.name === 'fileUploaded' || message.name === 'fileCreated') {
      // A new file was uploaded/created in Overleaf
      // NOTE: File creation is now handled by fetch interceptor for reliability
      console.log(`📢 [Overleaf WS] ${message.name} received (fetch interceptor handles creation)`);
      // No action needed - fetch interceptor will handle file creation
    } else if (message.name === 'removeEntity') {
      // A document or file was removed from Overleaf
      // NOTE: File deletion is now handled by fetch interceptor for reliability
      console.log(`📢 [Overleaf WS] removeEntity received (fetch interceptor handles deletion)`);
      // No action needed - fetch interceptor will handle file deletion
      // We keep the docIdToPath entry for fetch interceptor to use
    } else if (message.name === 'docRemoved') {
      // A document was deleted from Overleaf
      console.log(`📢 [Overleaf WS] docRemoved received:`, message.args);
      const arg0 = message.args[0] as { doc: string; path: string };
      const docInfo = this.docIdToPath.get(arg0.doc) || { path: arg0.path };
      console.log(`📝 [Overleaf CC] File deleted in Overleaf: ${docInfo.path}`);

      // Remove from docId mapping
      if (arg0.doc) {
        this.docIdToPath.delete(arg0.doc);
      }

      if (this.onChangeCallback) {
        this.onChangeCallback({
          type: 'deleted',
          path: docInfo.path,
          docId: arg0.doc
        });
      }
    } else if (message.name === 'fileUploaded' || message.name === 'fileCreated') {
      // A file was uploaded/created in Overleaf
      console.log(`📢 [Overleaf WS] ${message.name} received:`, message.args);
      const arg0 = message.args[0] as { file: string; path: string; name: string };
      console.log(`📝 [Overleaf CC] File created in Overleaf: ${arg0.path || arg0.name}`);

      if (this.onChangeCallback) {
        this.onChangeCallback({
          type: 'created',
          path: arg0.path || `/${arg0.name}`,
          docId: arg0.file
        });
      }
    } else if (message.name === 'fileRemoved') {
      // A file was deleted from Overleaf
      console.log(`📢 [Overleaf WS] fileRemoved received:`, message.args);
      const arg0 = message.args[0] as { file: string; path: string };
      console.log(`📝 [Overleaf CC] File deleted in Overleaf: ${arg0.path}`);

      if (this.onChangeCallback) {
        this.onChangeCallback({
          type: 'deleted',
          path: arg0.path,
          docId: arg0.file
        });
      }
    }
  }

  /**
   * Process project structure and build docId -> path mapping
   */
  private processProjectStructure(response: OverleafJoinProjectResponse): void {
    const queue: OverleafFolder[] = response.project.rootFolder;

    // Process folder structure with BFS traversal
    while (queue.length > 0) {
      const folder = queue.pop();
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

      // Queue subfolders
      for (const subFolder of folder.folders) {
        queue.push({
          ...subFolder,
          name: `${folder.name}/${subFolder.name}`,
        });
      }
    }

    const docsCount = Array.from(this.docIdToPath.values()).filter(info => info.type === 'doc').length;
    const filesCount = Array.from(this.docIdToPath.values()).filter(info => info.type === 'file').length;
    console.log(`[Overleaf WS] Processed ${docsCount} documents and ${filesCount} files`);
  }

  /**
   * Get all document IDs
   */
  getAllDocIds(): string[] {
    return Array.from(this.docIdToPath.keys());
  }

  /**
   * Get document info by ID
   */
  getDocInfo(docId: string): DocInfo | undefined {
    return this.docIdToPath.get(docId);
  }

  /**
   * Wait for project to be joined
   */
  async waitForProjectJoin(): Promise<void> {
    console.log('[Overleaf WS] waitForProjectJoin called, projectJoined:', this.projectJoined);

    if (this.projectJoined) {
      console.log('[Overleaf WS] Already joined, returning immediately');
      return;
    }

    return new Promise((resolve) => {
      let checks = 0;
      const checkInterval = setInterval(() => {
        checks++;
        if (this.projectJoined) {
          clearInterval(checkInterval);
          console.log(`[Overleaf WS] Project joined after ${checks} checks`);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        if (!this.projectJoined) {
          clearInterval(checkInterval);
          console.error(`[Overleaf WS] Timeout waiting for project join after ${checks} checks`);
        }
      }, 10000);
    });
  }

  /**
   * Join a document to fetch its content
   */
  async joinDoc(docId: string): Promise<string[]> {
    console.log(`[Overleaf WS] Joining doc: ${docId}`);

    return this.retryWithBackoff(
      async () => {
        const contentData = await this.sendRequest({
          name: 'joinDoc',
          args: [docId, { encodeRanges: true }],
        });

        const escapedLines = contentData[1] || [];
        const version = contentData[2] || 0;

        console.log(`[Overleaf WS] Got doc content: ${docId}, version: ${version}, lines: ${escapedLines.length}`);

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
      },
      DEFAULT_RETRY_CONFIG,
      `joinDoc(${docId})`
    );
  }

  /**
   * Leave a document
   */
  async leaveDoc(docId: string): Promise<void> {
    console.log(`[Overleaf WS] Leaving doc: ${docId}`);
    await this.sendRequest({
      name: 'leaveDoc',
      args: [docId],
    });
  }

  /**
   * Download a binary file (image, PDF, etc.) from Overleaf
   */
  async downloadFile(fileRefId: string, projectId: string): Promise<Blob> {
    return this.retryWithBackoff(
      async () => {
        const fileInfo = this.docIdToPath.get(fileRefId);
        if (!fileInfo || fileInfo.type !== 'file') {
          throw new Error(`File ${fileRefId} not found or is not a file`);
        }

        console.log(`[Overleaf WS] Downloading file: ${fileInfo.path} (hash: ${fileInfo.hash})`);

        if (!fileInfo.hash) {
          throw new Error(`File ${fileRefId} does not have a hash`);
        }

        const domain = window.location.hostname;
        const fileUrl = `https://${domain}/project/${projectId}/blob/${fileInfo.hash}`;

        console.log(`[Overleaf WS] Fetching: ${fileUrl}`);

        const response = await fetch(fileUrl, {
          method: 'GET',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        console.log(`[Overleaf WS] Downloaded ${fileInfo.path} (${blob.size} bytes, type: ${blob.type})`);
        return blob;
      },
      DEFAULT_RETRY_CONFIG,
      `downloadFile(${fileRefId})`
    );
  }

  /**
   * Send joinProject request
   * Response will be received via handleDataMessage (joinProjectResponse event)
   */
  private sendJoinProject(projectId: string): void {
    console.log('[Overleaf WS] Sending joinProject request...');

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    // Send joinProject message (no response expected via callback)
    this.ws.send(`5:::${JSON.stringify({
      name: 'joinProject',
      args: [projectId]
    })}`);

    console.log('[Overleaf WS] ✓ joinProject sent, waiting for joinProjectResponse...');
  }

  /**
   * Send a request and wait for response
   */
  private sendRequest(message: { name: string; args: unknown[] }): Promise<any> {
    return this.retryWithBackoff(
      async () => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          throw new Error('WebSocket not connected');
        }

        return new Promise((resolve, reject) => {
          const seq = this.messageSeq;

          this.ws!.send(`5:${seq}+::` + JSON.stringify(message));
          this.messageSeq++;

          this.pendingRequests.set(seq, resolve);

          const timeout = setTimeout(() => {
            if (this.pendingRequests.has(seq)) {
              this.pendingRequests.delete(seq);
              reject(new Error('Request timeout'));
            }
          }, 3000);

          const originalResolve = resolve;
          this.pendingRequests.set(seq, (response: any) => {
            clearTimeout(timeout);
            originalResolve(response);
          });
        });
      },
      DEFAULT_RETRY_CONFIG,
      `WebSocket request (${message.name})`
    );
  }

  /**
   * Register a callback for file change events
   */
  onChange(callback: ChangeEventHandler): void {
    this.onChangeCallback = callback;
    console.log('[Overleaf WS] Change detection enabled');
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingRequests.clear();
    this.docIdToPath.clear();
    this.projectJoined = false;
    this.onChangeCallback = undefined;
  }
}
