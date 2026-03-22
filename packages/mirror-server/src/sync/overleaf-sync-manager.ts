import { WebSocket } from 'ws';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

import type { FileChangeEvent } from '../filesystem/watcher';
import { BackendMessageQueue } from '../queue/backend-message-queue';

interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  content?: string;
  doc_id?: string;
  folder_id?: string;  // For folder operations
  isDirectory?: boolean;  // True if this is a folder operation
  timestamp: number;
}

interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  folder_id?: string;  // For folder operations
  isDirectory?: boolean;  // True if this is a folder operation
  timestamp: number;
}

export class OverleafSyncManager {
  private pathToDocId = new Map<string, string>();
  private pathToFolderId = new Map<string, string>(); // Track folder IDs
  private debounceTimer = new Map<string, NodeJS.Timeout>();
  private renamingFiles = new Set<string>(); // Track files being renamed (old paths)
  private projectPath: string;
  private projectId: string;
  private wsClient: WebSocket | null = null;
  private orchestrator: any; // SyncOrchestrator instance (will be set from server)
  private messageQueue?: BackendMessageQueue; // Message queue for sequential processing
  private recentRootRenames = new Map<string, number>(); // Track recent root directory renames (oldPath -> timestamp)
  private pendingLocalRenames = new Set<string>(); // Track local rename operations in progress (oldPath -> newPath)

