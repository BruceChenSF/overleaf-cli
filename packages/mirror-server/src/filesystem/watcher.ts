import chokidar from 'chokidar';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, unlinkSync, statSync, readdirSync, stat } from 'fs';
import { promisify } from 'util';
import type { SyncOrchestrator } from '../sync/sync-orchestrator';

const statAsync = promisify(stat);
const readdirAsync = promisify(readdirSync);

interface FileChangeEvent {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;  // Relative to project directory path
  oldPath?: string;  // For rename operations
  isDirectory?: boolean;  // True if this is a directory operation
}

type ChangeEventHandler = (event: FileChangeEvent) => void;

/**
 * Pending delete event for rename detection
 */
interface PendingDelete {
  path: string;
  timestamp: number;
  size?: number;
}

/**
 * File watcher for monitoring local file changes
 * Currently logs changes without syncing (TODO: implement sync in future phase)
 */
export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private onChangeCallback?: ChangeEventHandler;
  private projectDir: string;
  private pendingDeletes = new Map<string, PendingDelete>();
  private pendingDirDeletes = new Map<string, PendingDelete>(); // NEW: Track pending directory deletes for rename detection
  private readonly RENAME_DETECTION_WINDOW = 3000; // 3 second window to detect renames (increased for Windows)
  private readonly DIR_RENAME_DETECTION_WINDOW = 2000; // 2 second window for directory renames (directories rename faster)
  private fileSizes = new Map<string, number>(); // Track file sizes for rename detection
  private isWatching = false; // Track whether monitoring is enabled
  private orchestrator?: SyncOrchestrator; // NEW: SyncOrchestrator for event filtering

  constructor(
    private projectId: string,
    private basePath?: string,
    orchestrator?: SyncOrchestrator // NEW: Accept orchestrator parameter
  ) {
    this.projectDir = this.basePath || join(homedir(), 'overleaf-mirror', this.projectId);
    this.orchestrator = orchestrator; // NEW: Store orchestrator reference
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

        // 🔧 IMPORTANT: Always update file size, even for server syncs
        // This ensures rename detection works correctly
        const stats = this.safeGetStats(path);
        if (stats) {
          this.fileSizes.set(relativePath, stats.size);
        }

        // Check if this file is being synced by the server (marker file exists)
        const syncId = isFileBeingSynced(this.projectDir, relativePath);

        if (syncId) {
          console.log(`[FileWatcher] 🔇 Ignoring server save (marker file exists): ${relativePath}`);
          console.log(`[FileWatcher] 📤 Sending ACK to complete sync operation: ${syncId}`);

          // Send ACK to acknowledge that FileWatcher detected and ignored this change
          acknowledgeFileSync(syncId);
          return;
        }

        // NEW: SyncOrchestrator - Check if this event should be processed
        if (this.orchestrator) {
          const result = this.orchestrator.shouldProcessEvent('local', 'create', relativePath);
          if (!result.shouldProcess) {
            console.log(`[FileWatcher] 🔇 Ignoring add event (SyncOrchestrator): ${relativePath}`);
            console.log(`[FileWatcher] Reason: ${result.reason}`);
            return;
          }
        }

        // 🔍 Debug: Log pending deletes
        console.log(`[FileWatcher] 🔍 Checking for rename detection...`);
        console.log(`[FileWatcher] 🔍 Current file: ${relativePath}, size: ${stats?.size || 'unknown'}`);
        console.log(`[FileWatcher] 🔍 Pending deletes count: ${this.pendingDeletes.size}`);

        // Check if this might be a rename (recently deleted file with same size)
        const now = Date.now();

        for (const [deletedPath, pendingDelete] of this.pendingDeletes.entries()) {
          const timeDiff = now - pendingDelete.timestamp;
          console.log(`[FileWatcher] 🔍 Comparing with: ${deletedPath}, size: ${pendingDelete.size}, timeDiff: ${timeDiff}ms`);

          // Check if deletion happened recently and files have similar sizes
          if (timeDiff <= this.RENAME_DETECTION_WINDOW &&
              pendingDelete.size === stats?.size) {
            // This is likely a rename!
            console.log(`[FileWatcher] 📝 Detected rename: ${deletedPath} -> ${relativePath} (${timeDiff}ms, size: ${stats?.size})`);

            // Remove from pending deletes
            this.pendingDeletes.delete(deletedPath);
            // Remove from file sizes tracking
            this.fileSizes.delete(deletedPath);

            // Trigger rename event
            this.onChangeCallback?.({
              type: 'rename',
              path: relativePath,
              oldPath: deletedPath
            });

            return;
          } else {
            console.log(`[FileWatcher] 🔍 No match: timeDiff=${timeDiff}ms (limit: ${this.RENAME_DETECTION_WINDOW}ms), size match=${pendingDelete.size === stats?.size}`);
          }
        }

        // Clean up old pending deletes (older than RENAME_DETECTION_WINDOW)
        for (const [deletedPath, pendingDelete] of this.pendingDeletes.entries()) {
          if (now - pendingDelete.timestamp > this.RENAME_DETECTION_WINDOW) {
            this.pendingDeletes.delete(deletedPath);
            this.fileSizes.delete(deletedPath);
          }
        }

        console.log(`[FileWatcher] ➕ File added: ${relativePath} (size: ${stats?.size || 0})`);
        this.onChangeCallback?.({
          type: 'create',
          path: relativePath
        });
      })
      .on('change', (path) => {
        const relativePath = this.extractRelativePath(path);

        // 🔧 IMPORTANT: Always update file size, even for server syncs
        // This ensures rename detection works correctly after file edits
        const stats = this.safeGetStats(path);
        if (stats) {
          this.fileSizes.set(relativePath, stats.size);
          console.log(`[FileWatcher] 📏 Updated file size: ${relativePath} (${stats.size} bytes)`);
        }

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

        // OLD: Marker mechanism (kept for rollback safety)
        // Check if this file is being synced by the server (marker file exists)
        const syncId = isFileBeingSynced(this.projectDir, relativePath);

        if (syncId) {
          console.log(`[FileWatcher] 🔇 Ignoring server save (marker file exists): ${relativePath}`);
          console.log(`[FileWatcher] 📤 Sending ACK to complete sync operation: ${syncId}`);

          // Send ACK to acknowledge that FileWatcher detected and ignored this change
          acknowledgeFileSync(syncId);
          return;
        }

        // NEW: SyncOrchestrator - Check if this delete event should be processed
        if (this.orchestrator) {
          const filterResult = this.orchestrator.shouldProcessEvent('local', 'delete', relativePath);
          if (!filterResult.shouldProcess) {
            console.log(`[FileWatcher] 🔇 Ignoring delete event (SyncOrchestrator): ${relativePath}`);
            console.log(`[FileWatcher] Reason: ${filterResult.reason}`);
            return;
          }
        }

        // Get file size from tracking map (before it's deleted)
        const fileSize = this.fileSizes.get(relativePath);

        console.log(`[FileWatcher] 🔍 File removed, storing for rename detection: ${relativePath} (size: ${fileSize || 'unknown'})`);

        // Store in pending deletes for rename detection
        this.pendingDeletes.set(relativePath, {
          path: relativePath,
          timestamp: Date.now(),
          size: fileSize
        });

        // Set a timeout to trigger delete event if not matched with an add
        setTimeout(() => {
          if (this.pendingDeletes.has(relativePath)) {
            console.log(`[FileWatcher] 🗑️ File deleted (timeout, no rename detected): ${relativePath}`);
            this.pendingDeletes.delete(relativePath);
            this.fileSizes.delete(relativePath);
            this.onChangeCallback?.({
              type: 'delete',
              path: relativePath
            });
          }
        }, this.RENAME_DETECTION_WINDOW + 500); // Add 500ms buffer (was 100ms)
      })
      .on('addDir', (path) => {
        const relativePath = this.extractRelativePath(path);
        console.log(`[FileWatcher] ➕📂 Directory added: ${relativePath}`);

        // Check if this directory is being synced by the server (marker file exists)
        const syncId = isDirectoryBeingSynced(this.projectDir, relativePath);

        if (syncId) {
          console.log(`[FileWatcher] 🔇 Ignoring server directory creation (marker file exists): ${relativePath}`);
          console.log(`[FileWatcher] 📤 Sending ACK to complete directory sync operation: ${syncId}`);

          // Send ACK to acknowledge that FileWatcher detected and ignored this change
          acknowledgeDirectorySync(syncId);
          return;
        }

        // NEW: Check if this is a rename (directory was recently deleted)
        if (this.isWatching) {
          console.log(`[FileWatcher] 🔍 Checking for directory rename...`);

          // Check all pending directory deletes to see if any match this add
          let matchedDelete: { path: string; info: PendingDelete } | null = null;

          for (const [deletedPath, deleteInfo] of this.pendingDirDeletes.entries()) {
            const timeDiff = Date.now() - deleteInfo.timestamp;

            // Check if within rename detection window
            if (timeDiff <= this.DIR_RENAME_DETECTION_WINDOW) {
              console.log(`[FileWatcher] 🔍 Found pending delete: ${deletedPath} (${timeDiff}ms ago)`);

              // Check if the paths are similar (only last component differs)
              // This is a simple heuristic - could be improved
              const oldParts = deletedPath.split('/');
              const newParts = relativePath.split('/');

              // Check if all parts except the last are the same
              const oldParent = oldParts.slice(0, -1).join('/');
              const newParent = newParts.slice(0, -1).join('/');

              if (oldParent === newParent && oldParts.length === newParts.length) {
                console.log(`[FileWatcher] ✅ Detected directory rename: ${deletedPath} -> ${relativePath}`);
                matchedDelete = { path: deletedPath, info: deleteInfo };
                break;
              }
            }
          }

          if (matchedDelete) {
            // Remove from pending deletes
            this.pendingDirDeletes.delete(matchedDelete.path);

            // Trigger rename event
            console.log(`[FileWatcher] 📝✅ Directory rename detected: ${matchedDelete.path} -> ${relativePath}`);
            this.onChangeCallback?.({
              type: 'rename',
              path: relativePath,
              oldPath: matchedDelete.path,
              isDirectory: true
            });
          } else {
            // No matching delete found, treat as create
            console.log(`[FileWatcher] 📁 Directory creation detected: ${relativePath}`);
            this.onChangeCallback?.({
              type: 'create',
              path: relativePath,
              isDirectory: true
            });
          }
        } else {
          console.log(`[FileWatcher] 🔇 Directory creation ignored (monitoring disabled): ${relativePath}`);
        }
      })
      .on('unlinkDir', (path) => {
        const relativePath = this.extractRelativePath(path);
        console.log(`[FileWatcher] 🗑️📂 Directory removed: ${relativePath}`);

        // Check if this directory is being synced by the server (marker file exists)
        const syncId = isDirectoryBeingSynced(this.projectDir, relativePath);

        if (syncId) {
          console.log(`[FileWatcher] 🔇 Ignoring server directory deletion (marker file exists): ${relativePath}`);
          console.log(`[FileWatcher] 📤 Sending ACK to complete directory sync operation: ${syncId}`);

          // Send ACK to acknowledge that FileWatcher detected and ignored this change
          acknowledgeDirectorySync(syncId);
          return;
        }

        // NEW: Store directory deletion for rename detection (similar to file rename detection)
        // Don't immediately trigger delete - wait to see if a corresponding addDir happens
        if (this.isWatching) {
          console.log(`[FileWatcher] 📁 Storing directory deletion for rename detection: ${relativePath}`);
          this.pendingDirDeletes.set(relativePath, {
            path: relativePath,
            timestamp: Date.now()
          });

          // Set timeout to clear pending delete if no matching addDir occurs
          setTimeout(() => {
            const pending = this.pendingDirDeletes.get(relativePath);
            if (pending && Date.now() - pending.timestamp >= this.DIR_RENAME_DETECTION_WINDOW) {
              console.log(`[FileWatcher] 🗑️ Directory deletion timeout (no rename detected): ${relativePath}`);
              this.pendingDirDeletes.delete(relativePath);

              // Trigger delete event
              this.onChangeCallback?.({
                type: 'delete',
                path: relativePath,
                isDirectory: true
              });
            }
          }, this.DIR_RENAME_DETECTION_WINDOW + 500); // Add 500ms buffer
        } else {
          console.log(`[FileWatcher] 🔇 Directory deletion ignored (monitoring disabled): ${relativePath}`);
        }
      })
      .on('error', (error) => {
        console.error(`[FileWatcher] ❌ Watcher error: ${error}`);
      })
      .on('ready', async () => {
        console.log(`[FileWatcher] ✅ Watcher ready - monitoring directory`);

        // 🔧 Initialize file sizes for all existing files
        await this.initializeFileSizes();

        // 🔧 IMPORTANT: Enable monitoring after watcher is ready
        // This prevents initial file scan from triggering false events
        this.isWatching = true;
        console.log(`[FileWatcher] ✅ Monitoring enabled - directory events will now be processed`);
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
      this.isWatching = false; // 🔧 Disable monitoring
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

  /**
   * Safely get file stats (returns null if file doesn't exist)
   */
  private safeGetStats(path: string): { size: number } | null {
    try {
      const stats = statSync(path);
      return { size: stats.size };
    } catch (error) {
      return null;
    }
  }

  /**
   * Initialize file sizes for all existing files in the project directory
   * This ensures we have size information for files that existed before watcher started
   */
  private async initializeFileSizes(): Promise<void> {
    console.log(`[FileWatcher] 🔍 Initializing file sizes for existing files...`);

    try {
      await this.scanDirectory(this.projectDir);
      console.log(`[FileWatcher] ✅ Initialized ${this.fileSizes.size} file sizes`);
    } catch (error) {
      console.error(`[FileWatcher] ❌ Error initializing file sizes:`, error);
    }
  }

  /**
   * Recursively scan directory and record file sizes
   */
  private async scanDirectory(dirPath: string): Promise<void> {
    try {
      const entries = readdirSync(dirPath);

      for (const entryName of entries) {
        const fullPath = join(dirPath, entryName);

        // Skip dotfiles and marker files
        if (entryName.startsWith('.')) {
          continue;
        }

        try {
          const stats = await statAsync(fullPath);

          if (stats.isDirectory()) {
            // Recursively scan subdirectory
            await this.scanDirectory(fullPath);
          } else if (stats.isFile()) {
            // Record file size
            const relativePath = this.extractRelativePath(fullPath);
            this.fileSizes.set(relativePath, stats.size);
            console.log(`[FileWatcher] 📝 Recorded size: ${relativePath} (${stats.size} bytes)`);
          }
        } catch (error) {
          // Skip files that can't be accessed (e.g., symlinks, permissions)
          console.warn(`[FileWatcher] ⚠️ Skipping ${fullPath}:`, error);
        }
      }
    } catch (error) {
      console.error(`[FileWatcher] ❌ Error scanning directory ${dirPath}:`, error);
    }
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
  onComplete?: () => void;  // Callback when operation is completed and ACKed
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
 * Start a sync operation for a directory
 * Creates a marker file inside the directory and returns the sync ID
 *
 * Marker file is placed INSIDE the directory being created
 * Example: For directory "folder1/folder2", marker file is "folder1/folder2/.folder2.syncing"
 *
 * State Machine: IDLE -> PENDING
 */
export function startDirectorySync(
  projectId: string,
  projectDir: string,
  directoryPath: string,
  onComplete?: () => void
): string {
  const syncId = generateSyncId();

  // Normalize path separators to match system (e.g., / to \ on Windows)
  const path = require('path');
  const normalizedPath = path.join(...directoryPath.split('/'));

  // Extract directory name for marker file
  const parts = normalizedPath.split(path.sep);
  const dirName = parts[parts.length - 1];
  const markerFileName = `.${dirName}.syncing`;

  // Marker file is placed INSIDE the directory being created
  const markerFilePath = join(projectDir, normalizedPath, markerFileName);

  // Create marker file (this is a clear signal that we're creating this directory)
  const fs = require('fs');

  // Ensure the directory exists first (we'll create it if it doesn't)
  if (!fs.existsSync(join(projectDir, normalizedPath))) {
    fs.mkdirSync(join(projectDir, normalizedPath), { recursive: true });
  }

  fs.writeFileSync(markerFilePath, syncId, 'utf8');

  // Track this sync operation with state machine
  const syncOperation: SyncOperation = {
    syncId,
    projectId,
    filePath: normalizedPath,
    markFilePath: markerFilePath,
    state: SyncState.PENDING,
    createdAt: Date.now(),
    onComplete  // Store completion callback
  };

  activeSyncs.set(syncId, syncOperation);
  filePathToSyncId.set(normalizedPath, syncId);

  console.log(`[startDirectorySync] Created marker for directory ${normalizedPath} (syncId: ${syncId})`);
  console.log(`[startDirectorySync] Marker file: ${markerFilePath}`);

  return syncId;
}

/**
 * End a sync operation for a directory (directory has been created)
 *
 * State Machine: PENDING -> AWAITING_ACK
 * Does NOT delete marker file immediately - waits for FileWatcher ACK
 */
export function endDirectorySync(syncId: string, onComplete?: () => void): void {
  console.log(`[endDirectorySync] 🔧 Directory created, waiting for ACK`);
  console.log(`[endDirectorySync] 🔧 Sync ID: ${syncId}`);

  const sync = activeSyncs.get(syncId);
  if (!sync) {
    console.warn(`[endDirectorySync] ⚠️ Sync ID not found: ${syncId}`);
    return;
  }

  // Store completion callback if provided
  if (onComplete) {
    sync.onComplete = onComplete;
    console.log(`[endDirectorySync] 📞 Registered completion callback for: ${syncId}`);
  }

  // Transition state: PENDING -> AWAITING_ACK
  sync.state = SyncState.AWAITING_ACK;
  console.log(`[endDirectorySync] ✅ State transition: ${SyncState.PENDING} -> ${SyncState.AWAITING_ACK}`);

  // Set timeout for ACK (prevent deadlock if FileWatcher never detects change)
  sync.timeoutTimer = setTimeout(() => {
    console.log(`[endDirectorySync] ⏱️ ACK timeout for ${syncId}, forcing cleanup`);
    acknowledgeDirectorySync(syncId);
  }, ACK_TIMEOUT);

  console.log(`[endDirectorySync] ⏱️ ACK timer started (${ACK_TIMEOUT}ms timeout)`);
}

/**
 * ACK callback from FileWatcher for directory operations
 *
 * State Machine: AWAITING_ACK -> COMPLETED
 * Deletes marker file and cleans up
 */
export function acknowledgeDirectorySync(syncId: string): void {
  console.log(`[acknowledgeDirectorySync] ✅ ACK received for directory sync: ${syncId}`);

  const sync = activeSyncs.get(syncId);
  if (!sync) {
    console.warn(`[acknowledgeDirectorySync] ⚠️ Sync ID not found: ${syncId}`);
    return;
  }

  // Clear timeout if exists
  if (sync.timeoutTimer) {
    clearTimeout(sync.timeoutTimer);
    console.log(`[acknowledgeDirectorySync] ⏱️ ACK timer cleared`);
  }

  // Transition state: AWAITING_ACK -> COMPLETED
  const oldState = sync.state;
  sync.state = SyncState.COMPLETED;
  console.log(`[acknowledgeDirectorySync] ✅ State transition: ${oldState} -> ${SyncState.COMPLETED}`);

  // Delete marker file (safe to delete now, FileWatcher has processed it)
  if (existsSync(sync.markFilePath)) {
    try {
      console.log(`[acknowledgeDirectorySync] 🔧 Deleting marker file: ${sync.markFilePath}`);
      unlinkSync(sync.markFilePath);
      console.log(`[acknowledgeDirectorySync] ✅ Marker file deleted successfully`);
    } catch (error) {
      console.error(`[acknowledgeDirectorySync] ❌ Failed to delete marker file: ${sync.markFilePath}`, error);
    }
  }

  // Call completion callback if provided (e.g., to complete Orchestrator operation)
  if (sync.onComplete) {
    try {
      console.log(`[acknowledgeDirectorySync] 📞 Calling completion callback for: ${syncId}`);
      sync.onComplete();
      console.log(`[acknowledgeDirectorySync] ✅ Completion callback executed successfully`);
    } catch (error) {
      console.error(`[acknowledgeDirectorySync] ❌ Completion callback error:`, error);
    }
  }

  // Cleanup maps
  activeSyncs.delete(syncId);
  filePathToSyncId.delete(sync.filePath);

  console.log(`[acknowledgeDirectorySync] ✅ Directory sync operation completed and cleaned up`);
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

/**
 * Check if a directory is currently being synced (by checking for marker file)
 *
 * Marker file for directory is placed INSIDE the directory being created
 * Example: For directory "folder1/folder2", marker file is "folder1/folder2/.folder2.syncing"
 *
 * Returns the syncId if being synced, null otherwise
 */
export function isDirectoryBeingSynced(projectDir: string, directoryPath: string): string | null {
  // Marker file is placed inside the directory being created
  const parts = directoryPath.split('/');
  const dirName = parts[parts.length - 1];
  const markerFileName = `.${dirName}.syncing`;
  const markerFilePath = join(projectDir, directoryPath, markerFileName);

  if (!existsSync(markerFilePath)) {
    return null;
  }

  // Read syncId from marker file
  try {
    const fs = require('fs');
    const syncId = fs.readFileSync(markerFilePath, 'utf8');

    // Verify this sync is still active and in AWAITING_ACK state
    const sync = activeSyncs.get(syncId);
    if (sync && sync.state === SyncState.AWAITING_ACK) {
      return syncId;
    } else if (sync) {
      console.warn(`[isDirectoryBeingSynced] Sync found but in unexpected state: ${sync.state}`);
      return syncId;
    } else {
      console.warn(`[isDirectoryBeingSynced] Marker file exists but syncId not found in activeSyncs`);
      return syncId;
    }
  } catch (error) {
    console.error(`[isDirectoryBeingSynced] Error reading marker file:`, error);
    return null;
  }
}

export type { FileChangeEvent, ChangeEventHandler };
