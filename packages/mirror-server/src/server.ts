import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ClientConnection } from './client-connection';
import { FileWatcher } from './filesystem/watcher';
import { handleEditMonitor } from './handlers/edit-monitor';
import { FileOperationHandler } from './handlers/file-operation';
import { ProjectConfigStore } from './config';
import { OverleafAPIClient } from './api';
import { OverleafWebSocketClient } from './overleaf-websocket';
import { TextFileSyncManager } from './sync';
import type { WSMessage, SyncCommandMessage } from './types';
import type { EditEventMessage } from '@overleaf-cc/shared';

const PORT = 3456;

export class MirrorServer {
  private wss: WebSocketServer;
  private httpServer: HttpServer;
  private connections: Map<WebSocket, ClientConnection> = new Map();
  private fileWatchers: Map<string, FileWatcher> = new Map();

  // Add these:
  private configStore: ProjectConfigStore;
  private textSyncManagers: Map<string, TextFileSyncManager> = new Map();
  private projectCookies: Map<string, Map<string, string>> = new Map();
  private projectCsrfTokens: Map<string, string> = new Map(); // Store CSRF tokens
  private fileHandlers: Map<string, FileOperationHandler> = new Map();

  // 🔧 存储 blob hash 到文件名的映射
  private blobMappings: Map<string, Map<string, string>> = new Map(); // projectId -> Map<blobHash, filename>

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

    // Initialize ProjectConfigStore
    this.configStore = new ProjectConfigStore();
    console.log('[Server] ProjectConfigStore initialized');

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
    const { projectId, method, apiEndpoint, body } = data;

    console.log('[HTTP] Received:', method, apiEndpoint);

    // Get or create file handler for this project
    let handler = this.fileHandlers.get(projectId);

    if (!handler) {
      const projectConfig = this.configStore.getProjectConfig(projectId);

      // Get cookies for this project
      const cookies = this.projectCookies.get(projectId);

      if (!cookies) {
        console.warn(`[HTTP] No cookies found for project ${projectId}, cannot handle request`);
        return;
      }

      const apiClient = new OverleafAPIClient(cookies);
      handler = new FileOperationHandler(projectConfig, apiClient);

      this.fileHandlers.set(projectId, handler);
    }

    // Handle the request
    handler.handleMirrorRequest({ projectId, method, apiEndpoint, body });
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[Server] New connection established');
      const connection = new ClientConnection(ws, '');

