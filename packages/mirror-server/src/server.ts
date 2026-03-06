import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { ClientConnection } from './client-connection';
import { FileWatcher } from './filesystem/watcher';
import type { WSMessage, SyncCommandMessage } from './types';

const PORT = 3456;

export class MirrorServer {
  private wss: WebSocketServer;
  private connections: Map<WebSocket, ClientConnection> = new Map();
  private fileWatchers: Map<string, FileWatcher> = new Map();

  constructor(httpServer?: HttpServer) {
    this.wss = new WebSocketServer({
      port: httpServer ? undefined : PORT,
      server: httpServer,
    });

    this.setupServer();
  }

  private setupServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New client connected');

      const connection = new ClientConnection(ws, '');

      this.connections.set(ws, connection);

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        this.connections.delete(ws);
      });

      connection.onMessage((message: WSMessage) => {
        this.handleMessage(connection, message);
      });
    });

    console.log(`Mirror server listening on port ${PORT}`);
  }

  private handleMessage(connection: ClientConnection, message: WSMessage): void {
    switch (message.type) {
      case 'mirror':
        console.log('Received mirror request:', message.api_endpoint);
        // Will be implemented in later tasks
        break;
      case 'sync':
        const syncMessage = message as SyncCommandMessage;
        console.log('Received sync command:', syncMessage.operation);

        // Start file watcher for this project if not already watching
        if (!this.fileWatchers.has(syncMessage.project_id)) {
          const watcher = new FileWatcher(syncMessage.project_id);
          this.fileWatchers.set(syncMessage.project_id, watcher);
          watcher.start().catch((error) => {
            console.error(`Failed to start file watcher for ${syncMessage.project_id}:`, error);
          });
        }
        break;
      default:
        console.warn('Unknown message type:', message);
    }
  }

  broadcast(message: WSMessage): void {
    this.connections.forEach((connection) => {
      // Handle broadcasting if needed
    });
  }

  close(): void {
    // Stop all file watchers
    this.fileWatchers.forEach((watcher) => {
      watcher.stop();
    });
    this.fileWatchers.clear();

    // Close WebSocket server
    this.wss.close();
  }
}
