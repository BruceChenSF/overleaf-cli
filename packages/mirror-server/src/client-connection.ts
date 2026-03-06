import { WebSocket } from 'ws';
import type { WSMessage, MirrorRequestMessage, SyncCommandMessage } from './types';

export class ClientConnection {
  private messageId = 0;

  constructor(private ws: WebSocket, private projectId: string) {}

  getProjectId(): string {
    return this.projectId;
  }

  sendMirrorRequest(data: MirrorRequestMessage): void {
    this.send({ ...data, type: 'mirror' });
  }

  sendSyncCommand(command: SyncCommandMessage): void {
    this.send(command);
  }

  sendAck(requestId: string, success: boolean, error?: string): void {
    this.send({
      type: 'ack',
      request_id: requestId,
      success,
      error,
    });
  }

  private send(message: WSMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(callback: (message: WSMessage) => void): void {
    this.ws.on('message', (data: string) => {
      try {
        const message = JSON.parse(data) as WSMessage;
        callback(message);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });
  }

  onClose(callback: () => void): void {
    this.ws.on('close', callback);
  }

  close(): void {
    this.ws.close();
  }
}
