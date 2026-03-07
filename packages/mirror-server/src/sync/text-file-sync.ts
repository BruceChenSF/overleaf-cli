import fs from 'fs-extra';
import { join } from 'path';
import { FileSystemManager } from '../filesystem/manager';
import { OverleafAPIClient } from '../api/overleaf-client';
import { ProjectConfig } from '../config/types';
import { EditEventData, AnyOperation } from '@overleaf-cc/shared';
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

    // Check if file exists locally
    if (!await this.fileManager.fileExists(docPath)) {
      console.log(`[TextFileSync] First edit for ${docPath}, fetching full content`);
      await this.initialSync(doc_id, doc_name);
      return;
    }

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

      console.log(`[TextFileSync] Applied ${ops.length} ops to ${docPath}`);
    } catch (error) {
      console.error(`[TextFileSync] Error applying ops to ${docPath}:`, error);

      // Mark for full re-sync
      console.log(`[TextFileSync] Marking ${docPath} for full re-sync`);
      await this.initialSync(doc_id, doc_name);
    }
  }

  /**
   * Initial sync: fetch full document content and create file
   */
  async initialSync(docId: string, docName: string): Promise<void> {
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
   */
  async verifyAndCorrect(docPath: string, docId: string): Promise<void> {
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
