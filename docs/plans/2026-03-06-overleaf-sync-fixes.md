# Overleaf Sync Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical issues with Overleaf bidirectional sync including timeout handling, file tree false positives, file deletion, and implement incremental sync optimization.

**Architecture:**
- Add retry mechanism with exponential backoff for WebSocket operations
- Distinguish between structural changes (folder expand/collapse) and actual file changes
- Fix deletion handling by verifying docId mappings and message processing
- Implement incremental sync using file tree comparison and hash validation

**Tech Stack:**
- TypeScript
- Chrome Extension APIs
- WebSocket protocol (socket.io-like)
- DOM APIs (MutationObserver, event listeners)

---

## Task 1: Add Retry Mechanism for File Downloads

**Files:**
- Modify: `src/content/overleaf-websocket.ts` (sendRequest method, lines 535-558)
- Modify: `src/content/overleaf-websocket.ts` (joinDoc method, lines 433-459)

**Step 1: Add retry configuration interface**

After line 60 (after FileChange interface), add:

```typescript
interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelay: 1000,  // 1 second
  maxDelay: 10000,     // 10 seconds
  backoffMultiplier: 2
};
```

**Step 2: Create helper method for retry logic**

After line 61 (after class declaration starts), add this private method:

```typescript
/**
 * Execute a function with retry logic and exponential backoff
 */
private async retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context: string = 'operation'
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.initialDelay;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.warn(`[Overleaf WS] ${context} failed (attempt ${attempt}/${config.maxAttempts}):`, error);

      if (attempt < config.maxAttempts) {
        console.log(`[Overleaf WS] Retrying ${context} in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
      }
    }
  }

  throw new Error(`${context} failed after ${config.maxAttempts} attempts: ${lastError?.message}`);
}
```

**Step 3: Update sendRequest to use retry mechanism**

Replace lines 535-558 (sendRequest method) with:

```typescript
/**
 * Send a request and wait for response
 */
private sendRequest(message: { name: string; args: unknown[] }): Promise<any> {
  return this.retryWithBackoff(
    async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket not connected');
      }

      return new Promise((resolve, reject) => {
        const seq = this.messageSeq;

        // Send message
        this.ws!.send(`5:${seq}+::` + JSON.stringify(message));
        this.messageSeq++;

        // Store callback
        this.pendingRequests.set(seq, resolve);

        // Single attempt timeout (shorter, since we have retries)
        const timeout = setTimeout(() => {
          if (this.pendingRequests.has(seq)) {
            this.pendingRequests.delete(seq);
            reject(new Error('Request timeout'));
          }
        }, 3000);  // Reduced from 5000 to 3000 since we retry

        // Also clear timeout on success to avoid memory leak
        const originalResolve = resolve;
        this.pendingRequests.set(seq, (response: any) => {
          clearTimeout(timeout);
          originalResolve(response);
        });
      });
    },
    DEFAULT_RETRY_CONFIG,
    `WebSocket request (${message.name})`
  );
}
```

**Step 4: Update joinDoc to use retry mechanism**

Replace lines 433-459 (joinDoc method) with:

```typescript
/**
 * Join a document to fetch its content
 */
async joinDoc(docId: string): Promise<string[]> {
  console.log(`[Overleaf WS] Joining doc: ${docId}`);

  return this.retryWithBackoff(
    async () => {
      const contentData = await this.sendRequest({
        name: 'joinDoc',
        args: [docId, { encodeRanges: true }],
      });

      // Parse response: [null, escapedLines[], version, ops, comments]
      const escapedLines = contentData[1] || [];
      const version = contentData[2] || 0;

      console.log(`[Overleaf WS] Got doc content: ${docId}, version: ${version}, lines: ${escapedLines.length}`);

      // Decode UTF-8
      const decodedLines = escapedLines.map((line: string) => {
        try {
          const bytes = new Uint8Array([...line].map((c) => c.charCodeAt(0)));
          return new TextDecoder('utf-8').decode(bytes);
        } catch (e) {
          console.error('[Overleaf WS] Failed to decode line:', e);
          return line;
        }
      });

      return decodedLines;
    },
    DEFAULT_RETRY_CONFIG,
    `joinDoc(${docId})`
  );
}
```

**Step 5: Update downloadFile to use retry mechanism**

Replace lines 474-510 (downloadFile method) with:

```typescript
/**
 * Download a binary file (image, PDF, etc.) from Overleaf
 */
