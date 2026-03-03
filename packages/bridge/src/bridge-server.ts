import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { OverleafClient } from './overleaf-client.js';
import { SyncManagerDOM } from './sync-manager-dom.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { BridgeMessage, AuthMessage, CommandMessage } from './types.js';

export class BridgeServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, { projectId: string; overleafClient: OverleafClient; syncManager: SyncManagerDOM }> = new Map();
  private claudeProcess?: ChildProcess;
  private workDir: string;

  constructor(port: number = 3456) {
    this.wss = new WebSocketServer({ port });
    this.workDir = path.join(process.cwd(), 'overleaf-workspace');

    this.wss.on('connection', (ws) => {
      console.log('[Bridge] Client connected');

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as BridgeMessage;
          console.log('[Bridge] Received message type:', message.type);
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('[Bridge] Error handling message:', error);
          console.error('[Bridge] Message data:', data.toString());
          ws.send(JSON.stringify({
            type: 'response',
            data: { success: false, error: 'Invalid message' }
          }));
        }
      });

      ws.on('close', () => {
        console.log('[Bridge] Client disconnected');
        this.clients.delete(ws);
      });
    });

    console.log(`[Bridge] WebSocket server listening on port ${port}`);
  }

  private async handleMessage(ws: WebSocket, message: BridgeMessage): Promise<void> {
    switch (message.type) {
      case 'auth':
        await this.handleAuth(ws, message as AuthMessage);
        break;
      case 'command':
        await this.handleCommand(ws, message as CommandMessage);
        break;
      case 'EXTENSION_MESSAGE':
        // Response from extension - forward to sync manager if needed
        console.log('[Bridge] Received extension message response');
        break;
      default:
        ws.send(JSON.stringify({
          type: 'response',
          data: { success: false, error: 'Unknown message type' }
        }));
    }
  }

  private async handleAuth(ws: WebSocket, message: AuthMessage): Promise<void> {
    const { projectId, sessionCookie, domain, csrfToken } = message.data;

    console.log(`[Bridge] Auth request for project ${projectId}`);

    if (!csrfToken) {
      console.error('[Bridge] Missing CSRF token in auth message');
      ws.send(JSON.stringify({
        type: 'response',
        data: { success: false, error: 'Missing CSRF token. Please refresh the Overleaf page and try again.' }
      }));
      return;
    }

    console.log(`[Bridge] CSRF token (first 10 chars): ${csrfToken.substring(0, 10)}...`);

    // Create Overleaf client (kept for potential future use)
    const overleafClient = new OverleafClient(sessionCookie, csrfToken, domain);

    // Create project workspace
    const projectDir = path.join(this.workDir, projectId);
    await fs.mkdir(projectDir, { recursive: true });

    // Create sync manager with WebSocket connection
    const syncManager = new SyncManagerDOM(projectId, projectDir, ws);

    // Initial sync
    console.log('[Bridge] Starting initial sync...');
    try {
      await syncManager.initialSync();
      syncManager.startWatching();
    } catch (error) {
      console.error('[Bridge] Initial sync failed:', error);
      // Don't fail auth - user can still use terminal
    }

    // Store client
    this.clients.set(ws, { projectId, overleafClient, syncManager });

    // Send success response
    ws.send(JSON.stringify({
      type: 'response',
      data: { success: true, output: 'Connected and synchronized' }
    }));
  }

  private async handleCommand(ws: WebSocket, message: CommandMessage): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      ws.send(JSON.stringify({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      }));
      return;
    }

    const { command, args } = message.data;
    const projectDir = path.join(this.workDir, client.projectId);

    console.log(`[Bridge] Executing: ${command} ${args.join(' ')}`);

    return new Promise((resolve) => {
      const childProcess = spawn(command, args, {
        cwd: projectDir,
        shell: true,
        env: { ...process.env }
      });

      let output = '';
      let errorOutput = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        output += text;
        ws.send(JSON.stringify({
          type: 'response',
          data: { success: true, output: text }
        }));
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        errorOutput += text;
        ws.send(JSON.stringify({
          type: 'response',
          data: { success: false, error: text }
        }));
      });

      childProcess.on('close', (code: number | null) => {
        console.log(`[Bridge] Command exited with code ${code}`);
        resolve();
      });
    });
  }

  close(): void {
    this.wss.close();
    this.clients.forEach((client) => {
      client.syncManager.stop();
    });
  }
}
