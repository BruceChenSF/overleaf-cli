import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { SyncManagerDOM } from './sync-manager-dom.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { BridgeMessage, AuthMessage, CommandMessage } from './types.js';
import { handleFileDeleted } from './handlers/file-deleted-handler.js';
import { handleFileCreated } from './handlers/file-created-handler.js';

export class BridgeServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, { projectId: string; syncManager: SyncManagerDOM }> = new Map();
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
          await this.handleMessage(ws, message);
        } catch (error) {
          console.error('[Bridge] Error handling message:', error);
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

  private async handleMessage(ws: WebSocket, message: BridgeMessage & { requestId?: string }): Promise<void> {
    const requestId = (message as any).requestId;

    // Log incoming message for debugging (commented out to reduce noise)
    // console.log('[Bridge] Received message:', JSON.stringify({ type: message.type, requestId }));

    // Helper function to send response with requestId
    const sendResponse = (data: any) => {
      const response = requestId ? { ...data, requestId } : data;
      // console.log('[Bridge] Sending response:', JSON.stringify(response));
      ws.send(JSON.stringify(response));
    };

    switch (message.type) {
      case 'auth':
        await this.handleAuth(ws, message as AuthMessage, sendResponse);
        break;
      case 'command':
        await this.handleCommand(ws, message as CommandMessage, sendResponse);
        break;
      case 'GET_ALL_FILES':
        await this.handleGetAllFiles(ws, sendResponse);
        break;
      case 'GET_FILE_CONTENT':
        await this.handleGetFileContent(ws, message as any, sendResponse);
        break;
      case 'SET_FILE_CONTENT':
        await this.handleSetFileContent(ws, message as any, sendResponse);
        break;
      case 'GET_FILE_STATUS':
        await this.handleGetFileStatus(ws, message as any, sendResponse);
        break;
      case 'FILE_CHANGED':
        await this.handleFileChanged(ws, message as any, sendResponse);
        break;
      case 'FILE_DELETED':
        await this.handleFileDeleted(ws, message as any, sendResponse);
        break;
      case 'FILE_CREATED':
        await this.handleFileCreated(ws, message as any, sendResponse);
        break;
      case 'EXTENSION_MESSAGE':
        // Response from extension - handled by SyncManagerDOM
        // console.log('[Bridge] Received EXTENSION_MESSAGE, forwarding to SyncManagerDOM');
        break;
      default:
        console.log('[Bridge] Unknown message type:', message.type);
        sendResponse({
          type: 'response',
          data: { success: false, error: 'Unknown message type' }
        });
    }
  }

  private async handleAuth(ws: WebSocket, message: AuthMessage, sendResponse: (data: any) => void): Promise<void> {
    const { projectId, csrfToken } = message.data;

    console.log(`[Bridge] Auth request for project ${projectId}`);

    if (!csrfToken) {
      console.error('[Bridge] Missing CSRF token');
      sendResponse({
        type: 'response',
        data: { success: false, error: 'Missing CSRF token. Please refresh the Overleaf page and try again.' }
      });
      return;
    }

    // Create project workspace
    const projectDir = path.join(this.workDir, projectId);
    await fs.mkdir(projectDir, { recursive: true });

    // Create sync manager with WebSocket connection
    const syncManager = new SyncManagerDOM(projectId, projectDir, ws);

    // Store client FIRST, before initial sync
    // This allows other requests to be handled during sync
    this.clients.set(ws, { projectId, syncManager });
    console.log('[Bridge] Client stored, starting initial sync...');

    // Initial sync
    try {
      await syncManager.initialSync();
      syncManager.startWatching();
      console.log('[Bridge] Initial sync completed successfully');
    } catch (error) {
      console.error('[Bridge] Initial sync failed:', error);
      // Don't fail auth - user can still use terminal
    }

    // Send success response
    sendResponse({
      type: 'response',
      data: { success: true, output: 'Connected and synchronized' }
    });
  }

  private async handleCommand(ws: WebSocket, message: CommandMessage, sendResponse: (data: any) => void): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      sendResponse({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      });
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
        sendResponse({
          type: 'response',
          data: { success: true, output: text }
        });
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        errorOutput += text;
        sendResponse({
          type: 'response',
          data: { success: false, error: text }
        });
      });

      childProcess.on('close', (code: number | null) => {
        console.log(`[Bridge] Command exited with code ${code}`);
        resolve();
      });
    });
  }

  private async handleGetAllFiles(ws: WebSocket, sendResponse: (data: any) => void): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      sendResponse({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      });
      return;
    }

    try {
      const projectDir = path.join(this.workDir, client.projectId);
      const files = await fs.readdir(projectDir, { withFileTypes: true });

      const fileList = await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(projectDir, file.name);
          const stats = await fs.stat(filePath);
          return {
            id: file.name,
            name: file.name,
            path: `/${file.name}`,
            type: file.isDirectory() ? 'folder' : 'doc',
            modifiedTime: stats.mtimeMs
          };
        })
      );

      sendResponse({
        type: 'ALL_FILES',
        payload: fileList
      });
    } catch (error) {
      console.error('[Bridge] Error getting all files:', error);
      sendResponse({
        type: 'response',
        data: { success: false, error: (error as Error).message }
      });
    }
  }

  private async handleGetFileContent(ws: WebSocket, message: any, sendResponse: (data: any) => void): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      sendResponse({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      });
      return;
    }

    try {
      const { path: filePath } = message.payload;
      const fullPath = path.join(this.workDir, client.projectId, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const checksum = await this.hashContent(content);

      sendResponse({
        type: 'FILE_CONTENT',
        payload: {
          path: filePath,
          content,
          checksum
        }
      });
    } catch (error) {
      console.error('[Bridge] Error getting file content:', error);
      sendResponse({
        type: 'response',
        data: { success: false, error: (error as Error).message }
      });
    }
  }

  private async handleSetFileContent(ws: WebSocket, message: any, sendResponse: (data: any) => void): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      sendResponse({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      });
      return;
    }

    try {
      const { path: filePath, content } = message.payload;
      const fullPath = path.join(this.workDir, client.projectId, filePath);

      // Create directory if it doesn't exist
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // Write file
      await fs.writeFile(fullPath, content, 'utf-8');

      const checksum = await this.hashContent(content);

      sendResponse({
        type: 'FILE_STATUS',
        payload: {
          path: filePath,
          checksum,
          modifiedTime: Date.now()
        }
      });
    } catch (error) {
      console.error('[Bridge] Error setting file content:', error);
      sendResponse({
        type: 'response',
        data: { success: false, error: (error as Error).message }
      });
    }
  }

  private async handleGetFileStatus(ws: WebSocket, message: any, sendResponse: (data: any) => void): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      sendResponse({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      });
      return;
    }

    try {
      const { path: filePath } = message.payload;
      const fullPath = path.join(this.workDir, client.projectId, filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      const stats = await fs.stat(fullPath);
      const checksum = await this.hashContent(content);

      sendResponse({
        type: 'FILE_STATUS',
        payload: {
          path: filePath,
          checksum,
          modifiedTime: stats.mtimeMs
        }
      });
    } catch (error) {
      console.error('[Bridge] Error getting file status:', error);
      sendResponse({
        type: 'response',
        data: { success: false, error: (error as Error).message }
      });
    }
  }

  private async handleFileChanged(ws: WebSocket, message: any, sendResponse: (data: any) => void): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      console.warn('[Bridge] File changed but no client found');
      return;
    }

    const { changeType, path: filePath, docId, content } = message.data;

    console.log(`📝 [Bridge] File changed in Overleaf: ${changeType} - ${filePath}`);
    console.log(`🔍 [Bridge] Project dir: ${this.workDir}`);
    console.log(`🔍 [Bridge] Project ID: ${client.projectId}`);
    console.log(`🔍 [Bridge] Content length: ${content?.length || 0}`);

    try {
      const fullPath = path.join(this.workDir, client.projectId, filePath);
      console.log(`🔍 [Bridge] Full path: ${fullPath}`);
      console.log(`🔍 [Bridge] Dirname: ${path.dirname(fullPath)}`);

      if (changeType === 'modified') {
        // Update local file with content from Overleaf
        if (content !== undefined) {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          console.log(`🔍 [Bridge] About to write ${content.length} bytes to ${fullPath}`);

          await fs.writeFile(fullPath, content, 'utf-8');

          // Verify write
          const stats = await fs.stat(fullPath);
          console.log(`✓ [Bridge] Updated local file: ${filePath} (${stats.size} bytes written)`);
        } else {
          console.warn(`⚠️ [Bridge] No content provided for ${filePath}, skipping update`);
        }
      } else if (changeType === 'created') {
        // Create new local file with content from Overleaf
        if (content !== undefined) {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          console.log(`🔍 [Bridge] About to write ${content.length} bytes to ${fullPath}`);

          await fs.writeFile(fullPath, content, 'utf-8');

          // Verify write
          const stats = await fs.stat(fullPath);
          console.log(`✓ [Bridge] Created new local file: ${filePath} (${stats.size} bytes written)`);
        } else {
          console.warn(`⚠️ [Bridge] No content provided for ${filePath}, skipping creation`);
        }
      } else if (changeType === 'deleted') {
        // Delete local file
        await fs.unlink(fullPath);
        console.log(`✓ [Bridge] Deleted local file: ${filePath}`);
      }

      sendResponse({
        type: 'response',
        data: { success: true, message: `Processed ${changeType} for ${filePath}` }
      });
    } catch (error) {
      console.error(`❌ [Bridge] Error handling file change for ${filePath}:`, error);
      sendResponse({
        type: 'response',
        data: { success: false, error: (error as Error).message }
      });
    }
  }

  private async handleFileDeleted(ws: WebSocket, message: any, sendResponse: (data: any) => void): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      console.warn('[Bridge] File deleted but no client found');
      sendResponse({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      });
      return;
    }

    const { path: filePath, docId } = message.data;
    const projectDir = path.join(this.workDir, client.projectId);

    console.log(`🗑️  [Bridge] File deleted in Overleaf: ${filePath}`);

    try {
      await handleFileDeleted({ path: filePath, docId }, projectDir);

      sendResponse({
        type: 'FILE_DELETED_ACK',
        payload: { path: filePath }
      });
      console.log(`✓ [Bridge] File deleted: ${filePath}`);
    } catch (error) {
      console.error(`✗ [Bridge] Failed to delete ${filePath}:`, error);
      sendResponse({
        type: 'response',
        data: { success: false, error: (error as Error).message }
      });
    }
  }

  private async handleFileCreated(ws: WebSocket, message: any, sendResponse: (data: any) => void): Promise<void> {
    const client = this.clients.get(ws);

    if (!client) {
      console.warn('[Bridge] File created but no client found');
      sendResponse({
        type: 'response',
        data: { success: false, error: 'Not authenticated' }
      });
      return;
    }

    const { path: filePath, docId, name } = message.data;
    const projectDir = path.join(this.workDir, client.projectId);

    console.log(`📝 [Bridge] File created in Overleaf: ${filePath}`);

    try {
      await handleFileCreated({ path: filePath, docId, name }, projectDir);

      sendResponse({
        type: 'FILE_CREATED_ACK',
        payload: { path: filePath }
      });
      console.log(`✓ [Bridge] File created: ${filePath}`);
    } catch (error) {
      console.error(`✗ [Bridge] Failed to create ${filePath}:`, error);
      sendResponse({
        type: 'response',
        data: { success: false, error: (error as Error).message }
      });
    }
  }

  private async hashContent(content: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  close(): void {
    this.wss.close();
    this.clients.forEach((client) => {
      client.syncManager.stop();
    });
  }
}
