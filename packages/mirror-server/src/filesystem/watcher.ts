import chokidar from 'chokidar';
import { join } from 'path';
import { homedir } from 'os';

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
    console.log(`[FileWatcher] 🔧 start() called`);
    console.log(`[FileWatcher] 🔧 Project ID: ${this.projectId}`);
    console.log(`[FileWatcher] 🔧 Watching directory: ${this.projectDir}`);
    console.log(`[FileWatcher] 🔧 Callback registered: ${this.onChangeCallback ? 'Yes' : 'No'}`);

    this.watcher = chokidar.watch(this.projectDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files
    });

    console.log(`[FileWatcher] 🔧 Chokidar watcher created`);

    this.watcher
      .on('add', (path) => {
        const relativePath = this.extractRelativePath(path);

        // Ignore events if syncing from Overleaf (set by server code)
        if (isSyncingFromOverleaf(this.projectId)) {
          console.log(`[FileWatcher] 🔇 Ignoring Overleaf → local save: ${relativePath}`);
          return;
        }

        // Also ignore if this file was recently synced (accounts for chokidar delay)
        if (wasFileRecentlySynced(this.projectId, relativePath)) {
          return;
        }

        console.log(`[FileWatcher] ➕ File added: ${relativePath}`);
        console.log(`[FileWatcher] 🔧 Full path: ${path}`);
        this.onChangeCallback?.({
          type: 'create',
          path: relativePath
        });
      })
      .on('change', (path) => {
        const relativePath = this.extractRelativePath(path);

        // Ignore events if syncing from Overleaf (set by server code)
        if (isSyncingFromOverleaf(this.projectId)) {
          console.log(`[FileWatcher] 🔇 Ignoring Overleaf → local save: ${relativePath}`);
          return;
        }

        // Also ignore if this file was recently synced (accounts for chokidar delay)
        if (wasFileRecentlySynced(this.projectId, relativePath)) {
          return;
        }

        console.log(`[FileWatcher] ✏️ File modified: ${relativePath}`);
        console.log(`[FileWatcher] 🔧 Full path: ${path}`);
        this.onChangeCallback?.({
          type: 'update',
          path: relativePath
        });
      })
      .on('unlink', (path) => {
        const relativePath = this.extractRelativePath(path);

        // Ignore events if syncing from Overleaf (set by server code)
        if (isSyncingFromOverleaf(this.projectId)) {
          console.log(`[FileWatcher] 🔇 Ignoring Overleaf → local save: ${relativePath}`);
          return;
        }

        // Also ignore if this file was recently synced (accounts for chokidar delay)
        if (wasFileRecentlySynced(this.projectId, relativePath)) {
          return;
        }

        console.log(`[FileWatcher] 🗑️ File deleted: ${relativePath}`);
        console.log(`[FileWatcher] 🔧 Full path: ${path}`);
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
      .replace(/^\/+/, '');
  }
}

/**
 * Global map to track which projects are currently syncing from Overleaf
 * This prevents FileWatcher from triggering sync for files saved by the server itself
 */
const syncingFromOverleaf = new Map<string, boolean>();

/**
 * Map to track files that were just synced from Overleaf (with timestamp)
 * Format: Map<projectId, Map<filePath, timestamp>>
 */
const recentlySyncedFiles = new Map<string, Map<string, number>>();

/**
 * Time window (ms) to ignore files after they were synced from Overleaf
 * This accounts for chokidar's delay in detecting file changes
 */
const IGNORE_RECENTLY_SYNCED_WINDOW = 1000; // 1 second

/**
 * Check if a project is currently syncing from Overleaf
 */
export function isSyncingFromOverleaf(projectId: string): boolean {
  return syncingFromOverleaf.get(projectId) || false;
}

/**
 * Mark that a file was just synced from Overleaf
 */
export function markFileSynced(projectId: string, filePath: string): void {
  if (!recentlySyncedFiles.has(projectId)) {
    recentlySyncedFiles.set(projectId, new Map());
  }
  const projectFiles = recentlySyncedFiles.get(projectId)!;
  projectFiles.set(filePath, Date.now());

  // Clean up old entries (older than 2x the ignore window)
  const now = Date.now();
  const cutoff = now - (IGNORE_RECENTLY_SYNCED_WINDOW * 2);
  for (const [path, timestamp] of projectFiles.entries()) {
    if (timestamp < cutoff) {
      projectFiles.delete(path);
    }
  }
}

/**
 * Check if a file was recently synced from Overleaf
 */
export function wasFileRecentlySynced(projectId: string, filePath: string): boolean {
  const projectFiles = recentlySyncedFiles.get(projectId);
  if (!projectFiles) return false;

  const timestamp = projectFiles.get(filePath);
  if (!timestamp) return false;

  const elapsed = Date.now() - timestamp;
  if (elapsed < IGNORE_RECENTLY_SYNCED_WINDOW) {
    console.log(`[FileWatcher] 🔇 Ignoring recently synced file: ${filePath} (${elapsed}ms ago)`);
    return true;
  }

  // Old entry, remove it
  projectFiles.delete(filePath);
  return false;
}

/**
 * Mark that a project is starting to sync from Overleaf
 */
export function startSyncingFromOverleaf(projectId: string): void {
  syncingFromOverleaf.set(projectId, true);
  console.log(`[FileWatcher] 🔄 Started syncing from Overleaf: ${projectId}`);
}

/**
 * Mark that a project has finished syncing from Overleaf
 */
export function stopSyncingFromOverleaf(projectId: string): void {
  syncingFromOverleaf.set(projectId, false);
  console.log(`[FileWatcher] ✅ Finished syncing from Overleaf: ${projectId}`);
}

export type { FileChangeEvent, ChangeEventHandler };
