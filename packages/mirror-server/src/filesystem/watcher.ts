import chokidar from 'chokidar';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, unlinkSync } from 'fs';

interface FileChangeEvent {
  type: 'create' | 'update' | 'delete';
  path: string;  // Relative to project directory path
}

type ChangeEventHandler = (event: FileChangeEvent) => void;

/**
 * File watcher for monitoring local file changes
 * Currently logs changes without syncing (TODO: implement sync in future phase)
 */
export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private onChangeCallback?: ChangeEventHandler;
  private projectDir: string;

  constructor(
    private projectId: string,
    private basePath?: string
  ) {
    this.projectDir = this.basePath || join(homedir(), 'overleaf-mirror', this.projectId);
  }

  /**
   * Start watching the project directory for file changes
   */
  async start(): Promise<void> {
    console.log(`[FileWatcher] Starting file watcher for project ${this.projectId}`);
    console.log(`[FileWatcher] Watching directory: ${this.projectDir}`);

    this.watcher = chokidar.watch(this.projectDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files
      awaitWriteFinish: true, // 🔧 Wait for write completion before triggering event
      usePolling: false, // 🔧 Use native file watching (more efficient, less false positives)
      atomic: 1000, // 🔧 Wait 1s after last change before considering write complete (reduces duplicate events)
      followSymlinks: false, // Don't follow symbolic links
      depth: 99 // Watch subdirectories
    });

    this.watcher
      .on('add', (path) => {
        const relativePath = this.extractRelativePath(path);

        // Check if this file is being synced by the server (marker file exists)
        const syncId = isFileBeingSynced(this.projectDir, relativePath);

        if (syncId) {
          console.log(`[FileWatcher] 🔇 Ignoring server save (marker file exists): ${relativePath}`);
          console.log(`[FileWatcher] 📤 Sending ACK to complete sync operation: ${syncId}`);

          // Send ACK to acknowledge that FileWatcher detected and ignored this change
          acknowledgeFileSync(syncId);
          return;
        }

        console.log(`[FileWatcher] ➕ File added: ${relativePath}`);
        this.onChangeCallback?.({
          type: 'create',
          path: relativePath
        });
      })
      .on('change', (path) => {
        const relativePath = this.extractRelativePath(path);

        // Check if this file is being synced by the server (marker file exists)
        // This now returns the syncId if being synced, null otherwise
        const syncId = isFileBeingSynced(this.projectDir, relativePath);

        if (syncId) {
          console.log(`[FileWatcher] 🔇 Ignoring server save (marker file exists): ${relativePath}`);
          console.log(`[FileWatcher] 📤 Sending ACK to complete sync operation: ${syncId}`);

          // Send ACK to acknowledge that FileWatcher detected and ignored this change
          acknowledgeFileSync(syncId);
          return;
        }

        console.log(`[FileWatcher] ✏️ File modified: ${relativePath}`);
        this.onChangeCallback?.({
          type: 'update',
          path: relativePath
        });
      })
      .on('unlink', (path) => {
        const relativePath = this.extractRelativePath(path);

        // Check if this file is being synced by the server (marker file exists)
        const syncId = isFileBeingSynced(this.projectDir, relativePath);

        if (syncId) {
          console.log(`[FileWatcher] 🔇 Ignoring server save (marker file exists): ${relativePath}`);
          console.log(`[FileWatcher] 📤 Sending ACK to complete sync operation: ${syncId}`);

          // Send ACK to acknowledge that FileWatcher detected and ignored this change
          acknowledgeFileSync(syncId);
          return;
        }

        console.log(`[FileWatcher] 🗑️ File deleted: ${relativePath}`);
        this.onChangeCallback?.({
          type: 'delete',
          path: relativePath
        });
      })
      .on('error', (error) => {
        console.error(`[FileWatcher] ❌ Watcher error: ${error}`);
      })
      .on('ready', () => {
        console.log(`[FileWatcher] ✅ Watcher ready - monitoring directory`);
      });

    console.log(`[FileWatcher] ✅ Event listeners registered`);
  }

  /**
   * Stop watching for file changes
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      console.log('[FileWatcher] Stopped watching');
    }
  }

  /**
   * Register a callback to be invoked when files change
   */
  onChange(callback: ChangeEventHandler): void {
    this.onChangeCallback = callback;
    console.log('[FileWatcher] Change callback registered');
  }

  /**
   * Extract relative path from full path
   */
  private extractRelativePath(fullPath: string): string {
    return fullPath
      .replace(this.projectDir, '')
      .replace(/^[\/\\]+/, '');  // Handle both forward slashes and Windows backslashes
  }
}

