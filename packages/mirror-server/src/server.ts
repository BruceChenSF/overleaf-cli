import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ClientConnection } from './client-connection';
import { FileWatcher } from './filesystem/watcher';
import { startFileSync, endFileSync } from './filesystem/watcher';
import { OverleafSyncManager } from './sync/overleaf-sync-manager';
import { handleEditMonitor } from './handlers/edit-monitor';
import { FileOperationHandler } from './handlers/file-operation';
import { ProjectConfigStore } from './config';
import { OverleafAPIClient } from './api';
import { TextFileSyncManager } from './sync';
import type { WSMessage, SyncCommandMessage, ServerConfig } from './types';
import type { EditEventMessage } from '@overleaf-cc/shared';
import type { FileChangeEvent } from './filesystem/watcher';

const PORT = 3456;

export class MirrorServer {
  private wss: WebSocketServer;
  private httpServer: HttpServer;
  private connections: Map<WebSocket, ClientConnection> = new Map();
  private fileWatchers: Map<string, FileWatcher> = new Map();

  // Add these:
  private configStore: ProjectConfigStore;
  private textSyncManagers: Map<string, TextFileSyncManager> = new Map();
  private syncManagers: Map<string, OverleafSyncManager> = new Map();
  private projectCookies: Map<string, Map<string, string>> = new Map();
  private projectCsrfTokens: Map<string, string> = new Map(); // Store CSRF tokens
  private fileHandlers: Map<string, FileOperationHandler> = new Map();
  private config: ServerConfig;

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

    // Initialize server config
    this.config = {
      port: PORT,
      host: 'localhost',
      projectDir: './projects',
      maxConnections: 100,
      enableLogging: true,
    };

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
    // Handle both snake_case and camelCase field names
    const projectId = data.project_id || data.projectId;
    const method = data.method;
    const apiEndpoint = data.api_endpoint || data.apiEndpoint;
    const body = data.data || data.body;

    console.log('[HTTP] Received:', method, apiEndpoint);
    console.log('[HTTP] Request data:', JSON.stringify(data, null, 2));

    if (!projectId) {
      console.error('[HTTP] Missing project_id in request');
      return;
    }

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
      case 'file_created':
        // 🔧 处理文件创建
        const fileCreatedMsg = message as any;
        console.log('[Server] ➕ Received file creation event:', fileCreatedMsg.file_name);
        this.handleFileCreated(fileCreatedMsg.project_id, fileCreatedMsg.file_name);
        break;
      case 'file_deleted':
        // 🔧 处理文件删除
        const fileDeletedMsg = message as any;
        console.log('[Server] 🗑️ Received file deletion event:', fileDeletedMsg.path);
        this.handleFileDeleted(fileDeletedMsg.project_id, fileDeletedMsg.path);
        break;
      case 'file_renamed':
        // 🔧 处理文件重命名
        const fileRenamedMsg = message as any;
        console.log('[Server] ✏️ Received file rename event:', fileRenamedMsg.old_name, '->', fileRenamedMsg.new_name);
        this.handleFileRenamed(fileRenamedMsg.project_id, fileRenamedMsg.old_name, fileRenamedMsg.new_name);
        break;
      case 'sync_to_overleaf_response':
        this.handleSyncResponse(message);
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
    let syncId: string | null = null;

