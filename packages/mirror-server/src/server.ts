import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ClientConnection } from './client-connection';
import { FileWatcher } from './filesystem/watcher';
import { startFileSync, endFileSync, startDirectorySync, endDirectorySync } from './filesystem/watcher';
import { OverleafSyncManager } from './sync/overleaf-sync-manager';
import { handleEditMonitor } from './handlers/edit-monitor';
import { FileOperationHandler } from './handlers/file-operation';
import { ProjectConfigStore } from './config';
import { OverleafAPIClient } from './api';
import { TextFileSyncManager } from './sync';
import { SyncOrchestrator } from './sync/sync-orchestrator';
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

  // NEW: SyncOrchestrator - 中心化同步编排器
  private orchestrator: SyncOrchestrator;

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

    // NEW: Initialize SyncOrchestrator
    this.orchestrator = new SyncOrchestrator({ enableDebugLogging: true });
    console.log('[Server] SyncOrchestrator initialized');

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

        // 🔧 Update docId mapping from edit_event
        const editMessage = message as EditEventMessage;
        if (editMessage.data && editMessage.data.doc_name && editMessage.data.doc_id) {
          const syncManager = this.syncManagers.get(editMessage.project_id);
          if (syncManager) {
            syncManager.updateMapping(editMessage.data.doc_name, editMessage.data.doc_id);
            console.log(`[Server] 📝 Updated docId mapping: ${editMessage.data.doc_name} -> ${editMessage.data.doc_id}`);
          }
        }

        handleEditMonitor(
          editMessage,
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
          const watcher = new FileWatcher(syncMessage.project_id, undefined, this.orchestrator);
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
        this.handleFileSync(fileSyncMsg.project_id, fileSyncMsg.path, fileSyncMsg.content_type, fileSyncMsg.content, fileSyncMsg.doc_id);
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
      case 'directory_created':
        // 🔧 处理文件夹创建
        const dirCreatedMsg = message as any;
        console.log('[Server] 📁➕ Received directory creation event:', dirCreatedMsg.path);
        console.log('[Server]    Folder ID:', dirCreatedMsg.folder_id);
        console.log('[Server] ⚠️ [PLACEHOLDER] Directory creation not yet implemented');
        console.log('[Server]    Would create directory:', dirCreatedMsg.path);
        this.handleDirectoryCreated(dirCreatedMsg.project_id, dirCreatedMsg.path, dirCreatedMsg.folder_id);
        break;
      case 'file_deleted':
        // 🔧 处理文件删除
        const fileDeletedMsg = message as any;
        console.log('[Server] 🗑️ Received file deletion event:', fileDeletedMsg.path);
        this.handleFileDeleted(fileDeletedMsg.project_id, fileDeletedMsg.path);
        break;
      case 'initial_sync_complete':
        // 🔧 初始同步完成，启用文件监控
        const syncCompleteMsg = message as any;
        console.log('[Server] ✅ Initial sync complete for project:', syncCompleteMsg.project_id);
        this.handleInitialSyncComplete(syncCompleteMsg.project_id);
        break;
      case 'file_renamed':
        // 🔧 处理文件重命名
        const fileRenamedMsg = message as any;
        console.log('[Server] ✏️ Received file rename event:', fileRenamedMsg.old_name, '->', fileRenamedMsg.new_name);
        this.handleFileRenamed(fileRenamedMsg.project_id, fileRenamedMsg.old_name, fileRenamedMsg.new_name);
        break;
      case 'directory_renamed':
        // 🔧 处理文件夹重命名
        const dirRenamedMsg = message as any;
        console.log('[Server] 📁✏️ Received directory rename event:', dirRenamedMsg.old_path, '->', dirRenamedMsg.new_path);
        this.handleDirectoryRenamed(dirRenamedMsg.project_id, dirRenamedMsg.old_path, dirRenamedMsg.new_path, dirRenamedMsg.folder_id);
        break;
      case 'directory_deleted':
        // 🔧 处理文件夹删除
        const dirDeletedMsg = message as any;
        console.log('[Server] 📁🗑️ Received directory deletion event:', dirDeletedMsg.path);
        this.handleDirectoryDeleted(dirDeletedMsg.project_id, dirDeletedMsg.path, dirDeletedMsg.folder_id);
        break;
      case 'sync_to_overleaf':
        // 🔧 Forward sync request to browser extension
        console.log('[Server] 📤 Forwarding sync request to browser extension:', (message as any).path);
        this.broadcastToExtensions(message);
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
   * @param docId - Overleaf 文档 ID（可选，用于建立映射）
   * @private
   */
  private handleFileSync(projectId: string, path: string, contentType: 'doc' | 'file', content: string, docId?: string): void {
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

      // 🔧 IMPORTANT: Update docId mapping if docId is provided
      // This allows OverleafSyncManager to correctly determine update vs create operations
      if (docId) {
        const syncManager = this.syncManagers.get(projectId);
        if (syncManager) {
          syncManager.updateMapping(path, docId);
          console.log(`[Server] 📝 Updated docId mapping from initial sync: ${path} -> ${docId}`);
        } else {
          console.log(`[Server] ⚠️ No syncManager found for ${projectId}, mapping will be updated later`);
        }
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
   * 处理文件夹创建事件
   *
   * @param projectId - 项目 ID
   * @param directoryPath - 文件夹路径
   * @param folderId - 文件夹 ID
   * @private
   */
  private handleDirectoryCreated(projectId: string, directoryPath: string, folderId: string): void {
    try {
      console.log('[Server] 📁➕ Creating directory:', directoryPath);
      console.log('[Server]    Folder ID:', folderId);

      const projectConfig = this.configStore.getProjectConfig(projectId);
      const pathModule = require('path');
      const fs = require('fs');

      const dirPath = pathModule.join(projectConfig.localPath, directoryPath);

      // Check if directory already exists
      if (fs.existsSync(dirPath)) {
        console.log('[Server] ⚠️ Directory already exists:', directoryPath, '(skipping)');
        return;
      }

      // 🔧 IMPORTANT: Start directory sync BEFORE creating directory
      // This creates a marker file to prevent FileWatcher from triggering a sync loop
      const { startDirectorySync, endDirectorySync } = require('./filesystem/watcher');
      const syncId = startDirectorySync(projectId, projectConfig.localPath, directoryPath);
      console.log('[Server] 🔒 Started directory sync operation:', syncId);

      // Create the directory (note: startDirectorySync already created it, but let's be sure)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log('[Server] ✅ Created directory:', directoryPath);
      } else {
        console.log('[Server] ℹ️ Directory already existed (created by startDirectorySync):', directoryPath);
      }

      // 🔧 IMPORTANT: End directory sync AFTER creating directory
      // This tells FileWatcher that the directory is ready and marker file can be cleaned up
      endDirectorySync(syncId);
      console.log('[Server] 🔓 Ended directory sync operation, waiting for FileWatcher ACK');

      // 🔧 IMPORTANT: Update folderId mapping if folderId is provided
      // This allows OverleafSyncManager to correctly track this folder
      if (folderId) {
        const syncManager = this.syncManagers.get(projectId);
        if (syncManager) {
          syncManager.updateFolderMapping(directoryPath, folderId);
          console.log(`[Server] 📝 Updated folderId mapping for directory: ${directoryPath} -> ${folderId}`);
        } else {
          console.log(`[Server] ⚠️ No syncManager found for ${projectId}, folder mapping will be updated later`);
        }
      }

    } catch (error) {
      console.error('[Server] ❌ Failed to create directory:', directoryPath, error);
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

      // 🔧 FIX: Normalize path separators (Windows \ to /) for Orchestrator matching
      const normalizedPath = filePath.replace(/\\/g, '/');

      // NEW: SyncOrchestrator - Start tracking operation with normalized path
      const operation = this.orchestrator.startOperation(
        'overleaf',
        'delete',
        normalizedPath,  // Use normalized path
        undefined,
        { projectId }
      );

      const fullPath = pathModule.join(projectConfig.localPath, filePath);

      // 检查文件是否存在
      if (!fs.existsSync(fullPath)) {
        console.log('[Server] ⚠️ File not found:', fullPath, '(skipping)');
        this.orchestrator.failOperation(operation.operationId);
        return;
      }

      // OLD: Marker mechanism (kept for rollback safety - Phase 3 will remove this)
      // 🔧 Create marker file BEFORE deleting (this signals FileWatcher to ignore the delete)
      const syncId = startFileSync(projectId, projectConfig.localPath, filePath);
      console.log('[Server] 📝 Created delete marker:', syncId);

      // 删除文件
      fs.unlinkSync(fullPath);
      console.log('[Server] ✅ Deleted file:', filePath);

      // NEW: SyncOrchestrator - Mark operation as complete
      this.orchestrator.completeOperation(operation.operationId);

      // OLD: Marker mechanism (kept for rollback safety - Phase 3 will remove this)
      // 🔧 Transition to AWAITING_ACK state (FileWatcher will ACK when it detects the delete)
      endFileSync(syncId);
      console.log('[Server] ⏳ Waiting for FileWatcher to acknowledge delete');
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
    // NEW: SyncOrchestrator - Start tracking operation
    const operation = this.orchestrator.startOperation(
      'overleaf',
      'rename',
      newName,
      oldName,
      { projectId }
    );

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
        this.orchestrator.failOperation(operation.operationId);
        return;
      }

      // 确保新文件的目录存在
      const newDir = pathModule.dirname(newPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      // OLD: Marker mechanism (kept for rollback safety)
      // // 🔧 FIX: Mark old file as being renamed (to prevent false delete detection)
      // const syncManager = this.syncManagers.get(projectId);
      // if (syncManager) {
      //   syncManager.markRenaming(oldName);
      //   console.log('[Server] 🔄 Marked old file as being renamed:', oldName);
      // }
      //
      // // 🔧 Create marker file for NEW name BEFORE renaming
      // // This tells FileWatcher to ignore the rename when it detects the new file
      // const syncId = startFileSync(projectId, projectConfig.localPath, newName);
      // console.log('[Server] 📝 Created rename marker for new name:', newName, '(syncId:', syncId + ')');

      // 重命名文件
      fs.renameSync(oldPath, newPath);
      console.log('[Server] ✅ Renamed file:', oldName, '->', newName);

      // NEW: SyncOrchestrator - Delay completion to allow FileWatcher to detect the rename
      // FileWatcher needs ~1-2 seconds to detect the rename and clear its pending deletes
      // We delay completion so that shouldProcessEvent() can still block the FileWatcher's rename event
      setTimeout(() => {
        this.orchestrator.completeOperation(operation.operationId);
        console.log('[Server] ✅ Completed rename operation after FileWatcher detection window');
      }, 2500); // 2.5 seconds (RENAME_DETECTION_WINDOW + buffer)

      console.log('[Server] ⏳ Waiting for FileWatcher to detect rename before completing operation...');

      // OLD: Marker mechanism (kept for rollback safety)
      // // 🔧 Transition to AWAITING_ACK state (FileWatcher will ACK when it detects the rename)
      // endFileSync(syncId);
      // console.log('[Server] ⏳ Waiting for FileWatcher to acknowledge rename');
      //
      // // 🔧 Clear the renaming mark after a short delay (to ensure FileWatcher has time to detect)
      // setTimeout(() => {
      //   if (syncManager) {
      //     syncManager.clearRenaming(oldName);
      //     console.log('[Server] ✅ Cleared renaming mark for:', oldName);
      //   }
      // }, 2000); // 2 seconds should be enough for FileWatcher to detect
    } catch (error) {
      console.error('[Server] ❌ Failed to rename file:', oldName, '->', newName, error);
      // NEW: SyncOrchestrator - Mark operation as failed
      this.orchestrator.failOperation(operation.operationId, error as Error);
    }
  }

  /**
   * 处理文件夹重命名事件
   *
   * @param projectId - 项目 ID
   * @param oldPath - 旧文件夹路径
   * @param newPath - 新文件夹路径
   * @param folderId - 文件夹 ID
   * @private
   */
  private handleDirectoryRenamed(projectId: string, oldPath: string, newPath: string, folderId: string): void {
    // NEW: SyncOrchestrator - Start tracking operation
    const operation = this.orchestrator.startOperation(
      'overleaf',
      'rename',
      newPath,
      oldPath,
      { projectId, folderId, isDirectory: true }
    );

    try {
      console.log('[Server] 📁✏️ Renaming directory:', oldPath, '->', newPath);

      const projectConfig = this.configStore.getProjectConfig(projectId);
      const fs = require('fs');
      const pathModule = require('path');

      const fullOldPath = pathModule.join(projectConfig.localPath, oldPath);
      const fullNewPath = pathModule.join(projectConfig.localPath, newPath);

      // 检查旧文件夹是否存在
      if (!fs.existsSync(fullOldPath)) {
        console.log('[Server] ⚠️ Old directory not found:', fullOldPath, '(skipping)');
        this.orchestrator.failOperation(operation.operationId);
        return;
      }

      // OLD: Marker mechanism (kept for rollback safety)
      // // 🔧 Create marker file for NEW path BEFORE stopping FileWatcher
      // // This tells FileWatcher to ignore the new directory when it restarts
      // const syncId = startDirectorySync(projectId, projectConfig.localPath, newPath);
      // console.log('[Server] 📝 Created directory rename marker for new path:', newPath, '(syncId:', syncId + ')');

      // 🔧 FIX: Stop FileWatcher temporarily to avoid Windows EPERM error
      // Note: We keep this even with SyncOrchestrator as it's needed for Windows permission issues
      const fileWatcher = this.fileWatchers.get(projectId);
      if (fileWatcher) {
        console.log('[Server] ⏸️  Stopping FileWatcher temporarily...');
        fileWatcher.stop();
        console.log('[Server] ✅ FileWatcher stopped');
      }

      try {
        // Use a two-step rename with a temporary name
        const tempName = `.temp_rename_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const tempPath = pathModule.join(projectConfig.localPath, tempName);

        console.log('[Server] 🔄 Step 1: Rename to temporary name:', oldPath, '->', tempName);
        fs.renameSync(fullOldPath, tempPath);
        console.log('[Server] ✅ Temporary rename successful');

        console.log('[Server] 🔄 Step 2: Rename to final name:', tempName, '->', newPath);
        fs.renameSync(tempPath, fullNewPath);
        console.log('[Server] ✅ Final rename successful');

        console.log('[Server] ✅ Renamed directory:', oldPath, '->', newPath);
      } finally {
        // 🔧 IMPORTANT: Restart FileWatcher after rename is complete
        if (fileWatcher) {
          console.log('[Server] ▶️  Restarting FileWatcher...');
          fileWatcher.start().then(() => {
            console.log('[Server] ✅ FileWatcher restarted');
          }).catch((error) => {
            console.error('[Server] ❌ Failed to restart FileWatcher:', error);
          });
        }
      }

      // 🔧 IMPORTANT: Update folderId mapping if folderId is provided
      if (folderId) {
        const syncManager = this.syncManagers.get(projectId);
        if (syncManager) {
          syncManager.updateFolderMapping(newPath, folderId);
          console.log(`[Server] 📝 Updated folderId mapping for renamed directory: ${newPath} -> ${folderId}`);
        } else {
          console.log(`[Server] ⚠️ No syncManager found for ${projectId}`);
        }
      }

      // NEW: SyncOrchestrator - Mark operation as complete
      this.orchestrator.completeOperation(operation.operationId);

      // OLD: Marker mechanism (kept for rollback safety)
      // // 🔧 Transition to AWAITING_ACK state (FileWatcher will ACK when it detects the new directory)
      // endDirectorySync(syncId);
      // console.log('[Server] ⏳ Waiting for FileWatcher to acknowledge directory rename');
    } catch (error) {
      console.error('[Server] ❌ Failed to rename directory:', oldPath, '->', newPath, error);

      // NEW: SyncOrchestrator - Mark operation as failed
      this.orchestrator.failOperation(operation.operationId, error as Error);

      // 🔧 IMPORTANT: Make sure FileWatcher is restarted even if rename fails
      const fileWatcher = this.fileWatchers.get(projectId);
      if (fileWatcher) {
        console.log('[Server] ▶️  Restarting FileWatcher after error...');
        fileWatcher.start().catch((err) => {
          console.error('[Server] ❌ Failed to restart FileWatcher:', err);
        });
      }
    }
  }

  /**
   * 处理文件夹删除事件
   *
   * @param projectId - 项目 ID
   * @param directoryPath - 文件夹路径
   * @param folderId - 文件夹 ID
   * @private
   */
  private handleDirectoryDeleted(projectId: string, directoryPath: string, folderId: string): void {
    // 🔧 FIX: Normalize path separators (Windows \ to /) for Orchestrator matching
    const normalizedPath = directoryPath.replace(/\\/g, '/');

    // NEW: SyncOrchestrator - Start tracking operation with normalized path
    const operation = this.orchestrator.startOperation(
      'overleaf',
      'delete',
      normalizedPath,  // Use normalized path
      undefined,
      { projectId, folderId, isDirectory: true }
    );

    try {
      console.log('[Server] 📁🗑️ Deleting directory:', directoryPath);

      const projectConfig = this.configStore.getProjectConfig(projectId);
      const fs = require('fs');
      const pathModule = require('path');

      const fullPath = pathModule.join(projectConfig.localPath, directoryPath);

      // 检查文件夹是否存在
      if (!fs.existsSync(fullPath)) {
        console.log('[Server] ⚠️ Directory not found:', fullPath, '(skipping)');
        this.orchestrator.failOperation(operation.operationId);
        return;
      }

      // OLD: Marker mechanism (kept for rollback safety - Phase 3 will remove this)
      // 🔧 Create marker file BEFORE deleting (this signals FileWatcher to ignore the delete)
      const syncId = startDirectorySync(projectId, projectConfig.localPath, directoryPath);
      console.log('[Server] 📝 Created directory delete marker:', syncId);

      // 递归删除文件夹及其内容
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log('[Server] ✅ Deleted directory:', directoryPath);

      // 🔧 Remove from folderId mapping
      if (folderId) {
        const syncManager = this.syncManagers.get(projectId);
        if (syncManager) {
          syncManager.removeFolderMapping(directoryPath);
          console.log(`[Server] 📝 Removed folderId mapping for deleted directory: ${directoryPath}`);
        }
      }

      // 🔧 FIX: Use event-driven completion instead of setTimeout
      // Pass Orchestrator completion callback to be triggered when FileWatcher ACKs
      // This is more elegant than hard-coded timeout delays
      const onCompleteCallback = () => {
        this.orchestrator.completeOperation(operation.operationId);
        console.log('[Server] ✅ Completed directory delete operation (FileWatcher ACK received)');
      };
      endDirectorySync(syncId, onCompleteCallback);
      console.log('[Server] ⏳ Waiting for FileWatcher to acknowledge directory delete before completing operation...');
    } catch (error) {
      console.error('[Server] ❌ Failed to delete directory:', directoryPath, error);
      // NEW: SyncOrchestrator - Mark operation as failed
      this.orchestrator.failOperation(operation.operationId, error as Error);
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
   * Handle initial sync completion
   * Called when browser extension finishes initial Overleaf -> local sync
   * At this point, it's safe to enable file watching
   *
   * @param projectId - Project ID
   * @private
   */
  private handleInitialSyncComplete(projectId: string): void {
    console.log(`[Server] ✅ Initial sync complete for project: ${projectId}`);
    console.log(`[Server] 🚀 Enabling file monitoring for project: ${projectId}`);

    // Get working directory for this project
    const projectConfig = this.configStore.getProjectConfig(projectId);
    const workingDir = projectConfig.localPath;
    console.log(`[Server] 📁 Working directory for project ${projectId}: ${workingDir}`);

    // Send working directory to frontend
    this.broadcastToExtensions({
      type: 'sync_complete',
      project_id: projectId,
      working_dir: workingDir,
      timestamp: Date.now()
    });

    // Enable file watching for this project
    const fileWatcher = this.fileWatchers.get(projectId);
    if (fileWatcher) {
      console.log(`[Server] 📋 File watcher found, monitoring should be enabled here`);
      console.log(`[Server] ⚠️ TODO: Implement enableMonitoring() in FileWatcher`);
    } else {
      console.warn(`[Server] ⚠️ No file watcher found for project: ${projectId}`);
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
    const fileWatcher = new FileWatcher(projectId, config.localPath, this.orchestrator);

    // Create SyncManager
    console.log(`[Server] 🔧 Creating OverleafSyncManager...`);
    const syncManager = new OverleafSyncManager(projectId, this.config.port);

    // NEW: Set orchestrator reference
    syncManager.setOrchestrator(this.orchestrator);
    console.log(`[Server] ✅ SyncOrchestrator linked to syncManager`);

    // Initialize mappings
    console.log(`[Server] 🔧 Initializing ${docIdToPath.size} mappings...`);
    syncManager.initializeMappings(docIdToPath);

    // TODO: Initialize folder mappings when folder information is available
    // This will be implemented when we have folder_id information from the initial sync
    // syncManager.initializeFolderMappings(folderIdToPath);

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
    const { project_id, success, operation, path, oldPath, doc_id, folder_id, isDirectory, error } = message;

    console.log(`[Server] 📨 Received sync response: ${operation} ${path} (success: ${success}, isDirectory: ${isDirectory})`);

    const syncManager = this.syncManagers.get(project_id);
    if (!syncManager) {
      console.warn(`[Server] ⚠️ No sync manager for project: ${project_id}`);
      return;
    }

    // Forward the complete response to OverleafSyncManager for proper handling
    // This ensures folder_id, isDirectory, and orchestrator completion are all handled correctly
    try {
      syncManager.handleServerSyncResponse(message as any);
      console.log(`[Server] ✅ Forwarded response to OverleafSyncManager`);
    } catch (err) {
      console.error(`[Server] ❌ Error forwarding response to OverleafSyncManager:`, err);
    }
  }

  /**
   * Get the SyncOrchestrator instance (for debugging and testing)
   *
   * @returns The SyncOrchestrator instance
   * @public
   */
  getOrchestrator(): SyncOrchestrator {
    return this.orchestrator;
  }

  broadcast(message: WSMessage): void {
    this.connections.forEach((connection) => {
      if (connection.isOpen()) {
        connection.getWebSocket().send(JSON.stringify(message));
      }
    });
  }

  /**
   * Broadcast message to all connected browser extensions
   * Used for forwarding sync requests
   *
   * @param message - Message to broadcast
   * @private
   */
  private broadcastToExtensions(message: any): void {
    const connectedCount = Array.from(this.connections.values()).filter(
      (conn) => conn.isOpen()
    ).length;

    console.log(`[Server] 📡 Broadcasting to ${connectedCount} connected extension(s)`);

    this.connections.forEach((connection) => {
      if (connection.isOpen()) {
        try {
          connection.getWebSocket().send(JSON.stringify(message));
          console.log(`[Server] ✅ Sent to extension:`, message.type);
        } catch (error) {
          console.error(`[Server] ❌ Failed to send to extension:`, error);
        }
      }
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
