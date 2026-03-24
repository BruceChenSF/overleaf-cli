import { MirrorServer } from '../../src/server';
import { WebSocket } from 'ws';

export class TestServer {
  private server: MirrorServer;

  constructor() {
    this.server = new MirrorServer();
  }

  async connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3456');

      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  async close(): Promise<void> {
    this.server.close();
  }
}
