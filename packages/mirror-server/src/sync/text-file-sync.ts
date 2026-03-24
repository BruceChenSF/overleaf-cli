import fs from 'fs-extra';
import path from 'path';
import { FileSystemManager } from '../filesystem/manager';
import { OverleafAPIClient } from '../api/overleaf-client';
import { ProjectConfig } from '../config/types';
import { EditEventData, AnyOperation } from '../shared-types';
import { OpResult, DocCacheEntry } from './types';

export class TextFileSyncManager {
  private fileManager: FileSystemManager;
  private docContentCache: Map<string, DocCacheEntry> = new Map();
  private editCount: Map<string, number> = new Map();

  constructor(
    private projectConfig: ProjectConfig,
    private apiClient: OverleafAPIClient
  ) {
    this.fileManager = new FileSystemManager(projectConfig.localPath);
  }

  /**
   * Handle edit event from Overleaf
   */
  async handleEditEvent(event: EditEventData): Promise<void> {
    const { doc_id, doc_name, ops, version } = event;

    if (!doc_name) {
      console.warn('[TextFileSync] Missing doc_name in event');
      return;
    }

    const docPath = doc_name;

    // 🔍 调试信息：显示完整路径和项目路径
    console.log(`[TextFileSync] 🔍 Checking file: ${docPath}`);
    console.log(`[TextFileSync] 🔍 Project local path: ${this.projectConfig.localPath}`);
    console.log(`[TextFileSync] 🔍 Full file path: ${path.join(this.projectConfig.localPath, docPath)}`);

    // Check if file exists locally
    const exists = await this.fileManager.fileExists(docPath);
    console.log(`[TextFileSync] 🔍 File exists: ${exists}`);

    if (!exists) {
      console.warn(`[TextFileSync] ⚠️ File ${docPath} does not exist locally (initial sync may not have completed yet)`);
      console.warn(`[TextFileSync] ⏭️ Skipping edit event for ${docPath}`);

      // 🔍 列出实际存在的文件
      try {
        const files = await fs.readdir(this.projectConfig.localPath);
        console.log(`[TextFileSync] 🔍 Files in project root:`, files);
      } catch (e) {
        console.error(`[TextFileSync] ❌ Error listing directory:`, e);
      }

      return;
    }

    // 🔧 IMPORTANT: Create marker file BEFORE applying ops to prevent circular sync
    // This tells FileWatcher to ignore the upcoming file write
    const { startFileSync, endFileSync } = require('../filesystem/watcher');
    const syncId = startFileSync(this.projectConfig.projectId, this.projectConfig.localPath, docPath);
    console.log(`[TextFileSync] 🔧 Created marker for ${docPath} (syncId: ${syncId})`);

    // Apply OT operations
    try {
      await this.applyOps(docPath, ops);

      // Update cache
      if (version) {
        this.docContentCache.set(docPath, {
          content: await this.fileManager.readFile(docPath),
          version,
          lastUpdated: Date.now()
        });
      }

      console.log(`[TextFileSync] ✅ Applied ${ops.length} ops to ${docPath}`);
    } catch (error) {
      console.error(`[TextFileSync] ❌ Error applying ops to ${docPath}:`, error);
      // Don't try to re-sync via API - it doesn't work
      // The file will be corrected on next page refresh/sync
    } finally {
      // 🔧 IMPORTANT: Remove marker file AFTER applying ops
      // This allows FileWatcher to detect user edits again
      endFileSync(syncId);
      console.log(`[TextFileSync] 🔧 Removed marker for ${docPath}`);
    }
  }

  /**
   * Initial sync: fetch full document content and create file
   *
   * NOTE: This method is disabled because the Overleaf API endpoint
   * /doc/{docId} does not work. Files are synced via browser-side
   * WebSocket sync (see packages/extension/src/content/overleaf-sync.ts)
   */
  async initialSync(docId: string, docName: string): Promise<void> {
    console.warn(`[TextFileSync] ⚠️ initialSync is disabled - Overleaf API endpoint does not work`);
    console.warn(`[TextFileSync] Files are synced via browser-side WebSocket sync`);
    throw new Error('initialSync is disabled - use browser-side sync instead');

    /* Original implementation (disabled):
    try {
      const content = await this.apiClient.getDocContent(
        this.projectConfig.projectId,
        docId
      );

      await this.fileManager.createFile(docName, content);

      console.log(`[TextFileSync] Created initial file: ${docName} (${content.length} chars)`);
    } catch (error) {
      console.error(`[TextFileSync] Failed to initial sync ${docName}:`, error);
      throw error;
    }
    */
  }

  /**
   * Apply OT operations to local file
   */
  async applyOps(docPath: string, ops: AnyOperation[]): Promise<OpResult> {
    if (ops.length === 0) {
      return { success: true, opsApplied: 0 };
    }

    try {
      // Read current content
      const content = await this.fileManager.readFile(docPath);

      // Sort ops by position (descending to apply from end to start)
      // This prevents position offsets from affecting subsequent ops
      const sortedOps = [...ops].sort((a, b) => b.p - a.p);

      // Apply each operation
      let newContent = content;
      for (const op of sortedOps) {
        if ('i' in op) {
          // Insert operation
          newContent =
            newContent.slice(0, op.p) + op.i + newContent.slice(op.p);
        } else if ('d' in op) {
          // Delete operation
          const deleteLength = op.d.length;
          newContent =
            newContent.slice(0, op.p) +
            newContent.slice(op.p + deleteLength);
        }
        // Retain operations (p only) don't change content
      }

      // Write back
      await this.fileManager.updateFile(docPath, newContent);

      return { success: true, opsApplied: ops.length };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        opsApplied: 0
      };
    }
  }

  /**
   * Verify and correct document by fetching fresh content from Overleaf
   * Called periodically or when errors occur
   *
   * NOTE: This method is disabled because the Overleaf API endpoint
   * /doc/{docId} does not work. Files are synced via browser-side
   * WebSocket sync instead. This method is kept for potential future use.
   */
  async verifyAndCorrect(docPath: string, docId: string): Promise<void> {
    console.warn(`[TextFileSync] ⚠️ verifyAndCorrect is disabled - Overleaf API endpoint does not work`);
    console.warn(`[TextFileSync] Files are synced via browser-side WebSocket sync`);
    return;

    /* Original implementation (disabled):
    try {
      const remoteContent = await this.apiClient.getDocContent(
        this.projectConfig.projectId,
        docId
      );

      const localContent = await this.fileManager.readFile(docPath);

      if (remoteContent !== localContent) {
        console.log(`[TextFileSync] Correcting ${docPath} (mismatch detected)`);
        await this.fileManager.updateFile(docPath, remoteContent);
      }
    } catch (error) {
      console.error(`[TextFileSync] Verify failed for ${docPath}:`, error);
    }
    */
  }

  /**
   * Check if document should be verified (after N edits)
   */
  shouldVerify(docPath: string): boolean {
    const count = (this.editCount.get(docPath) || 0) + 1;
    this.editCount.set(docPath, count);

    if (count >= 10) {
      this.editCount.set(docPath, 0);
      return true;
    }

    return false;
  }

  /**
   * Get cached document content if available
   */
  getCachedContent(docPath: string): string | null {
    const cached = this.docContentCache.get(docPath);
    if (!cached) return null;

    // Cache expires after 5 minutes
    const age = Date.now() - cached.lastUpdated;
    if (age > 5 * 60 * 1000) {
      this.docContentCache.delete(docPath);
      return null;
    }

    return cached.content;
  }
}
