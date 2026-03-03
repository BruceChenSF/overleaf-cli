import type { Terminal } from 'xterm';

export interface BridgeMessage {
  type: 'auth' | 'command' | 'response' | 'sync';
  data: unknown;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private terminal: Terminal;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  async connect(projectId: string, sessionCookie: string, domain: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3456');

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected to bridge server');

        // Send auth message
        this.send({
          type: 'auth',
          data: { projectId, sessionCookie, domain }
        });

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as BridgeMessage;

          if (message.type === 'response') {
            const data = message.data as { success: boolean; output?: string; error?: string };

            if (data.output) {
              this.terminal.write(data.output);
            }

            if (data.error) {
              this.terminal.writeln(`\r\n\x1b[31m${data.error}\x1b[0m`);
            }
          }
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[WebSocket] Disconnected from bridge server');
        this.handleReconnect(projectId, sessionCookie, domain);
      };

      this.ws.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        reject(error);
      };
    });
  }

  private handleReconnect(projectId: string, sessionCookie: string, domain: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(() => {
        this.connect(projectId, sessionCookie, domain);
      }, 2000 * this.reconnectAttempts);
    } else {
      this.terminal.writeln('\r\n\x1b[31mConnection lost. Please restart the bridge server.\x1b[0m');
    }
  }

  sendCommand(command: string, args: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.terminal.writeln('\r\n\x1b[31mNot connected to bridge server\x1b[0m');
      return;
    }

    this.send({
      type: 'command',
      data: { command, args }
    });
  }

  private send(message: BridgeMessage): void {
    this.ws?.send(JSON.stringify(message));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