async downloadFile(fileRefId: string, projectId: string): Promise<Blob> {
  return this.retryWithBackoff(
    async () => {
      const fileInfo = this.docIdToPath.get(fileRefId);
      if (!fileInfo || fileInfo.type !== 'file') {
        throw new Error(`File ${fileRefId} not found or is not a file`);
      }

      console.log(`[Overleaf WS] Downloading file: ${fileInfo.path} (hash: ${fileInfo.hash})`);

      if (!fileInfo.hash) {
        throw new Error(`File ${fileRefId} does not have a hash`);
      }

      // Use the correct URL format: /project/{projectId}/blob/{hash}
      const domain = window.location.hostname;
      const fileUrl = `https://${domain}/project/${projectId}/blob/${fileInfo.hash}`;

      console.log(`[Overleaf WS] Fetching: ${fileUrl}`);

      const response = await fetch(fileUrl, {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      console.log(`[Overleaf WS] Downloaded ${fileInfo.path} (${blob.size} bytes, type: ${blob.type})`);
      return blob;
    },
    DEFAULT_RETRY_CONFIG,
    `downloadFile(${fileRefId})`
  );
}
```

**Step 6: Test timeout handling**

Run: `npm run build`
Expected: Build succeeds without errors

Run: Load extension in Chrome and open browser console
Expected: No "Request timeout" errors during initial sync

---

## Task 2: Fix File Tree Expansion False Positives

**Files:**
- Modify: `src/content/injector.ts` (setupFileTreeWatcher function, lines 1233-1293)

**Step 1: Add file count tracking**

After line 1233 (after function declaration), add:

```typescript
function setupFileTreeWatcher(): void {
  console.log('[Overleaf CC] Setting up file tree watcher...');

  // Track last known file count to detect actual changes
  let lastFileCount = -1;
  let lastFileList: string[] = [];

  // Helper function to count files and get their paths
  const getFileList = (): string[] => {
    const fileElements = document.querySelectorAll('[data-file-id]');
    return Array.from(fileElements).map(el => {
      const nameEl = el.querySelector('.name');
      return nameEl?.textContent || '';
    }).filter(Boolean);
  };

  // Helper function to check if file list actually changed
  const hasFileListChanged = (): boolean => {
    const currentFiles = getFileList();
    const currentCount = currentFiles.length;

    // Check if count changed
    if (currentCount !== lastFileCount) {
      lastFileCount = currentCount;
      lastFileList = currentFiles;
      return true;
    }

    // Check if file names changed (detect renames, additions, deletions)
    const filesChanged = currentFiles.length !== lastFileList.length ||
                        currentFiles.some(f => !lastFileList.includes(f));

    if (filesChanged) {
      lastFileList = currentFiles;
      return true;
    }

    return false;
  };
```

**Step 2: Replace MutationObserver logic**

Replace lines 1248-1277 (the MutationObserver setup and callback) with:

```typescript
      // Set up MutationObserver
      const observer = new MutationObserver((mutations) => {
        // Filter mutations to only relevant ones
        const hasRelevantChanges = mutations.some(mutation => {
          // Skip class changes on existing elements (usually folder expand/collapse)
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            return false;
          }

          // Skip style changes (usually animation-related)
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            return false;
          }

          // Only check for added/removed nodes
          if (mutation.type === 'childList') {
            const affectedNodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];

            return affectedNodes.some(node => {
              if (node instanceof HTMLElement) {
                // Only care about file items, not folder containers
                return node.matches('[data-file-id]') ||
                       node.querySelector('[data-file-id]');
              }
              return false;
            });
          }

          return false;
        });

        if (hasRelevantChanges) {
          console.log('[Overleaf CC] File tree mutation detected, checking if files actually changed...');

          // Debounce: wait for changes to settle
          clearTimeout((window as any).fileTreeChangeTimeout);
          (window as any).fileTreeChangeTimeout = setTimeout(() => {
            // Verify actual file list changed (not just folder expansion)
            if (hasFileListChanged()) {
              console.log('[Overleaf CC] File list actually changed, triggering sync...');

              if (syncManager && stateManager.getState().sync.mode === 'auto') {
                console.log('[Overleaf CC] Triggering auto-sync after file tree change');
                syncManager.syncFromOverleaf();
              }
            } else {
              console.log('[Overleaf CC] File list unchanged (likely folder expand/collapse), skipping sync');
            }
          }, 1000);
        }
      });
