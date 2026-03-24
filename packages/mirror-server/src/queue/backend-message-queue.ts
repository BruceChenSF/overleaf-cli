import { WebSocket } from 'ws';

interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  content?: string;
  doc_id?: string;
  folder_id?: string;
  isDirectory?: boolean;
  timestamp: number;
}

interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  folder_id?: string;
  isDirectory?: boolean;
  timestamp: number;
}

interface QueuedMessage {
  message: SyncToOverleafMessage;
  resolve: (response: SyncToOverleafResponse) => void;
  reject: (error: Error) => void;
}

export class BackendMessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private wsClient: WebSocket | null = null;
  private pendingResponses = new Map<string, {
    resolve: (response: SyncToOverleafResponse) => void;
    reject: (error: Error) => void;
    timestamp: number;
  }>();

  constructor(wsClient?: WebSocket | null) {
    this.wsClient = wsClient || null;
  }

  /**
   * Set the WebSocket client (can be called after construction)
   */
  setWebSocketClient(wsClient: WebSocket): void {
    this.wsClient = wsClient;
    console.log('[BackendQueue] ✅ WebSocket client updated');
  }

  /**
   * Enqueue a message to be sent to the extension
   * Returns a Promise that resolves when the extension responds
   */
  async enqueue(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    return new Promise((resolve, reject) => {
      console.log(`[BackendQueue] 📥 Enqueuing message: ${message.operation} ${message.path}`);

      this.queue.push({
        message,
        resolve,
        reject
      });

      console.log(`[BackendQueue] 📊 Queue size: ${this.queue.length} (processing: ${this.processing})`);

      // Only start processing if not already processing
      if (!this.processing) {
        console.log(`[BackendQueue] 🚀 Starting queue processing`);
        this.processQueue();
      } else {
        console.log(`[BackendQueue] ⏸️ Queue is being processed, message will be handled in order`);
      }
    });
  }

  /**
   * Process the queue sequentially
   * Sends one message at a time and waits for response before sending the next
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    console.log(`[BackendQueue] 🚀 Starting queue processing, ${this.queue.length} messages in queue`);

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      const { message, resolve, reject } = item;

      console.log(`[BackendQueue] ⏳ Processing message: ${message.operation} ${message.path} (${this.queue.length} remaining)`);

      try {
        // Send the message to the extension
        const response = await this.sendMessageAndWait(message);
        resolve(response);
        console.log(`[BackendQueue] ✅ Completed: ${message.operation} ${message.path}`);
      } catch (error) {
        console.error(`[BackendQueue] ❌ Failed: ${message.operation} ${message.path}`, error);
        reject(error as Error);
      }
    }

    console.log(`[BackendQueue] 🏁 Queue processing complete`);
    this.processing = false;
  }

  /**
   * Send a message and wait for the response
   */
  private sendMessageAndWait(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    return new Promise((resolve, reject) => {
      const operationKey = `${message.operation}:${message.path}:${message.timestamp}`;
      const timeout = 30000; // 30 second timeout

      console.log(`[BackendQueue] 📤 Sending message: ${message.operation} ${message.path}`);
      console.log(`[BackendQueue]    Operation key: ${operationKey}`);

      // Store the resolve/reject handlers to be called when response arrives
      this.pendingResponses.set(operationKey, {
        resolve,
        reject,
        timestamp: Date.now()
      });

      // Send the message via WebSocket
      if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
        this.wsClient.send(JSON.stringify(message));
        console.log(`[BackendQueue] ✅ Message sent to extension`);
      } else {
        // Clean up the pending response if WebSocket is not connected
        this.pendingResponses.delete(operationKey);
        reject(new Error('WebSocket not connected'));
        return;
      }

      // Set up timeout to clean up pending response if no response arrives
      const timeoutHandle = setTimeout(() => {
        if (this.pendingResponses.has(operationKey)) {
          this.pendingResponses.delete(operationKey);
          reject(new Error(`Operation timeout after ${timeout}ms`));
        }
      }, timeout);

      // Modify the resolve handler to clear the timeout
      const originalResolve = resolve;
      const wrappedResolve = (response: SyncToOverleafResponse) => {
        clearTimeout(timeoutHandle);
        originalResolve(response);
      };

      // Update the pending response with the wrapped resolve
      const pending = this.pendingResponses.get(operationKey);
      if (pending) {
        pending.resolve = wrappedResolve;
      }
    });
  }

  /**
   * Handle a response from the extension
   * This should be called when a 'sync_to_overleaf_response' message is received
   */
  handleResponse(response: SyncToOverleafResponse): void {
    const operationKey = `${response.operation}:${response.path}:${response.timestamp}`;

    console.log(`[BackendQueue] 📨 Received response: ${response.operation} ${response.path}`);
    console.log(`[BackendQueue]    Success: ${response.success}`);

    const pending = this.pendingResponses.get(operationKey);

    if (pending) {
      // Resolve the promise
      pending.resolve(response);
      this.pendingResponses.delete(operationKey);
      console.log(`[BackendQueue] ✅ Response matched to pending operation: ${operationKey}`);
    } else {
      console.warn(`[BackendQueue] ⚠️ No pending operation found for: ${operationKey}`);
      console.warn(`[BackendQueue] ⚠️ Pending operations: ${Array.from(this.pendingResponses.keys()).join(', ')}`);
    }
  }

  /**
   * Get the current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is currently processing
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Get the number of pending responses (messages sent but not yet responded)
   */
  getPendingResponsesCount(): number {
    return this.pendingResponses.size;
  }
}
