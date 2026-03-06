import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { ClientConnection } from './client-connection';
import type { WSMessage } from './types';

const PORT = 3456;

export class MirrorServer {
  private wss: WebSocketServer;
  private connections: Map<WebSocket, ClientConnection> = new Map();

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
        console.log('Received sync command:', message.operation);
        // Will be implemented in later tasks
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
    this.wss.close();
  }
}
