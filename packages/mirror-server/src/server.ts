import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ClientConnection } from './client-connection';
import { FileWatcher } from './filesystem/watcher';
import { handleEditMonitor } from './handlers/edit-monitor';
import type { WSMessage, SyncCommandMessage } from './types';
import type { EditEventMessage } from '@overleaf-cc/shared';

const PORT = 3456;

export class MirrorServer {
  private wss: WebSocketServer;
  private httpServer: HttpServer;
  private connections: Map<WebSocket, ClientConnection> = new Map();
  private fileWatchers: Map<string, FileWatcher> = new Map();

  constructor(httpServer?: HttpServer) {
    // Create HTTP server for API endpoints
    this.httpServer = httpServer || createServer();

    // Setup HTTP routes
    this.setupHTTPServer();

    // Setup WebSocket server
    this.wss = new WebSocketServer({
      server: this.httpServer,
    });

    this.setupWebSocketServer();

    // Start listening
    if (!httpServer) {
      this.httpServer.listen(PORT, () => {
        console.log(`Mirror server listening on port ${PORT}`);
      });
    }
  }

  private setupHTTPServer(): void {
    this.httpServer.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Handle /api/mirror endpoint
      if (req.url === '/api/mirror' && req.method === 'POST') {
        let body = '';

        req.on('data', (chunk) => {
          body += chunk.toString();
        });

        req.on('end', () => {
          try {
            const data = JSON.parse(body);

            // Handle the mirror request
            this.handleMirrorRequest(data);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (error) {
            console.error('[HTTP] Failed to parse request:', error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
  }

  private handleMirrorRequest(data: any): void {
    // For now, just log the request
    // Later we'll implement actual Overleaf API handling
    console.log('[HTTP] Received:', data.method, data.api_endpoint);
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      const connection = new ClientConnection(ws, '');

      this.connections.set(ws, connection);

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      ws.on('close', () => {
        this.connections.delete(ws);
      });

      connection.onMessage((message: WSMessage) => {
        this.handleMessage(connection, message);
      });
    });
  }

  private handleMessage(connection: ClientConnection, message: WSMessage): void {
    switch (message.type) {
      case 'mirror':
        console.log('Received mirror request:', message.api_endpoint);
        // Will be implemented in later tasks
        break;
      case 'edit_event':
        handleEditMonitor(message as EditEventMessage);
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