  /**
   * Normalize path to use forward slashes (Overleaf format)
   * This ensures consistent path matching across different operating systems
   */
  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  constructor(projectId: string, wsPort: number = 3456) {
    this.projectId = projectId;
    this.projectPath = join(homedir(), 'overleaf-mirror', projectId);

    // Connect to extension's WebSocket
    this.wsClient = new WebSocket(`ws://localhost:${wsPort}`);

    this.wsClient.on('open', () => {
      console.log('[OverleafSyncManager] Connected to Mirror Server');

      // Initialize the message queue after WebSocket is connected
      this.messageQueue = new BackendMessageQueue(this.wsClient);
      console.log('[OverleafSyncManager] ✅ Message queue initialized');
    });

    this.wsClient.on('message', (data: string) => {
      this.handleMessage(data);
    });

    this.wsClient.on('error', (error) => {
      console.error('[OverleafSyncManager] WebSocket error:', error);
    });
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.type === 'sync_to_overleaf_response') {
        this.handleSyncResponse(message as SyncToOverleafResponse);
      }
    } catch (error) {
      console.error('[OverleafSyncManager] Failed to parse message:', error);
    }
  }

  /**
   * Public method to handle sync response from server
   * Called when server receives response from browser extension
   *
   * @param response - Sync response message
   */
  handleServerSyncResponse(response: SyncToOverleafResponse): void {
    this.handleSyncResponse(response);
  }

  initializeMappings(docIdToPath: Map<string, { path: string }>): void {
    console.log(`[OverleafSyncManager] Initializing ${docIdToPath.size} mappings`);

    this.pathToDocId.clear();

    docIdToPath.forEach((info, docId) => {
      this.pathToDocId.set(info.path, docId);
    });

    console.log(`[OverleafSyncManager] ✅ Initialized path → docId mappings`);
  }

  initializeFolderMappings(folderIdToPath: Map<string, { path: string }>): void {
    console.log(`[OverleafSyncManager] Initializing ${folderIdToPath.size} folder mappings`);

    this.pathToFolderId.clear();

    folderIdToPath.forEach((info, folderId) => {
      this.pathToFolderId.set(info.path, folderId);
    });

    console.log(`[OverleafSyncManager] ✅ Initialized path → folderId mappings`);
  }

  setOrchestrator(orchestrator: any): void {
    this.orchestrator = orchestrator;
    console.log(`[OverleafSyncManager] ✅ SyncOrchestrator linked`);
  }

  async handleFileChange(event: FileChangeEvent): Promise<void> {
    // Check if this is a directory event
    const isDirectory = event.isDirectory === true;

    console.log(`[OverleafSyncManager] 📁 File change detected: ${event.type} ${event.path} (isDirectory: ${isDirectory})`);

    // For directory operations, sync immediately without debounce
    if (isDirectory) {
      try {
        await this.syncDirectoryToOverleaf(event);
      } catch (error) {
        console.error(`[OverleafSyncManager] ❌ Error in syncDirectoryToOverleaf:`, error);
      }
      return;
    }

    // For file operations, use debounce as before
    if (this.debounceTimer.has(event.path)) {
      clearTimeout(this.debounceTimer.get(event.path)!);
    }

    const timer = setTimeout(async () => {
      try {
        await this.syncToOverleaf(event);
      } catch (error) {
        console.error(`[OverleafSyncManager] ❌ Error in syncToOverleaf:`, error);
      } finally {
        this.debounceTimer.delete(event.path);
      }
    }, 500);

    this.debounceTimer.set(event.path, timer);
  }

  private async syncToOverleaf(event: FileChangeEvent): Promise<void> {
    try {
      console.log(`[OverleafSyncManager] Syncing to Overleaf: ${event.type} ${event.path}`);

      // 🔧 Normalize path to forward slashes for consistent matching
      const normalizedPath = this.normalizePath(event.path);
      const normalizedOldPath = event.oldPath ? this.normalizePath(event.oldPath) : undefined;

      console.log(`[OverleafSyncManager] 🔍 Normalized path: ${normalizedPath}`);
      if (normalizedOldPath) {
        console.log(`[OverleafSyncManager] 🔍 Normalized oldPath: ${normalizedOldPath}`);
      }

      // 🔧 NEW: Check if this is a child file rename after a root directory rename
      // If yes, ignore it (Overleaf handles child renames automatically when parent is renamed)
      if (event.type === 'rename' && normalizedOldPath) {
        // Check if the old path starts with any recently renamed root directory
        for (const [rootOldPath, timestamp] of this.recentRootRenames.entries()) {
          const timeSinceRename = Date.now() - timestamp;
          if (timeSinceRename <= 5000) { // Within 5 seconds
            // Check if this file is under the renamed root directory
            if (normalizedOldPath.startsWith(rootOldPath + '/') || normalizedOldPath === rootOldPath) {
              console.log(`[OverleafSyncManager] 🔗 Ignoring child file rename after root rename:`);
              console.log(`[OverleafSyncManager]    Root renamed: ${rootOldPath} (${timeSinceRename}ms ago)`);
              console.log(`[OverleafSyncManager]    Child file: ${normalizedOldPath} -> ${normalizedPath}`);
              console.log(`[OverleafSyncManager]    Overleaf handles child renames automatically`);
              return;
            }
          }
        }
      }

      // 🔧 FIX: If this is a delete event for a file that's being renamed, ignore it
      // This prevents false delete detection during rename operations
      if (event.type === 'delete' && this.renamingFiles.has(normalizedPath)) {
        console.log(`[OverleafSyncManager] 🔇 Ignoring delete for file being renamed: ${normalizedPath}`);
        this.renamingFiles.delete(normalizedPath); // Clear the mark
        return;
      }

      let content: string | undefined;

      // Only read content for create and update operations
      if (event.type === 'create' || event.type === 'update') {
        const filePath = join(this.projectPath, event.path);
        content = await readFile(filePath, 'utf-8');

        // Remove UTF-8 BOM if present (EF BB BF = U+FEFF)
        // Some editors/commands add BOM, but Overleaf doesn't handle it well
        if (content.charCodeAt(0) === 0xFEFF) {
          console.log(`[OverleafSyncManager] 🔧 Removing UTF-8 BOM from ${event.path}`);
          content = content.slice(1);
        }

        // Validate encoding: check for common encoding issues
        const firstNullByte = content.indexOf('\x00');
        if (firstNullByte !== -1) {
          console.error(`[OverleafSyncManager] ❌ Invalid file encoding detected in ${event.path}`);
          console.error(`[OverleafSyncManager]    File contains null bytes (likely UTF-16LE instead of UTF-8)`);
          console.error(`[OverleafSyncManager]    First null byte at position: ${firstNullByte}`);
          console.error(`[OverleafSyncManager]    Please ensure files are saved in UTF-8 encoding without BOM`);
          console.error(`[OverleafSyncManager]    Skipping content sync for this file`);
          // Don't sync invalid content
          content = undefined;
        }
      }

      // Find docId from mapping (using normalized path)
      const docId = this.pathToDocId.get(normalizedPath);

      // For rename, find docId from old path (using normalized path)
      let renameDocId: string | undefined;
      if (event.type === 'rename' && normalizedOldPath) {
        renameDocId = this.pathToDocId.get(normalizedOldPath);
      }

      // Determine operation type:
      // - If FileChangeEvent says delete, use delete
      // - If FileChangeEvent says rename, use rename
      // - If we have a docId in mapping, use update (file already exists on Overleaf)
      // - Otherwise, use create (new file that needs to be created on Overleaf)
      let operation: 'update' | 'create' | 'delete' | 'rename';
      if (event.type === 'delete') {
        operation = 'delete';
      } else if (event.type === 'rename') {
        operation = 'rename';
        console.log(`[OverleafSyncManager] 📝 File renamed: ${normalizedOldPath} -> ${normalizedPath}`);
        if (renameDocId) {
          console.log(`[OverleafSyncManager] 📝 Found docId for ${normalizedOldPath}: ${renameDocId}, using RENAME`);
        } else {
          console.log(`[OverleafSyncManager] ⚠️ No docId for ${normalizedOldPath}, rename may fail`);
        }
      } else if (docId) {
        operation = 'update';
        console.log(`[OverleafSyncManager] 📝 Found docId for ${normalizedPath}: ${docId}, using UPDATE`);
      } else {
        operation = 'create';
        console.log(`[OverleafSyncManager] ➕ No docId for ${normalizedPath}, using CREATE`);
      }

      // Send message to extension via queue
      const message: SyncToOverleafMessage = {
        type: 'sync_to_overleaf',
        project_id: this.projectId,
        operation,
        path: normalizedPath,  // Send normalized path
        oldPath: normalizedOldPath,
        content,
        doc_id: (operation === 'update' || operation === 'delete') ? docId : renameDocId,
        timestamp: Date.now()
      };

      // Use message queue to send sequentially and wait for response
      if (this.messageQueue) {
        console.log(`[OverleafSyncManager] 📤 Sending via queue: ${operation} ${normalizedPath}`);
        try {
          const response = await this.messageQueue.enqueue(message);
          console.log(`[OverleafSyncManager] ✅ Queue response received: ${response.success ? 'SUCCESS' : 'FAILED'} ${response.path}`);
        } catch (error) {
          console.error(`[OverleafSyncManager] ❌ Queue operation failed: ${normalizedPath}`, error);
        }
      } else {
        console.warn('[OverleafSyncManager] ⚠️ Message queue not initialized, sending directly');
        // Fallback to direct send if queue is not available
        if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
          this.wsClient.send(JSON.stringify(message));
          console.log(`[OverleafSyncManager] ✅ Sent sync request: ${operation} ${normalizedPath}`);
        } else {
          console.warn('[OverleafSyncManager] ⚠️ WebSocket not connected');
        }
      }
    } catch (error) {
      console.error(`[OverleafSyncManager] ❌ Failed to sync ${event.path}:`, error);
    }
  }

  private async syncDirectoryToOverleaf(event: FileChangeEvent): Promise<void> {
    try {
      console.log(`[OverleafSyncManager] 📁 Syncing directory to Overleaf: ${event.type} ${event.path}`);

      // 🔧 Normalize path to forward slashes for consistent matching
      const normalizedPath = this.normalizePath(event.path);
      const normalizedOldPath = event.oldPath ? this.normalizePath(event.oldPath) : undefined;

      console.log(`[OverleafSyncManager] 🔍 Normalized directory path: ${normalizedPath}`);
      if (normalizedOldPath) {
        console.log(`[OverleafSyncManager] 🔍 Normalized old directory path: ${normalizedOldPath}`);
      }

      // 🔧 NEW: Check if this is a CASCADE rename (child of renamed parent)
      // Cascade renames should NOT be sent to Overleaf (Overleaf handles them automatically)
      if (event.isCascadeRename) {
        console.log(`[OverleafSyncManager] 🔗 CASCADE rename detected - updating local mappings only`);
        console.log(`[OverleafSyncManager]    ${normalizedOldPath} -> ${normalizedPath}`);

        // Update local folderId mapping
        if (normalizedOldPath && event.type === 'rename') {
          const folderId = this.pathToFolderId.get(normalizedOldPath);
          if (folderId) {
            this.pathToFolderId.delete(normalizedOldPath);
            this.pathToFolderId.set(normalizedPath, folderId);
            console.log(`[OverleafSyncManager] ✅ Updated local mapping: ${normalizedOldPath} → ${normalizedPath} (${folderId})`);
          }
        }

        // Also update any file mappings under this directory
        if (normalizedOldPath) {
          this.updateChildFileMappings(normalizedOldPath, normalizedPath);
        }

        console.log(`[OverleafSyncManager] ✅ CASCADE rename completed (local only)`);
        return;
      }

      // NEW: SyncOrchestrator - Start tracking directory operation
      let operation: 'update' | 'create' | 'delete' | 'rename';
      let folderId: string | undefined;

      if (this.orchestrator) {
        const filterResult = this.orchestrator.shouldProcessEvent('local', event.type, normalizedPath, normalizedOldPath);
        if (!filterResult.shouldProcess) {
          console.log(`[OverleafSyncManager] 🔒 Event blocked by SyncOrchestrator: ${filterResult.reason}`);
          return;
        }
      }

      // Determine operation type and folder ID
      if (event.type === 'delete') {
        operation = 'delete';
        folderId = this.pathToFolderId.get(normalizedPath);
        console.log(`[OverleafSyncManager] 🗑️ Directory delete, folderId: ${folderId || '(none)'}`);
      } else if (event.type === 'rename') {
        operation = 'rename';
        folderId = normalizedOldPath ? this.pathToFolderId.get(normalizedOldPath) : undefined;
        console.log(`[OverleafSyncManager] 📝 Directory renamed: ${normalizedOldPath} -> ${normalizedPath}, folderId: ${folderId || '(none)'}`);

        // 🔧 NEW: Record this local rename operation to prevent conflicts with Overleaf WebSocket echo
        const renameKey = `${normalizedOldPath}->${normalizedPath}`;
        this.pendingLocalRenames.add(renameKey);
        console.log(`[OverleafSyncManager] 📝 Recorded local rename operation: ${renameKey}`);

        // 🔧 NEW: If this is a ROOT directory rename, batch update child mappings
        // This prevents sending individual RENAME requests for children
        if (event.isRootRename && normalizedOldPath) {
          console.log(`[OverleafSyncManager] 🔄 ROOT directory rename - batch updating child mappings`);
          this.updateChildDirectoryMappings(normalizedOldPath, normalizedPath);

          // 🔧 NEW: Record this root rename for child file filtering
          // Children renamed within 5 seconds should be ignored (Overleaf handles them automatically)
          this.recentRootRenames.set(normalizedOldPath, Date.now());
          console.log(`[OverleafSyncManager] 📝 Recorded root directory rename: ${normalizedOldPath} (will ignore child renames for 5s)`);

          // Clean up old entries (older than 10 seconds)
          const now = Date.now();
          for (const [oldPath, timestamp] of this.recentRootRenames.entries()) {
            if (now - timestamp > 10000) {
              this.recentRootRenames.delete(oldPath);
            }
          }
        }
      } else if (this.pathToFolderId.has(normalizedPath)) {
        operation = 'update';
        folderId = this.pathToFolderId.get(normalizedPath);
        console.log(`[OverleafSyncManager] 📝 Found folderId for ${normalizedPath}: ${folderId}, using UPDATE`);
      } else {
        operation = 'create';
        console.log(`[OverleafSyncManager] ➕ No folderId for ${normalizedPath}, using CREATE`);
      }

      // NEW: SyncOrchestrator - Start tracking operation
      let opContext: any = null;
      if (this.orchestrator) {
        opContext = this.orchestrator.startOperation(
          'local',
          operation,
          normalizedPath,
          normalizedOldPath,
          { isDirectory: true }
        );
        console.log(`[OverleafSyncManager] 🎯 Started operation tracking: ${opContext.operationId}`);
      }

      // Send message to extension with isDirectory flag via queue
      const message: SyncToOverleafMessage = {
        type: 'sync_to_overleaf',
        project_id: this.projectId,
        operation,
        path: normalizedPath,
        oldPath: normalizedOldPath,
        folder_id: folderId,
        isDirectory: true,
        timestamp: Date.now()
      };

      // Use message queue to send sequentially and wait for response
      if (this.messageQueue) {
        console.log(`[OverleafSyncManager] 📤 Sending directory via queue: ${operation} ${normalizedPath}`);
        try {
          const response = await this.messageQueue.enqueue(message);
          console.log(`[OverleafSyncManager] ✅ Queue response received: ${response.success ? 'SUCCESS' : 'FAILED'} ${response.path}`);
        } catch (error) {
          console.error(`[OverleafSyncManager] ❌ Queue operation failed: ${normalizedPath}`, error);
          // Fail the operation if queue operation fails
          if (this.orchestrator && opContext) {
            this.orchestrator.failOperation(opContext.operationId, error);
          }
        }
      } else {
        console.warn('[OverleafSyncManager] ⚠️ Message queue not initialized, sending directly');
        // Fallback to direct send if queue is not available
        if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
          this.wsClient.send(JSON.stringify(message));
          console.log(`[OverleafSyncManager] ✅ Sent directory sync request: ${operation} ${normalizedPath}`);
        } else {
          console.warn('[OverleafSyncManager] ⚠️ WebSocket not connected');
          // Fail the operation if WebSocket is not connected
          if (this.orchestrator && opContext) {
            this.orchestrator.failOperation(opContext.operationId, new Error('WebSocket not connected'));
          }
        }
      }
    } catch (error) {
      console.error(`[OverleafSyncManager] ❌ Failed to sync directory ${event.path}:`, error);
    }
  }

  /**
   * Update file mappings for all files under a renamed directory
   * This is called when a parent directory is renamed
   *
   * @param oldPath - Old directory path
   * @param newPath - New directory path
   */
  private updateChildFileMappings(oldPath: string, newPath: string): void {
    console.log(`[OverleafSyncManager] 🔄 Updating child file mappings: ${oldPath} -> ${newPath}`);

    let updatedCount = 0;

    // Update all docId mappings that start with oldPath
    for (const [filePath, docId] of this.pathToDocId.entries()) {
      if (filePath.startsWith(oldPath + '/') || filePath === oldPath) {
        const newFilePath = filePath.replace(oldPath, newPath);
        this.pathToDocId.delete(filePath);
        this.pathToDocId.set(newFilePath, docId);
        updatedCount++;
        console.log(`[OverleafSyncManager]   📝 ${filePath} -> ${newFilePath} (${docId})`);
      }
    }

    console.log(`[OverleafSyncManager] ✅ Updated ${updatedCount} file mappings`);
  }

  private handleSyncResponse(response: SyncToOverleafResponse): void {
    // First, forward the response to the message queue
    if (this.messageQueue) {
      this.messageQueue.handleResponse(response);
      console.log(`[OverleafSyncManager] 📨 Response forwarded to message queue`);
    }

    if (response.success) {
      console.log(`[OverleafSyncManager] ✅ Sync successful: ${response.operation} ${response.path}`);

      // Check if this is a directory operation
      const isDirectory = response.isDirectory === true;

      if (isDirectory) {
        // Handle folder mapping updates
        if (response.operation === 'create' && response.folder_id) {
          this.pathToFolderId.set(response.path, response.folder_id);
          console.log(`[OverleafSyncManager] ✅ Mapped folder ${response.path} → ${response.folder_id}`);
        }

        if (response.operation === 'delete') {
          this.pathToFolderId.delete(response.path);
          console.log(`[OverleafSyncManager] ✅ Unmapped folder ${response.path}`);
        }

        if (response.operation === 'rename' && response.oldPath) {
          const folderId = this.pathToFolderId.get(response.oldPath);
          if (folderId) {
            this.pathToFolderId.delete(response.oldPath);
            this.pathToFolderId.set(response.path, folderId);
            console.log(`[OverleafSyncManager] ✅ Remapped folder ${response.oldPath} → ${response.path} (${folderId})`);
          } else {
            console.warn(`[OverleafSyncManager] ⚠️ Folder rename succeeded but no folderId found for ${response.oldPath}`);
          }

          // 🔧 NEW: Clear pending local rename record
          const renameKey = `${response.oldPath}->${response.path}`;
          this.pendingLocalRenames.delete(renameKey);
          console.log(`[OverleafSyncManager] 🗑️ Cleared local rename record: ${renameKey}`);
        }

        // NEW: SyncOrchestrator - Complete operation for directories
        if (this.orchestrator) {
          const opContext = this.orchestrator.getOperationForPath(response.path);
          if (opContext) {
            this.orchestrator.completeOperation(opContext.operationId);
            console.log(`[OverleafSyncManager] ✅ Completed directory operation: ${opContext.operationId}`);
          }
        }
      } else {
        // Handle file mapping updates (existing logic)
        if (response.operation === 'create' && response.doc_id) {
          this.pathToDocId.set(response.path, response.doc_id);
          console.log(`[OverleafSyncManager] ✅ Mapped ${response.path} → ${response.doc_id}`);
        }

        if (response.operation === 'delete') {
          this.pathToDocId.delete(response.path);
          console.log(`[OverleafSyncManager] ✅ Unmapped ${response.path}`);
        }

        if (response.operation === 'rename' && response.oldPath) {
          const docId = this.pathToDocId.get(response.oldPath);
          if (docId) {
            this.pathToDocId.delete(response.oldPath);
            this.pathToDocId.set(response.path, docId);
            console.log(`[OverleafSyncManager] ✅ Remapped ${response.oldPath} → ${response.path} (${docId})`);
          } else {
            console.warn(`[OverleafSyncManager] ⚠️ Rename succeeded but no docId found for ${response.oldPath}`);
          }
        }
      }
    } else {
      console.error(`[OverleafSyncManager] ❌ Sync failed: ${response.operation} ${response.path}`);
      if (response.error) {
        console.error(`[OverleafSyncManager] Error: ${response.error}`);
      }

      // NEW: SyncOrchestrator - Fail operation on error
      if (this.orchestrator) {
        const opContext = this.orchestrator.getOperationForPath(response.path);
        if (opContext) {
          this.orchestrator.failOperation(opContext.operationId, new Error(response.error || 'Sync failed'));
          console.log(`[OverleafSyncManager] ❌ Failed operation: ${opContext.operationId}`);
        }
      }
    }
  }

  stop(): void {
    if (this.wsClient) {
      this.wsClient.removeAllListeners('message');
      this.wsClient.removeAllListeners('open');
      this.wsClient.removeAllListeners('error');
      this.wsClient.close();
      this.wsClient = null;
    }

    // Clear debounce timers with null check
    this.debounceTimer.forEach((timer) => {
      if (timer) clearTimeout(timer);
    });
    this.debounceTimer.clear();
  }

  updateMapping(path: string, docId: string): void {
    const normalizedPath = this.normalizePath(path);
    this.pathToDocId.set(normalizedPath, docId);
    console.log(`[OverleafSyncManager] ✅ Updated mapping: ${normalizedPath} → ${docId}`);
  }

  removeMapping(path: string): void {
    const normalizedPath = this.normalizePath(path);
    this.pathToDocId.delete(normalizedPath);
    console.log(`[OverleafSyncManager] 🗑️ Removed mapping: ${normalizedPath}`);
  }

  /**
   * Mark a file as being renamed (to prevent false delete detection)
   * This should be called BEFORE starting the rename operation
   *
   * @param oldPath - The old path of the file being renamed
   */
  markRenaming(oldPath: string): void {
    const normalizedPath = this.normalizePath(oldPath);
    this.renamingFiles.add(normalizedPath);
    console.log(`[OverleafSyncManager] 🔄 Marked as renaming: ${normalizedPath}`);
  }

  /**
   * Clear the renaming mark for a file
   * This should be called AFTER the rename operation is complete
   *
   * @param oldPath - The old path of the file that was renamed
   */
  clearRenaming(oldPath: string): void {
    const normalizedPath = this.normalizePath(oldPath);
    this.renamingFiles.delete(normalizedPath);
    console.log(`[OverleafSyncManager] ✅ Cleared renaming mark: ${normalizedPath}`);
  }

  /**
   * Update folder mapping (used when folder is created from Overleaf side)
   *
   * @param path - Folder path
   * @param folderId - Overleaf folder ID
   */
  updateFolderMapping(path: string, folderId: string): void {
    const normalizedPath = this.normalizePath(path);
    this.pathToFolderId.set(normalizedPath, folderId);
    console.log(`[OverleafSyncManager] ✅ Updated folder mapping: ${normalizedPath} → ${folderId}`);
  }

  /**
   * Remove folder mapping (used when folder is deleted from Overleaf side)
   *
   * @param path - Folder path
   */
  removeFolderMapping(path: string): void {
    const normalizedPath = this.normalizePath(path);
    this.pathToFolderId.delete(normalizedPath);
    console.log(`[OverleafSyncManager] 🗑️ Removed folder mapping: ${normalizedPath}`);
  }

  /**
   * Get folder ID for a path
   *
   * @param path - Folder path
   * @returns Folder ID or undefined
   */
  getFolderId(path: string): string | undefined {
    const normalizedPath = this.normalizePath(path);
    return this.pathToFolderId.get(normalizedPath);
  }

  /**
   * Update all child directory and file mappings when parent directory is renamed
   * This is called when a root directory is renamed to update all nested mappings
   *
   * @param oldPath - Old parent directory path
   * @param newPath - New parent directory path
   */
  private updateChildDirectoryMappings(oldPath: string, newPath: string): void {
    console.log(`[OverleafSyncManager] 🔄 Batch updating child mappings: ${oldPath} -> ${newPath}`);
    console.log(`[OverleafSyncManager] 🔍 Debug: oldPath="${oldPath}", newPath="${newPath}"`);
    console.log(`[OverleafSyncManager] 🔍 Debug: pathToDocId has ${this.pathToDocId.size} entries`);
    console.log(`[OverleafSyncManager] 🔍 Debug: pathToDocId keys:`, Array.from(this.pathToDocId.keys()));

    let updatedFolderCount = 0;
    let updatedFileCount = 0;

    // Update all folderId mappings that start with oldPath
    for (const [folderPath, folderId] of this.pathToFolderId.entries()) {
      const prefix = oldPath + '/';
      const matches = folderPath.startsWith(prefix) || folderPath === oldPath;
      console.log(`[OverleafSyncManager] 🔍 Debug: folderPath="${folderPath}", prefix="${prefix}", matches=${matches}`);
      if (matches) {
        const newFolderPath = folderPath.replace(oldPath, newPath);
        this.pathToFolderId.delete(folderPath);
        this.pathToFolderId.set(newFolderPath, folderId);
        updatedFolderCount++;
        console.log(`[OverleafSyncManager]   📁 ${folderPath} -> ${newFolderPath} (${folderId})`);
      }
    }

    // Update all file mappings under this directory
    for (const [filePath, docId] of this.pathToDocId.entries()) {
      const prefix = oldPath + '/';
      const matches = filePath.startsWith(prefix) || filePath === oldPath;
      if (matches) {
        const newFilePath = filePath.replace(oldPath, newPath);
        this.pathToDocId.delete(filePath);
        this.pathToDocId.set(newFilePath, docId);
        updatedFileCount++;
        console.log(`[OverleafSyncManager]   📄 ${filePath} -> ${newFilePath} (${docId})`);
      } else {
        console.log(`[OverleafSyncManager] 🔍 Debug: filePath="${filePath}" does NOT match prefix="${prefix}"`);
      }
    }

    console.log(`[OverleafSyncManager] ✅ Updated ${updatedFolderCount} folder mappings and ${updatedFileCount} file mappings`);
  }

  /**
   * Check if a rename operation is currently in progress (triggered by local changes)
   * This is used to prevent conflicts with Overleaf WebSocket echo events
   *
   * @param oldPath - Old path
   * @param newPath - New path
   * @returns true if this rename was triggered by local changes
   */
  isLocalRenameInProgress(oldPath: string, newPath: string): boolean {
    const normalizedOldPath = this.normalizePath(oldPath);
    const normalizedNewPath = this.normalizePath(newPath);
    const renameKey = `${normalizedOldPath}->${normalizedNewPath}`;
    return this.pendingLocalRenames.has(renameKey);
  }
}
