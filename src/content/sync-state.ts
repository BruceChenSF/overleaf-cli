interface FileHash {
  path: string;
  hash: string;
  type: 'doc' | 'file';
  lastModified: number;
}

export class SyncStateTracker {
  private fileHashes: Map<string, FileHash> = new Map();

  /**
   * Update hash for a file
   */
  updateHash(path: string, hash: string, type: 'doc' | 'file'): void {
    this.fileHashes.set(path, {
      path,
      hash,
      type,
      lastModified: Date.now()
    });
  }

  /**
   * Get hash for a file
   */
  getHash(path: string): FileHash | undefined {
    return this.fileHashes.get(path);
  }

  /**
   * Check if file needs sync
   */
  needsSync(path: string, hash: string): boolean {
    const existing = this.fileHashes.get(path);
    if (!existing) {
      return true;  // New file
    }
    return existing.hash !== hash;  // Hash changed
  }

  /**
   * Remove file from tracking
   */
  removeFile(path: string): void {
    this.fileHashes.delete(path);
  }

  /**
   * Get all tracked files
   */
  getAllFiles(): FileHash[] {
    return Array.from(this.fileHashes.values());
  }

  /**
   * Clear all tracking
   */
  clear(): void {
    this.fileHashes.clear();
  }

  /**
   * Detect deleted files (files in tracker but not in current list)
   */
  detectDeletedFiles(currentPaths: Set<string>): string[] {
    const deleted: string[] = [];

    for (const path of this.fileHashes.keys()) {
      if (!currentPaths.has(path)) {
        deleted.push(path);
      }
    }

    return deleted;
  }

  /**
   * Clean up old entries (older than 1 hour or if more than 1000 entries)
   */
  cleanup(): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // If too many entries, remove oldest ones
    if (this.fileHashes.size > 1000) {
      const entries = Array.from(this.fileHashes.entries());
      // Sort by lastModified, oldest first
      entries.sort((a, b) => a[1].lastModified - b[1].lastModified);
      // Remove oldest 20%
      const toRemove = Math.floor(entries.length * 0.2);
      for (let i = 0; i < toRemove; i++) {
        this.fileHashes.delete(entries[i][0]);
      }
      console.log(`[SyncStateTracker] Cleaned up ${toRemove} old entries`);
    }

    // Also remove entries older than 1 hour
    for (const [path, data] of this.fileHashes.entries()) {
      if (now - data.lastModified > oneHour) {
        this.fileHashes.delete(path);
      }
    }
  }
}

// Global instance
export const syncStateTracker = new SyncStateTracker();
