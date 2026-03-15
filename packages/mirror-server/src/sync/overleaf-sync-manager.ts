import { WebSocket } from 'ws';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

import type { FileChangeEvent } from '../filesystem/watcher';

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
        content = await readFile(
          join(this.projectPath, event.path),
          'utf-8'
        );
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

      // Send message to extension
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

      if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
        this.wsClient.send(JSON.stringify(message));
        console.log(`[OverleafSyncManager] ✅ Sent sync request: ${operation} ${normalizedPath}`);
      } else {
        console.warn('[OverleafSyncManager] ⚠️ WebSocket not connected');
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

      // Send message to extension with isDirectory flag
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
    } catch (error) {
      console.error(`[OverleafSyncManager] ❌ Failed to sync directory ${event.path}:`, error);
    }
  }

  private handleSyncResponse(response: SyncToOverleafResponse): void {
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
}