    try {
      console.log('[Server] 📥 Saving file:', path, 'type:', contentType);

      // 获取项目配置
      const projectConfig = this.configStore.getProjectConfig(projectId);
      const fs = require('fs');
      const pathModule = require('path');
      const filePath = pathModule.join(projectConfig.localPath, path);

      // 🔧 Create marker file BEFORE saving (this signals FileWatcher to ignore changes)
      syncId = startFileSync(projectId, projectConfig.localPath, path);

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

      // 🔧 Remove marker file AFTER saving (FileWatcher can now detect user edits)
      if (syncId) {
        endFileSync(syncId);
      }
    } catch (error) {
      console.error('[Server] ❌ Failed to save file:', path, error);

      // 🔧 Make sure to remove marker file even if save failed
      if (syncId) {
        endFileSync(syncId);
      }
    }
  }

  /**
   * 处理文件创建事件
   *
   * @param projectId - 项目 ID
   * @param fileName - 文件名
   * @private
   */
  private handleFileCreated(projectId: string, fileName: string): void {
    try {
      console.log('[Server] ➕ Creating file:', fileName);

      const projectConfig = this.configStore.getProjectConfig(projectId);
      const fs = require('fs');
      const pathModule = require('path');
      const filePath = pathModule.join(projectConfig.localPath, fileName);

      // 检查文件是否已存在
      if (fs.existsSync(filePath)) {
        console.log('[Server] ⚠️ File already exists:', fileName, '(skipping)');
        return;
      }

      // 确保目录存在
      const dir = pathModule.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 创建空文件
      fs.writeFileSync(filePath, '', 'utf8');
      console.log('[Server] ✅ Created empty file:', fileName);
    } catch (error) {
      console.error('[Server] ❌ Failed to create file:', fileName, error);
    }
  }

  /**
   * 处理文件删除事件
   *
   * @param projectId - 项目 ID
   * @param filePath - 文件路径
   * @private
   */
  private handleFileDeleted(projectId: string, filePath: string): void {
    try {
      console.log('[Server] 🗑️ Deleting file:', filePath);

      const projectConfig = this.configStore.getProjectConfig(projectId);
      const fs = require('fs');
      const pathModule = require('path');

      const fullPath = pathModule.join(projectConfig.localPath, filePath);

      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        console.log('[Server] ⚠️ File not found:', fullPath, '(skipping)');
        return;
      }

      // 删除文件
      fs.unlinkSync(fullPath);
      console.log('[Server] ✅ Deleted file:', filePath);
    } catch (error) {
      console.error('[Server] ❌ Failed to delete file:', filePath, error);
    }
  }

  /**
   * 处理文件重命名事件
   *
   * @param projectId - 项目 ID
   * @param oldName - 旧文件名
   * @param newName - 新文件名
   * @private
   */
  private handleFileRenamed(projectId: string, oldName: string, newName: string): void {
    try {
      console.log('[Server] ✏️ Renaming file:', oldName, '->', newName);

      const projectConfig = this.configStore.getProjectConfig(projectId);
      const fs = require('fs');
      const pathModule = require('path');

      const oldPath = pathModule.join(projectConfig.localPath, oldName);
      const newPath = pathModule.join(projectConfig.localPath, newName);

      // 检查旧文件是否存在
      if (!fs.existsSync(oldPath)) {
        console.log('[Server] ⚠️ Old file not found:', oldPath, '(skipping)');
        return;
      }

      // 确保新文件的目录存在
      const newDir = pathModule.dirname(newPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      // 重命名文件
      fs.renameSync(oldPath, newPath);
      console.log('[Server] ✅ Renamed file:', oldName, '->', newName);
    } catch (error) {
      console.error('[Server] ❌ Failed to rename file:', oldName, '->', newName, error);
    }
  }

  /**
   * 处理初始同步请求
   *
   * @param projectId - 项目 ID
   * @private
   */
  private async handleInitialSync(projectId: string): Promise<void> {
    // 获取项目配置（会自动创建默认配置）- 必须在 try 块外
    const projectConfig = this.configStore.getProjectConfig(projectId);
    console.log('[Server] 📂 Local path:', projectConfig.localPath);

    // 确保项目目录存在
    const fs = await import('fs-extra');
    await fs.ensureDir(projectConfig.localPath);
    console.log('[Server] ✅ Project directory created/verified:', projectConfig.localPath);

    // Build docIdToPath mapping - 必须在 try 块外
    const docIdToPath = new Map<string, any>();

    console.log('[Server] 🔄 Waiting for browser extension to send files...');
    console.log('[Server] ℹ️ Browser extension will handle Overleaf WebSocket connection and file fetching');
    console.log('[Server] ℹ️ Files will be received via file_sync messages');

    // 注意：实际的文件同步现在由浏览器扩展处理：
    // 1. 浏览器扩展连接到 Overleaf WebSocket（使用原生浏览器 WebSocket）
    // 2. 浏览器扩展获取所有文件内容
    // 3. 浏览器扩展通过 file_sync 消息发送文件到这个服务器
    // 4. 服务器接收文件并保存到本地

    // Save configuration
    await this.configStore.save();

    // Start file sync if enabled
    console.log(`[Server] 🔍 Checking file sync config...`);
    console.log(`[Server] 🔍 enableFileSync value:`, projectConfig.enableFileSync);
    console.log(`[Server] 🔍 Project config:`, JSON.stringify(projectConfig, null, 2));

    if (projectConfig.enableFileSync) {
      console.log('[Server] 🔄 File sync enabled, starting continuous sync...');
      this.startFileSync(projectId, docIdToPath);
    } else {
      console.log('[Server] ℹ️ File sync not enabled (set enableFileSync: true in config to enable)');
    }
  }

  /**
   * Start file sync for a project
   *
   * @param projectId - Project ID
   * @param docIdToPath - Map of doc IDs to file info
   * @private
   */
  private startFileSync(projectId: string, docIdToPath: Map<string, any>): void {
    console.log(`[Server] 🔧 startFileSync() called for project: ${projectId}`);
    console.log(`[Server] 🔧 docIdToPath has ${docIdToPath.size} entries`);

    // Stop existing file sync if already running
    if (this.fileWatchers.has(projectId) || this.syncManagers.has(projectId)) {
      console.log(`[Server] 🔧 Stopping existing file sync for project: ${projectId}`);
      this.stopFileSync(projectId);
    }

    // Get project config
    const config = this.configStore.getProjectConfig(projectId);
    console.log(`[Server] 🔧 Project config loaded:`, config ? 'Found' : 'Not found');
    if (!config || !config.localPath) {
      console.error(`[Server] ❌ No local path found for project: ${projectId}`);
      console.error(`[Server] 🔧 Config:`, JSON.stringify(config, null, 2));
      return;
    }

    console.log(`[Server] 🔧 Local path: ${config.localPath}`);
    console.log(`[Server] 🔧 File sync enabled: ${config.enableFileSync}`);

    // Create FileWatcher
    console.log(`[Server] 🔧 Creating FileWatcher...`);
    const fileWatcher = new FileWatcher(projectId, config.localPath);

    // Create SyncManager
    console.log(`[Server] 🔧 Creating OverleafSyncManager...`);
    const syncManager = new OverleafSyncManager(projectId, this.config.port);

    // Initialize mappings
    console.log(`[Server] 🔧 Initializing ${docIdToPath.size} mappings...`);
    syncManager.initializeMappings(docIdToPath);

    // Set up callback
    console.log(`[Server] 🔧 Registering file change callback...`);
    fileWatcher.onChange((event: FileChangeEvent) => {
      console.log(`[Server] 🔧 File change callback triggered:`, event);
      syncManager.handleFileChange(event);
    });

    // Store instances
    this.fileWatchers.set(projectId, fileWatcher);
    this.syncManagers.set(projectId, syncManager);

    // Start watching
    console.log(`[Server] 🔧 Starting file watcher...`);
    fileWatcher.start().catch((error) => {
      console.error(`[Server] ❌ Failed to start file watcher:`, error);
      // Clean up both instances
      this.stopFileSync(projectId);
    });

    console.log(`[Server] ✅ File sync started for project: ${projectId}`);
  }

  /**
   * Stop file sync for a project
   *
   * @param projectId - Project ID
   * @private
   */
  private stopFileSync(projectId: string): void {
    const fileWatcher = this.fileWatchers.get(projectId);
    const syncManager = this.syncManagers.get(projectId);

    if (fileWatcher) {
      fileWatcher.stop();
      this.fileWatchers.delete(projectId);
    }

    if (syncManager) {
      syncManager.stop();
      this.syncManagers.delete(projectId);
    }

    console.log(`[Server] Stopped file sync for project: ${projectId}`);
  }

  /**
   * Handle sync response from extension
   *
   * @param message - Sync response message
   * @private
   */
  private handleSyncResponse(message: any): void {
    const { project_id, success, operation, path, doc_id, error } = message;

    const syncManager = this.syncManagers.get(project_id);
    if (!syncManager) {
      console.warn(`[Server] ⚠️ No sync manager for project: ${project_id}`);
      return;
    }

    if (success) {
      console.log(`[Server] ✅ Sync to Overleaf successful: ${operation} ${path}`);

      // Update mapping for create operations
      if (operation === 'create' && doc_id) {
        syncManager.updateMapping(path, doc_id);
      }
    } else {
      console.error(`[Server] ❌ Sync to Overleaf failed: ${operation} ${path} - ${error}`);
    }
  }

  broadcast(message: WSMessage): void {
    this.connections.forEach((connection) => {
      // Handle broadcasting if needed
    });
  }

  close(): void {
    // Stop all file sync
    for (const projectId of this.syncManagers.keys()) {
      this.stopFileSync(projectId);
    }

    // Stop all file watchers
    this.fileWatchers.forEach((watcher) => {
      watcher.stop();
    });
    this.fileWatchers.clear();

    // Close WebSocket server
    this.wss.close();
  }
}