```

**Step 3: Initialize file count tracking**

Before line 1285 (before `console.log('[Overleaf CC] File tree watcher active')`), add:

```typescript
      // Initialize file count
      lastFileCount = getFileList().length;
      lastFileList = getFileList();
      console.log(`[Overleaf CC] Initial file count: ${lastFileCount}`);
```

**Step 4: Test file tree expansion**

Run: `npm run build`
Expected: Build succeeds

Run: Load extension, open a project with folders, expand/collapse folders
Expected: No sync triggered when expanding/collapsing folders
Expected: Sync triggered when adding/deleting/renaming files

---

## Task 3: Fix File Deletion Sync

**Files:**
- Modify: `src/content/injector.ts` (handleOverleafChange function, around lines 1355-1430)
- Modify: `src/content/overleaf-websocket.ts` (removeEntity handling, lines 258-284)

**Step 1: Verify removeEntity docId mapping**

In `overleaf-websocket.ts`, replace lines 258-284 (removeEntity handler) with:

```typescript
    } else if (message.name === 'removeEntity') {
      // A document or file was removed from Overleaf
      console.log(`📢 [Overleaf WS] removeEntity received:`, message.args);

      // message.args is [entityId, entityType]
      const entityId = message.args[0] as string;
      const entityType = message.args[1] as string;

      console.log(`📝 [Overleaf CC] Entity removed from Overleaf: ${entityType} (${entityId})`);

      // CRITICAL: Get path from docId mapping BEFORE deleting
      const docInfo = this.docIdToPath.get(entityId);

      if (!docInfo) {
        console.error(`⚠️  [Overleaf WS] Unknown entity ID ${entityId} in removeEntity. Current mappings:`, Array.from(this.docIdToPath.keys()));
        // Still try to notify with just the ID
        if (this.onChangeCallback) {
          this.onChangeCallback({
            type: 'deleted',
            path: `/${entityId}`,  // Fallback path
            docId: entityId
          });
        }
        return;
      }

      const filePath = docInfo.path;
      console.log(`✅ [Overleaf WS] Found path for ${entityId}: ${filePath}`);

      // Remove from docId mapping AFTER getting path
      this.docIdToPath.delete(entityId);
      console.log(`🗑️  [Overleaf WS] Removed ${entityId} from docIdToPath mapping`);

      if (this.onChangeCallback) {
        console.log(`📤 [Overleaf WS] Sending deletion notification to callback: ${filePath}`);
        this.onChangeCallback({
          type: 'deleted',
          path: filePath,
          docId: entityId
        });
      } else {
        console.warn(`⚠️  [Overleaf WS] No onChangeCallback registered for deletion`);
      }
```

**Step 2: Add deletion handler in injector.ts**

Find the handleOverleafChange function in injector.ts (around line 1355) and add handling for 'deleted' type:

```typescript
  overleafWsClient.onChange(async (change: FileChange) => {
    console.log(`🔍 [Overleaf CC] Overleaf change detected:`, change);

    if (change.type === 'deleted') {
      // File deleted in Overleaf
      console.log(`🗑️  [Overleaf CC] File deleted in Overleaf: ${change.path}`);

      if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
        bridgeWs.send(JSON.stringify({
          type: 'FILE_DELETED',
          data: {
            path: change.path,
            docId: change.docId
          }
        }));
        console.log(`✓ [Overleaf CC] Sent deletion notification to bridge: ${change.path}`);
      } else {
        console.warn(`⚠️  [Overleaf CC] Cannot sync deletion - bridge not connected`);
      }
      return;
    }

    if (change.type === 'modified' || change.type === 'created') {
```

**Step 3: Add FILE_DELETED message handler in bridge**

Create file: `packages/bridge/src/handlers/file-deleted-handler.ts`

```typescript
import { promises as fs } from 'fs';
import path from 'path';

export async function handleFileDeleted(data: { path: string; docId?: string }, workspaceDir: string): Promise<void> {
  const filePath = path.join(workspaceDir, data.path);

  try {
    // Check if file exists
    await fs.access(filePath);

    // Delete the file
    await fs.unlink(filePath);
    console.log(`🗑️  [Bridge] Deleted file: ${data.path}`);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`⚠️  [Bridge] File does not exist, skipping deletion: ${data.path}`);
    } else {
      console.error(`✗ [Bridge] Failed to delete ${data.path}:`, error);
      throw error;
    }
  }
}
```

**Step 4: Wire up deletion handler in bridge WebSocket**

Find the bridge WebSocket message handler and add:

```typescript
    case 'FILE_DELETED':
      await handleFileDeleted(msg.data, workspaceDir);
      ws.send(JSON.stringify({
        type: 'FILE_DELETED_ACK',
        payload: { path: msg.data.path }
      }));
      console.log(`✓ [Bridge] File deleted: ${msg.data.path}`);
      break;
```

**Step 5: Test file deletion**

Run: `npm run build`
Expected: Build succeeds

Run: Delete test.tex, test1.tex, test2.tex, test3.tex in Overleaf
Expected: Files deleted from local workspace
Expected: Console logs showing "Deleted file: /test.tex" etc.

---

## Task 4: Implement Incremental Sync with Hash Validation

**Files:**
- Modify: `src/content/injector.ts` (performInitialSync function, around lines 420-580)
- Create: `src/content/sync-state.ts` (new file for tracking sync state)

**Step 1: Create sync state tracker**

Create file: `src/content/sync-state.ts`

```typescript
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
}