      this.connections.set(ws, connection);

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
      });

      ws.on('close', () => {
        console.log('[Server] Connection closed');
        this.connections.delete(ws);
      });

      connection.onMessage((message: WSMessage) => {
        console.log('[Server] Message received:', message.type);

        // 🔧 Handle cookies from both mirror and edit_event messages
        if (message.type === 'mirror') {
          const mirrorMsg = message as any;
          if (mirrorMsg.cookies) {
            const projectId = mirrorMsg.project_id;
            const cookieMap = this.storeCookies(mirrorMsg.cookies);
            this.projectCookies.set(projectId, cookieMap);
            console.log(`[Server] ✅ Stored ${cookieMap.size} cookies for project ${projectId}`);

            // 🔧 Store CSRF token if present
            if (mirrorMsg.csrf_token) {
              this.projectCsrfTokens.set(projectId, mirrorMsg.csrf_token);
              console.log(`[Server] ✅ Stored CSRF token for project ${projectId}:`, mirrorMsg.csrf_token.substring(0, 20) + '...');
            }
          }
        } else if (message.type === 'edit_event') {
          // 🔧 新增：从编辑事件中提取 cookies
          const editMsg = message as any;
          if (editMsg.cookies) {
            const projectId = editMsg.project_id;
            const cookieMap = this.storeCookies(editMsg.cookies);
            this.projectCookies.set(projectId, cookieMap);
            console.log(`[Server] ✅ Stored ${cookieMap.size} cookies from edit_event for project ${projectId}`);
          } else {
            console.log(`[Server] ⚠️ No cookies in edit_event message for project ${editMsg.project_id}`);
          }
        }

        this.handleMessage(connection, message);
      });
    });
  }

  private handleMessage(connection: ClientConnection, message: WSMessage): void {
    console.log('[Server] Handling message type:', message.type);

    switch (message.type) {
      case 'mirror':
        console.log('Received mirror request:', message.api_endpoint);
        // Will be implemented in later tasks
        break;
      case 'edit_event':
        console.log('[Server] Routing to edit_event handler');

        handleEditMonitor(
          message as EditEventMessage,
          this.configStore,
          (projectId: string) => {
            const cookies = this.projectCookies.get(projectId);
            if (!cookies) {
              console.warn(`[Server] ❌ No cookies for project ${projectId}`);
              console.log(`[Server] Available projects in cookies map:`, Array.from(this.projectCookies.keys()));
              return null;
            }
            console.log(`[Server] ✅ Found ${cookies.size} cookies for project ${projectId}`);
            return new OverleafAPIClient(cookies);
          },
          (projectId: string, config: any, apiClient: OverleafAPIClient) => {
            if (!this.textSyncManagers.has(projectId)) {
              const manager = new TextFileSyncManager(config, apiClient);
              this.textSyncManagers.set(projectId, manager);
              console.log(`[Server] ✅ Created TextFileSyncManager for ${projectId}`);
            }
            return this.textSyncManagers.get(projectId)!;
          }
        );

        break;
      case 'sync':
        const syncMessage = message as SyncCommandMessage;
        console.log('[Server] 📨 Received sync command:', syncMessage.operation);

        // 🔧 处理初始同步请求
        if (syncMessage.operation === 'initial_sync') {
          console.log('[Server] 🔄 Starting initial sync for project:', syncMessage.project_id);
          this.handleInitialSync(syncMessage.project_id);
        }

        // Start file watcher for this project if not already watching
        if (!this.fileWatchers.has(syncMessage.project_id)) {
          const watcher = new FileWatcher(syncMessage.project_id);
          this.fileWatchers.set(syncMessage.project_id, watcher);
          watcher.start().catch((error) => {
            console.error(`Failed to start file watcher for ${syncMessage.project_id}:`, error);
          });
        }
        break;
      case 'file_sync':
        // 🔧 处理文件同步（从浏览器扩展接收文件内容）
        const fileSyncMsg = message as any;
        console.log('[Server] 📥 Received file sync:', fileSyncMsg.path);
        this.handleFileSync(fileSyncMsg.project_id, fileSyncMsg.path, fileSyncMsg.content_type, fileSyncMsg.content);
        break;
      case 'blob_mapping':
        // 🔧 处理 blob 映射
        const blobMsg = message as any;
        console.log('[Server] 📋 Received blob mapping:', blobMsg.filename, '->', blobMsg.blob_hash);
        this.handleBlobMapping(blobMsg.project_id, blobMsg.blob_hash, blobMsg.filename);
        break;
      default:
        console.warn('Unknown message type:', message);
    }
  }

  /**
   * 辅助方法：将 cookies 对象转换为 Map
   *
   * @param cookies - cookies 对象
   * @returns Map<string, string>
   * @private
   */
  private storeCookies(cookies: { [key: string]: string }): Map<string, string> {
    const cookieMap = new Map<string, string>();
    Object.entries(cookies).forEach(([key, value]) => {
      if (typeof value === 'string') {
        cookieMap.set(key, value);
      }
    });
    return cookieMap;
  }

  /**
   * 处理 blob 映射
   *
   * @param projectId - 项目 ID
   * @param blobHash - blob hash
   * @param filename - 文件名
   * @private
   */
  private async handleBlobMapping(projectId: string, blobHash: string, filename: string): Promise<void> {
    try {
      // 初始化项目的映射表
      if (!this.blobMappings.has(projectId)) {
        this.blobMappings.set(projectId, new Map());
      }

      // 存储 blob hash -> filename 映射
      this.blobMappings.get(projectId)!.set(blobHash, filename);
      console.log('[Server] ✅ Stored blob mapping:', filename, '->', blobHash);

      // 🔧 立即下载文件内容
      await this.downloadFileByBlob(projectId, blobHash, filename);

      // 打印当前所有映射
      const mappings = this.blobMappings.get(projectId);
      if (mappings && mappings.size > 0) {
        console.log('[Server] 📋 Current blob mappings:', Array.from(mappings.entries()));
      }
    } catch (error) {
      console.error('[Server] ❌ Failed to handle blob mapping:', error);
    }
  }

  /**
   * 通过 blob hash 下载文件
   *
   * @param projectId - 项目 ID
   * @param blobHash - blob hash
   * @param filename - 文件名
   * @private
   */
  private async downloadFileByBlob(projectId: string, blobHash: string, filename: string): Promise<void> {
    try {
      console.log('[Server] 📥 Downloading file via blob:', filename);

      // 获取 cookies
      const cookies = this.projectCookies.get(projectId);
      if (!cookies) {
        console.error('[Server] ❌ No cookies for project');
        return;
      }

      // 创建 API 客户端
      const apiClient = new OverleafAPIClient(cookies);

      // 获取 blob 内容
      const content = await apiClient.getBlobContent(projectId, blobHash);

      // 获取项目配置
      const projectConfig = this.configStore.getProjectConfig(projectId);

      // 写入本地文件
      const fs = require('fs');
      const path = require('path');
      const filePath = path.join(projectConfig.localPath, filename);

      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('[Server] ✅ Saved:', filename, `(${content.length} chars) to`, filePath);
    } catch (error) {
      console.error('[Server] ❌ Failed to download file by blob:', filename, error);
    }
  }

  /**
   * 处理文件同步（从浏览器扩展接收文件内容并保存）
   *
   * @param projectId - 项目 ID
   * @param path - 文件路径
   * @param contentType - 内容类型
   * @param content - 内容（Base64 编码的二进制文件或纯文本）
   * @private
   */
  private handleFileSync(projectId: string, path: string, contentType: 'doc' | 'file', content: string): void {
    try {
      console.log('[Server] 📥 Saving file:', path, 'type:', contentType);

      // 获取项目配置
      const projectConfig = this.configStore.getProjectConfig(projectId);
      const fs = require('fs');
      const pathModule = require('path');
      const filePath = pathModule.join(projectConfig.localPath, path);

      // 确保目录存在
      const dir = pathModule.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('[Server] 📁 Created directory:', dir);
      }

      // 根据类型写入文件
      if (contentType === 'file') {
        // 二进制文件 - 从 Base64 解码
        const buffer = Buffer.from(content, 'base64');
        fs.writeFileSync(filePath, buffer);
        console.log('[Server] ✅ Saved binary file:', path, `(${buffer.length} bytes) to`, filePath);
      } else {
        // 文本文件 - 直接写入
        fs.writeFileSync(filePath, content, 'utf8');
        console.log('[Server] ✅ Saved text file:', path, `(${content.length} chars) to`, filePath);
      }
    } catch (error) {
      console.error('[Server] ❌ Failed to save file:', path, error);
    }
  }

  /**
   * 处理初始同步请求
   *
   * @param projectId - 项目 ID
   * @private
   */
  private async handleInitialSync(projectId: string): Promise<void> {
    try {
      console.log('[Server] 🔄 Handling initial sync for project:', projectId);

      // 获取 cookies
      const cookies = this.projectCookies.get(projectId);
      if (!cookies) {
        console.error('[Server] ❌ No cookies for project, cannot sync:', projectId);
        return;
      }

      console.log('[Server] ✅ Found', cookies.size, 'cookies for sync');

      // 获取项目配置（会自动创建默认配置）
      const projectConfig = this.configStore.getProjectConfig(projectId);
      console.log('[Server] 📂 Local path:', projectConfig.localPath);

      // 🔧 使用 WebSocket 客户端同步所有文件
      const overleafSession2 = cookies.get('overleaf_session2');
      const GCLB = cookies.get('GCLB');

      if (!overleafSession2) {
        console.error('[Server] ❌ Missing overleaf_session2 cookie');
        return;
      }

      // 获取 CSRF token（从存储的 map 中查找）
      const csrfToken = this.projectCsrfTokens.get(projectId) || '';

      if (!csrfToken) {
        console.warn('[Server] ⚠️ No CSRF token found, WebSocket connection may fail');
      } else {
        console.log('[Server] ✅ Using CSRF token:', csrfToken.substring(0, 20) + '...');
      }

      console.log('[Server] 🔌 Connecting to Overleaf WebSocket...');

      // 从 cookies Map 转换为 auth 对象
      const auth = {
        cookieOverleafSession2: overleafSession2,
        cookieGCLB: GCLB || ''
      };

      // 创建 WebSocket 客户端
      const wsClient = new OverleafWebSocketClient(
        projectId,
        auth,
        csrfToken
      );

      // 连接到 WebSocket
      await wsClient.connect();

      // 加入项目获取结构
      await wsClient.joinProject();

      // 等待项目结构加载
      await wsClient.waitForProjectJoin();

      console.log('[Server] 📋 Project structure loaded, fetching files...');

      // 获取所有文件 ID
      const allIds = wsClient.getAllDocIds();
      console.log('[Server] ✅ Found', allIds.length, 'files in project');

      // 同步所有文件
      let syncedCount = 0;
      for (const id of allIds) {
        try {
          const info = wsClient.getDocInfo(id);
          if (!info) {
            console.warn('[Server] ⚠️ No info found for', id, ', skipping');
            continue;
          }

          console.log('[Server] 📥 Syncing:', info.path);

          if (info.type === 'doc') {
            // 文本文件 - 使用 joinDoc 获取内容
            const lines = await wsClient.joinDoc(id);
            await wsClient.leaveDoc(id);

            // 写入本地文件
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(projectConfig.localPath, info.path);

            // 确保目录存在
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }

            // 写入文件
            const content = lines.join('\n');
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('[Server] ✅ Saved:', info.path, `(${content.length} chars, ${lines.length} lines)`);
            syncedCount++;
          } else if (info.type === 'file') {
            // 二进制文件 - 使用 downloadFile 获取内容
            const buffer = await wsClient.downloadFile(id);

            // 写入本地文件
            const fs = require('fs');
            const path = require('path');
            const filePath = path.join(projectConfig.localPath, info.path);

            // 确保目录存在
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }

            // 写入二进制文件
            fs.writeFileSync(filePath, buffer);
            console.log('[Server] ✅ Saved:', info.path, `(${buffer.length} bytes, binary)`);
            syncedCount++;
          }
        } catch (error) {
          console.error('[Server] ❌ Failed to sync', id, ':', error);
        }
      }

      // 断开 WebSocket 连接
      wsClient.disconnect();

      console.log('[Server] ✅ Initial sync complete:', syncedCount, 'files downloaded to', projectConfig.localPath);

    } catch (error) {
      console.error('[Server] ❌ Initial sync failed:', error);
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
