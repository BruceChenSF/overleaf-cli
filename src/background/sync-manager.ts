import { overleafAPI } from './overleaf-api';
import type { FileSyncState } from '../shared/types';

export class SyncManager {
  private syncStates = new Map<string, FileSyncState>();
  private syncTimers = new Map<string, NodeJS.Timeout>();
  private readonly SYNC_DEBOUNCE_MS = 2000;

  constructor(private projectId: string) {}

  async init(files: Array<{ _id: string; path: string }>): Promise<void> {
    for (const file of files) {
      this.syncStates.set(file.path, {
        filepath: file.path,
        docId: file._id,
        lastSyncedAt: Date.now(),
        localHash: ''
      });
    }
  }

  getDocId(filepath: string): string | undefined {
    return this.syncStates.get(filepath)?.docId;
  }

  async syncFile(filepath: string, content: string): Promise<void> {
    // Clear existing timer
    const existingTimer = this.syncTimers.get(filepath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set debounced sync
    const timer = setTimeout(async () => {
      await this.performSync(filepath, content);
    }, this.SYNC_DEBOUNCE_MS);

    this.syncTimers.set(filepath, timer);
  }

  private async performSync(filepath: string, content: string): Promise<void> {
    const docId = this.getDocId(filepath);

    if (!docId) {
      console.warn(`No doc ID found for ${filepath}, skipping sync`);
      return;
    }

    try {
      await overleafAPI.updateDoc(this.projectId, docId, content);

      const state = this.syncStates.get(filepath);
      if (state) {
        state.lastSyncedAt = Date.now();
        state.localHash = this.hashContent(content);
      }

      console.log(`Synced ${filepath} to Overleaf`);
    } catch (err) {
      console.error(`Failed to sync ${filepath}:`, err);
      // TODO: Save to local backup
    }
  }

  private hashContent(content: string): string {
    // Simple hash for change detection
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << ) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}