// Global instance
export const syncStateTracker = new SyncStateTracker();
```

**Step 2: Add hash generation utility**

In `src/content/injector.ts`, add after imports:

```typescript
/**
 * Generate simple hash for content comparison
 */
function generateContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;  // Convert to 32-bit integer
  }
  return hash.toString(36);
}
```

**Step 3: Update performInitialSync to use incremental sync**

Replace the performInitialSync function (around lines 420-580) with incremental version:

```typescript
/**
 * Perform initial sync - fetch all files from Overleaf and send to bridge
 */
async function performInitialSync(projectId: string): Promise<void> {
  console.log('[Overleaf CC] Starting initial sync...');
  console.log('[Overleaf CC] Fetching file list from Overleaf...');

  // Get all document IDs
  const allDocIds = wsClient.getAllDocIds();
  console.log(`[Overleaf CC] Found ${allDocIds.length} files in project`);

  const syncedFiles: any[] = [];
  const failedFiles: { id: string; path: string; error: string }[] = [];

  // Build current file set for deletion detection
  const currentPaths = new Set<string>();

  // Process files in batches (to avoid overwhelming the connection)
  const BATCH_SIZE = 10;
  for (let i = 0; i < allDocIds.length; i += BATCH_SIZE) {
    const batch = allDocIds.slice(i, Math.min(i + BATCH_SIZE, allDocIds.length));

    for (const id of batch) {
      const info = wsClient.getDocInfo(id);
      if (!info) {
        console.warn(`[Overleaf CC] No info found for ${id}, skipping`);
        continue;
      }

      currentPaths.add(info.path);

      // For files with hash, check if we need to sync
      if (info.hash) {
        const needsSync = syncStateTracker.needsSync(info.path, info.hash);

        if (!needsSync) {
          console.log(`⏭️  [Overleaf CC] Skipping unchanged file: ${info.path}`);
          continue;
        }

        console.log(`📥 [Overleaf CC] File changed, syncing: ${info.path}`);
      }

      console.log(`[Overleaf CC] Syncing ${info.path} (id: ${id}, type: ${info.type})...`);

      try {
        if (info.type === 'doc') {
          // Handle document (text file)
          const lines = await wsClient.joinDoc(id);
          await wsClient.leaveDoc(id);

          const content = lines.join('\n');

          // Generate and store hash
          const hash = generateContentHash(content);
          syncStateTracker.updateHash(info.path, hash, 'doc');

          syncedFiles.push({
            id: id,
            name: info.name,
            path: info.path,
            content: content,
            hash: hash
          });

          console.log(`[Overleaf CC] ✓ Synced ${info.path} (${lines.length} lines)`);
        } else if (info.type === 'file') {
          // Handle file (binary file like image, PDF, etc.)
          const blob = await wsClient.downloadFile(id, projectId);

          // Convert blob to base64
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

          // Use file hash from Overleaf if available, otherwise generate from base64
          const hash = info.hash || generateContentHash(base64);
          syncStateTracker.updateHash(info.path, hash, 'file');

          syncedFiles.push({
            id: id,
            name: info.name,
            path: info.path,
            content: base64,
            hash: hash,
            encoding: 'base64'
          });

          console.log(`[Overleaf CC] ✓ Synced ${info.path} (${blob.size} bytes)`);
        }
      } catch (error) {
        console.error(`[Overleaf CC] ✗ Failed to sync ${id}:`, error);
        failedFiles.push({
          id,
          path: info.path,
          error: (error as Error).message
        });
      }
    }

    // Small delay between batches to avoid overwhelming
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Detect deleted files
  const deletedPaths = syncStateTracker.detectDeletedFiles(currentPaths);
  for (const path of deletedPaths) {
    console.log(`🗑️  [Overleaf CC] File deleted in Overleaf: ${path}`);

    if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
      bridgeWs.send(JSON.stringify({
        type: 'FILE_DELETED',
        data: { path }
      }));

      // Remove from sync state
      syncStateTracker.removeFile(path);
    }
  }

  console.log(`[Overleaf CC] Initial sync complete: ${syncedFiles.length} synced, ${failedFiles.length} failed, ${deletedPaths.length} deleted`);

  // Send all synced files to bridge
  if (syncedFiles.length > 0 && bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
    bridgeWs.send(JSON.stringify({
      type: 'INITIAL_SYNC',
      data: syncedFiles
    }));
    console.log(`[Overleaf CC] Sent ${syncedFiles.length} files to bridge`);
  }

  // Show summary in dropdown
  if (failedFiles.length > 0) {
    dropdown?.showNotification(
      'warning',
      'Sync Partially Failed',
      `${failedFiles.length} files failed to sync. Check console for details.`
    );
  }

  return;
}
```

**Step 4: Update imports in injector.ts**

Add at top of file with other imports:

```typescript
import { syncStateTracker } from './sync-state';
```

**Step 5: Test incremental sync**

Run: `npm run build`
Expected: Build succeeds

Run: Initial sync on project
Expected: All files downloaded on first run
Expected: "Skipping unchanged file" logs on second run
Expected: Only changed files downloaded on third run after modifications

---

## Task 5: Add Integration Tests

**Files:**
- Create: `tests/sync-timeout.test.ts`
- Create: `tests/sync-deletion.test.ts`
- Create: `tests/incremental-sync.test.ts`

**Step 1: Create timeout test**

Create: `tests/sync-timeout.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OverleafWebSocketClient } from '../src/content/overleaf-websocket';