/**
 * Sync operation states (State Machine)
 */
enum SyncState {
  PENDING = 'PENDING',           // Marker file created, waiting to write
  AWAITING_ACK = 'AWAITING_ACK', // File written, waiting for FileWatcher ACK
  COMPLETED = 'COMPLETED',       // ACK received, marker file can be deleted
  TIMEOUT = 'TIMEOUT'            // Timeout, forced cleanup
}

/**
 * Sync operation metadata with state machine
 */
interface SyncOperation {
  syncId: string;
  projectId: string;
  filePath: string;
  markFilePath: string;
  state: SyncState;
  createdAt: number;
  timeoutTimer?: NodeJS.Timeout;
}

/**
 * Map to track sync operations by their unique IDs
 * Format: Map<syncId, SyncOperation>
 */
const activeSyncs = new Map<string, SyncOperation>();

/**
 * Reverse lookup: filePath -> syncId (for FileWatcher to send ACK)
 * Format: Map<filePath, syncId>
 */
const filePathToSyncId = new Map<string, string>();

/**
 * ACK timeout (ms) - if no ACK received within this time, force cleanup
 */
const ACK_TIMEOUT = 5000;

/**
 * Generate a unique sync ID
 */
function generateSyncId(): string {
  return `sync-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Start a sync operation for a file
 * Creates a marker file and returns the sync ID
 *
 * State Machine: IDLE -> PENDING
 */
export function startFileSync(projectId: string, projectDir: string, filePath: string): string {
  const syncId = generateSyncId();

  // Normalize path separators to match system (e.g., / to \ on Windows)
  const path = require('path');
  const normalizedPath = path.join(...filePath.split('/'));
  const markFileName = `.${normalizedPath}.syncing`;
  const markFilePath = join(projectDir, markFileName);

  // Create marker file (this is a clear signal that we're saving this file)
  const fs = require('fs');

  // Ensure parent directory exists for the marker file
  const markerDir = path.dirname(markFilePath);
  if (!fs.existsSync(markerDir)) {
    fs.mkdirSync(markerDir, { recursive: true });
  }

  fs.writeFileSync(markFilePath, syncId, 'utf8');

  // Track this sync operation with state machine
  const syncOperation: SyncOperation = {
    syncId,
    projectId,
    filePath: normalizedPath,
    markFilePath,
    state: SyncState.PENDING,
    createdAt: Date.now()
  };

  activeSyncs.set(syncId, syncOperation);
  filePathToSyncId.set(normalizedPath, syncId);

  console.log(`[startFileSync] Created marker for ${normalizedPath} (syncId: ${syncId})`);

  return syncId;
}

/**
 * End a sync operation for a file (file has been written)
 *
 * State Machine: PENDING -> AWAITING_ACK
 * Does NOT delete marker file immediately - waits for FileWatcher ACK
 */
export function endFileSync(syncId: string): void {
  console.log(`[endFileSync] 🔧 File written, waiting for ACK`);
  console.log(`[endFileSync] 🔧 Sync ID: ${syncId}`);

  const sync = activeSyncs.get(syncId);
  if (!sync) {
    console.warn(`[endFileSync] ⚠️ Sync ID not found: ${syncId}`);
    return;
  }

  // Transition state: PENDING -> AWAITING_ACK
  sync.state = SyncState.AWAITING_ACK;
  console.log(`[endFileSync] ✅ State transition: ${SyncState.PENDING} -> ${SyncState.AWAITING_ACK}`);

  // Set timeout for ACK (prevent deadlock if FileWatcher never detects change)
  sync.timeoutTimer = setTimeout(() => {
    console.log(`[endFileSync] ⏱️ ACK timeout for ${syncId}, forcing cleanup`);
    acknowledgeFileSync(syncId);
  }, ACK_TIMEOUT);

  console.log(`[endFileSync] ⏱️ ACK timer started (${ACK_TIMEOUT}ms timeout)`);
}

/**
 * ACK callback from FileWatcher (acknowledges that file change was detected and ignored)
 *
 * State Machine: AWAITING_ACK -> COMPLETED
 * Deletes marker file and cleans up
 */
export function acknowledgeFileSync(syncId: string): void {
  console.log(`[acknowledgeFileSync] ✅ ACK received for sync: ${syncId}`);

  const sync = activeSyncs.get(syncId);
  if (!sync) {
    console.warn(`[acknowledgeFileSync] ⚠️ Sync ID not found: ${syncId}`);
    return;
  }

  // Clear timeout if exists
  if (sync.timeoutTimer) {
    clearTimeout(sync.timeoutTimer);
    console.log(`[acknowledgeFileSync] ⏱️ ACK timer cleared`);
  }

  // Transition state: AWAITING_ACK -> COMPLETED
  const oldState = sync.state;
  sync.state = SyncState.COMPLETED;
  console.log(`[acknowledgeFileSync] ✅ State transition: ${oldState} -> ${SyncState.COMPLETED}`);

  // Delete marker file (safe to delete now, FileWatcher has processed it)
  if (existsSync(sync.markFilePath)) {
    try {
      console.log(`[acknowledgeFileSync] 🔧 Deleting marker file: ${sync.markFilePath}`);
      unlinkSync(sync.markFilePath);
      console.log(`[acknowledgeFileSync] ✅ Marker file deleted successfully`);
    } catch (error) {
      console.error(`[acknowledgeFileSync] ❌ Failed to delete marker file: ${sync.markFilePath}`, error);
    }
  }

  // Cleanup maps
  activeSyncs.delete(syncId);
  filePathToSyncId.delete(sync.filePath);

  console.log(`[acknowledgeFileSync] ✅ Sync operation completed and cleaned up`);
}

/**
 * Check if a file is currently being synced (by checking for marker file)
 *
 * Returns the syncId if being synced, null otherwise
 * This allows FileWatcher to send ACK back
 */
export function isFileBeingSynced(projectDir: string, filePath: string): string | null {
  const markFileName = `.${filePath}.syncing`;
  const markFilePath = join(projectDir, markFileName);

  if (!existsSync(markFilePath)) {
    return null;
  }

  // Read syncId from marker file
  try {
    const fs = require('fs');
    const syncId = fs.readFileSync(markFilePath, 'utf8');

    // Verify this sync is still active and in AWAITING_ACK state
    const sync = activeSyncs.get(syncId);
    if (sync && sync.state === SyncState.AWAITING_ACK) {
      return syncId;
    } else if (sync) {
      console.warn(`[isFileBeingSynced] Sync found but in unexpected state: ${sync.state}`);
      return syncId; // Still return syncId to let ACK handle it
    } else {
      console.warn(`[isFileBeingSynced] Marker file exists but syncId not found in activeSyncs`);
      return syncId; // Return syncId anyway, cleanup will handle stale markers
    }
  } catch (error) {
    console.error(`[isFileBeingSynced] Error reading marker file:`, error);
    return null;
  }
}

export type { FileChangeEvent, ChangeEventHandler };
