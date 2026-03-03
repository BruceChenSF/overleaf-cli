import type { Terminal } from 'xterm';

export interface BridgeMessage {
  type: 'auth' | 'command' | 'response' | 'sync' | 'EXTENSION_MESSAGE';
  data: unknown;
  messageId?: string;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private terminal: Terminal;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  async connect(projectId: string, sessionCookie: string, domain: string, csrfToken: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('ws://localhost:3456');

      this.ws.onopen = () => {
        console.log('[WebSocket] Connected to bridge server');

        // Send auth message with CSRF token
        this.send({
          type: 'auth',
          data: { projectId, sessionCookie, domain, csrfToken }
        });

        resolve();
      };

      this.ws.onmessage = async (event) => {
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
          } else if (message.type === 'EXTENSION_MESSAGE') {
            // Forward message to content script
            await this.forwardToContentScript(message);
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

  private handleReconnect(projectId: string, sessionCookie: string, domain: string, csrfToken: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[WebSocket] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(() => {
        this.connect(projectId, sessionCookie, domain, csrfToken);
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

  private async forwardToContentScript(message: BridgeMessage): Promise<void> {
    try {
      // Find the Overleaf tab
      const tabs = await chrome.tabs.query({ url: 'https://*.overleaf.com/project/*' });

      if (tabs.length === 0 || !tabs[0].id) {
        console.error('[WebSocket] No Overleaf tab found');
        this.sendResponse(message.messageId || '', { success: false, error: 'No Overleaf tab found' });
        return;
      }

      const tabId = tabs[0].id;

      // Forward the inner message to the content script
      const innerMessage = message.data as { action: string; projectId: string; message: unknown };

      // Send to content script and wait for response
      const response = await chrome.tabs.sendMessage(tabId, innerMessage.message);

      // Send response back to bridge
      this.sendResponse(message.messageId || '', { success: true, data: response });
    } catch (error) {
      console.error('[WebSocket] Error forwarding to content script:', error);
      this.sendResponse(message.messageId || '', { success: false, error: String(error) });
    }
  }

  private sendResponse(messageId: string, response: { success: boolean; data?: any; error?: string }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({
      type: 'EXTENSION_MESSAGE',
      messageId,
      data: response
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