describe('OverleafWebSocketClient - Retry Logic', () => {
  let client: OverleafWebSocketClient;
  let mockWs: WebSocket;

  beforeEach(() => {
    client = new OverleafWebSocketClient();
    mockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn()
    } as any;
    (client as any).ws = mockWs;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('should retry failed requests up to max attempts', async () => {
    let attempts = 0;
    (client as any).pendingRequests = new Map();

    // Mock sendRequest to fail twice then succeed
    vi.spyOn(client as any, 'sendRequest').mockImplementation(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Network error');
      }
      return [null, ['line1', 'line2'], 1];
    });

    const result = await client.joinDoc('test-doc-id');
    expect(attempts).toBe(3);
    expect(result).toEqual(['line1', 'line2']);
  });

  it('should fail after max retry attempts', async () => {
    vi.spyOn(client as any, 'sendRequest').mockRejectedValue(new Error('Network error'));

    await expect(client.joinDoc('test-doc-id')).rejects.toThrow('failed after 3 attempts');
  });
});
```

**Step 2: Create deletion test**

Create: `tests/sync-deletion.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OverleafWebSocketClient } from '../src/content/overleaf-websocket';

describe('OverleafWebSocketClient - File Deletion', () => {
  let client: OverleafWebSocketClient;

  beforeEach(() => {
    client = new OverleafWebSocketClient();

    // Add test files to docIdToPath
    (client as any).docIdToPath.set('test-doc-id', {
      id: 'test-doc-id',
      path: '/test.tex',
      name: 'test.tex',
      type: 'doc'
    });
  });

  it('should handle removeEntity message correctly', () => {
    const callback = vi.fn();
    client.onChange(callback);

    // Simulate removeEntity message
    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['test-doc-id', 'editor']
    });

    expect(callback).toHaveBeenCalledWith({
      type: 'deleted',
      path: '/test.tex',
      docId: 'test-doc-id'
    });
  });

  it('should remove deleted files from docIdToPath', () => {
    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['test-doc-id', 'editor']
    });

    expect((client as any).docIdToPath.has('test-doc-id')).toBe(false);
  });
});
```

**Step 3: Create incremental sync test**

Create: `tests/incremental-sync.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SyncStateTracker } from '../src/content/sync-state';

