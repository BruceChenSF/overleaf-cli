/**
 * WebSocket client for communicating with mirror server
 */

import type { WSMessage, AckMessage } from './shared/types';

export class MirrorClient {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRequests: Map<string, {
    resolve: (value: AckMessage) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(wsUrl: string = 'ws://localhost:3456') {
    this.wsUrl = wsUrl;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('[MirrorClient] Connected to server');
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as WSMessage;

            if (message.type === 'ack') {
              this.handleAck(message);
            }
          } catch (error) {
            console.error('[MirrorClient] Failed to parse message:', error);
          }
        };

        this.ws.onclose = () => {
          console.log('[MirrorClient] Disconnected from server');
          this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('[MirrorClient] WebSocket error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Clear all pending requests
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Disconnected'));
    });
    this.pendingRequests.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[MirrorClient] Attempting to reconnect...');
      this.connect().catch((error) => {
        console.error('[MirrorClient] Reconnection failed:', error);
      });
    }, 3000);
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  async sendRequest(request: WSMessage & { type: 'mirror' }): Promise<AckMessage> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const requestId = this.generateRequestId();
    const messageWithId = { ...request, request_id: requestId };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 30000);

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      try {
        this.ws!.send(JSON.stringify(messageWithId));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  private handleAck(message: AckMessage & { request_id: string }): void {
    const { request_id } = message;
    const pending = this.pendingRequests.get(request_id);

    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(request_id);

      if (message.success) {
        pending.resolve(message);
      } else {
        pending.reject(new Error(message.error || 'Request failed'));
      }
    }
  }
}
