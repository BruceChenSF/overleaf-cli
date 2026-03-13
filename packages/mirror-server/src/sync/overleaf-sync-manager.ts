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
  timestamp: number;
}

export class OverleafSyncManager {
  private pathToDocId = new Map<string, string>();
  private debounceTimer = new Map<string, NodeJS.Timeout>();
  private projectPath: string;
  private projectId: string;
  private wsClient: WebSocket | null = null;

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

  initializeMappings(docIdToPath: Map<string, { path: string }>): void {
    console.log(`[OverleafSyncManager] Initializing ${docIdToPath.size} mappings`);

    this.pathToDocId.clear();

    docIdToPath.forEach((info, docId) => {
      this.pathToDocId.set(info.path, docId);
    });

    console.log(`[OverleafSyncManager] ✅ Initialized path → docId mappings`);
  }

  async handleFileChange(event: FileChangeEvent): Promise<void> {
    // Clear existing timer
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

      let content: string | undefined;

      // Only read content for create and update operations
      if (event.type === 'create' || event.type === 'update') {
        content = await readFile(
          join(this.projectPath, event.path),
          'utf-8'
        );
      }

      // Find docId from mapping
      const docId = this.pathToDocId.get(event.path);

      // For rename, find docId from old path
      let renameDocId: string | undefined;
      if (event.type === 'rename' && event.oldPath) {
        renameDocId = this.pathToDocId.get(event.oldPath);
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
        console.log(`[OverleafSyncManager] 📝 File renamed: ${event.oldPath} -> ${event.path}`);
        if (renameDocId) {
          console.log(`[OverleafSyncManager] 📝 Found docId for ${event.oldPath}: ${renameDocId}, using RENAME`);
        } else {
          console.log(`[OverleafSyncManager] ⚠️ No docId for ${event.oldPath}, rename may fail`);
        }
      } else if (docId) {
        operation = 'update';
        console.log(`[OverleafSyncManager] 📝 Found docId for ${event.path}: ${docId}, using UPDATE`);
      } else {
        operation = 'create';
        console.log(`[OverleafSyncManager] ➕ No docId for ${event.path}, using CREATE`);
      }

      // Send message to extension
      const message: SyncToOverleafMessage = {
        type: 'sync_to_overleaf',
        project_id: this.projectId,
        operation,
        path: event.path,
        oldPath: event.oldPath,
        content,
        doc_id: (operation === 'update' || operation === 'delete') ? docId : renameDocId,
        timestamp: Date.now()
      };

      if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
        this.wsClient.send(JSON.stringify(message));
        console.log(`[OverleafSyncManager] ✅ Sent sync request: ${operation} ${event.path}`);
      } else {
        console.warn('[OverleafSyncManager] ⚠️ WebSocket not connected');
      }
    } catch (error) {
      console.error(`[OverleafSyncManager] ❌ Failed to sync ${event.path}:`, error);
    }
  }

  private handleSyncResponse(response: SyncToOverleafResponse): void {
    if (response.success) {
      console.log(`[OverleafSyncManager] ✅ Sync successful: ${response.operation} ${response.path}`);

      // Update mapping (create operation)
      if (response.operation === 'create' && response.doc_id) {
        this.pathToDocId.set(response.path, response.doc_id);
        console.log(`[OverleafSyncManager] ✅ Mapped ${response.path} → ${response.doc_id}`);
      }

      // Delete mapping (delete operation)
      if (response.operation === 'delete') {
        this.pathToDocId.delete(response.path);
        console.log(`[OverleafSyncManager] ✅ Unmapped ${response.path}`);
      }

      // Update mapping (rename operation)
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
    } else {
      console.error(`[OverleafSyncManager] ❌ Sync failed: ${response.operation} ${response.path}`);
      if (response.error) {
        console.error(`[OverleafSyncManager] Error: ${response.error}`);
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
    this.pathToDocId.set(path, docId);
    console.log(`[OverleafSyncManager] ✅ Updated mapping: ${path} → ${docId}`);
  }
}