describe('SyncStateTracker - Incremental Sync', () => {
  let tracker: SyncStateTracker;

  beforeEach(() => {
    tracker = new SyncStateTracker();
  });

  it('should track file hashes', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    expect(tracker.getHash('/test.tex')).toEqual({
      path: '/test.tex',
      hash: 'abc123',
      type: 'doc',
      lastModified: expect.any(Number)
    });
  });

  it('should detect new files', () => {
    expect(tracker.needsSync('/new.tex', 'def456')).toBe(true);
  });

  it('should detect modified files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    expect(tracker.needsSync('/test.tex', 'def456')).toBe(true);
  });

  it('should skip unchanged files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    expect(tracker.needsSync('/test.tex', 'abc123')).toBe(false);
  });

  it('should detect deleted files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    tracker.updateHash('/main.tex', 'def456', 'doc');

    const currentPaths = new Set(['/main.tex']);
    const deleted = tracker.detectDeletedFiles(currentPaths);

    expect(deleted).toEqual(['/test.tex']);
  });
});
```

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass

---

## Task 6: Update Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/troubleshooting.md`

**Step 1: Update README.md**

Add section after installation:

```markdown
## Troubleshooting

### File Sync Timeouts

If you see "Request timeout" errors during sync:
- The extension automatically retries failed downloads up to 3 times
- Check your internet connection
- Try reloading the extension
- See [Troubleshooting Guide](docs/troubleshooting.md) for details

### Files Not Deleting

If deleted files remain in local workspace:
- Check browser console for error messages
- Ensure Bridge is running and connected
- Try manual sync: Click the extension icon → Sync Now

### Excessive Sync Triggers

If sync triggers when expanding folders:
- This is fixed in v1.2.0 - update the extension
- The file tree watcher now distinguishes between folder expansion and file changes
```

**Step 2: Create troubleshooting guide**

Create: `docs/troubleshooting.md`

```markdown
# Troubleshooting Guide

## Sync Issues

### Timeout Errors

**Problem:** Files fail to sync with "Request timeout" errors

**Solutions:**
1. Wait for automatic retry (up to 3 attempts with exponential backoff)
2. Check network connection
3. Reload the extension
4. Check if Overleaf is experiencing issues

**Technical Details:**
- WebSocket requests timeout after 3 seconds
- Retry attempts: 3 (configurable)
- Backoff: 1s → 2s → 4s (exponential)

### File Deletion Not Working

**Problem:** Files deleted in Overleaf remain in local workspace

**Solutions:**
1. Check browser console for "removeEntity" messages
2. Verify Bridge WebSocket is connected
3. Check file permissions in workspace directory
4. Try manual sync: Click extension icon → Sync Now

**Debug Commands:**
```javascript
// In browser console
chrome.runtime.sendMessage({ type: 'GET_DEBUG_INFO' })
```

### Excessive Sync Triggers

**Problem:** Sync triggers when just expanding/collapsing folders

**Solution:**
- Fixed in version 1.2.0
- Update extension: `npm run build && npm run package`
- File tree watcher now:
  - Ignores class/style attribute changes
  - Tracks file count
  - Compares file names before triggering sync

## Performance Optimization

### Incremental Sync

The extension uses incremental sync to avoid unnecessary downloads:

1. **Hash Comparison**: Only downloads files with changed hashes
2. **File Tree Comparison**: Detects additions/deletions without re-downloading
3. **Batch Processing**: Processes files in batches of 10

**First Sync**: Downloads all files (~30-60 seconds for 100 files)
**Subsequent Syncs**: Only changed files (~1-5 seconds)

### Monitoring Sync Performance

```javascript
// In browser console
console.log('[Overleaf CC] Sync state:', syncStateTracker.getAllFiles());
```

## Getting Help

If issues persist:
1. Check browser console (F12 → Console tab)
2. Check Bridge terminal output
3. Open issue on GitHub with:
   - Browser console logs
   - Bridge logs
   - Extension version
   - Overleaf project URL (anonymized)
```

**Step 3: Commit documentation**

```bash
git add README.md docs/troubleshooting.md
git commit -m "docs: add troubleshooting guide and update README"
```

---

## Final Verification Steps

**Step 1: Build and test**

Run: `npm run build`
Expected: Build succeeds without errors

Run: `npm test`
Expected: All tests pass

**Step 2: Integration test**

1. Load extension in Chrome
2. Open Overleaf project with test files
3. Delete test.tex, test1.tex, test2.tex, test3.tex
4. Verify files deleted from local workspace
5. Expand/collapse folders in file tree
6. Verify no sync triggered
7. Edit main.tex in Overleaf
8. Verify only main.tex synced (incremental)
9. Check console for "Skipping unchanged file" messages

**Step 3: Performance verification**

Expected behaviors:
- Initial sync on new project: Downloads all files
- Second sync: Skips all unchanged files
- Edit one file: Only that file synced
- Delete file: File removed from workspace
- Expand folder: No sync triggered
- Network timeout: Automatic retry (3 attempts)

---

## Summary

This plan fixes 4 critical issues:

1. **Timeout Handling**: Retry mechanism with exponential backoff
2. **File Tree False Positives**: Distinguishes folder expansion from file changes
3. **File Deletion**: Proper docId mapping and deletion handling
4. **Incremental Sync**: Hash-based change detection to avoid unnecessary downloads

Expected improvements:
- 90% reduction in unnecessary file downloads
- Elimination of false sync triggers
- Robust handling of network issues
- Proper file deletion sync
