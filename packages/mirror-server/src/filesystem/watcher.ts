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

        // Check if this file is being synced by the server (marker file exists)
        if (isFileBeingSynced(this.projectDir, relativePath)) {
          console.log(`[FileWatcher] 🔇 Ignoring server save (marker file exists): ${relativePath}`);
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

        // Check if this file is being synced by the server (marker file exists)
        if (isFileBeingSynced(this.projectDir, relativePath)) {
          console.log(`[FileWatcher] 🔇 Ignoring server save (marker file exists): ${relativePath}`);
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

        // Check if this file is being synced by the server (marker file exists)
        if (isFileBeingSynced(this.projectDir, relativePath)) {
          console.log(`[FileWatcher] 🔇 Ignoring server save (marker file exists): ${relativePath}`);
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
      .replace(/^[\/\\]+/, '');  // Handle both forward slashes and Windows backslashes
  }
}

/**
 * Map to track sync operations by their unique IDs
 * Format: Map<syncId, { projectId, filePath, markFilePath }>
 */
const activeSyncs = new Map<string, { projectId: string; filePath: string; markFilePath: string }>();

/**
 * Generate a unique sync ID
 */
function generateSyncId(): string {
  return `sync-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Start a sync operation for a file
 * Creates a marker file and returns the sync ID
 */
export function startFileSync(projectId: string, projectDir: string, filePath: string): string {
  const syncId = generateSyncId();
  const markFileName = `.${filePath}.syncing`;
  const markFilePath = join(projectDir, markFileName);

  // Create marker file (this is a clear signal that we're saving this file)
  const fs = require('fs');
  const path = require('path');

  // Ensure parent directory exists for the marker file
  const markerDir = path.dirname(markFilePath);
  if (!fs.existsSync(markerDir)) {
    fs.mkdirSync(markerDir, { recursive: true });
  }

  fs.writeFileSync(markFilePath, syncId, 'utf8');

  // Track this sync operation
  activeSyncs.set(syncId, { projectId, filePath, markFilePath });

  return syncId;
}

/**
 * End a sync operation for a file
 * Removes the marker file
 */
export function endFileSync(syncId: string): void {
  const sync = activeSyncs.get(syncId);
  if (!sync) {
    console.warn(`[FileWatcher] ⚠️ Sync ID not found: ${syncId}`);
    return;
  }

  // Remove marker file
  if (existsSync(sync.markFilePath)) {
    try {
      unlinkSync(sync.markFilePath);
    } catch (error) {
      console.error(`[FileWatcher] ❌ Failed to delete marker file: ${sync.markFilePath}`, error);
    }
  }

  // Remove from active syncs
  activeSyncs.delete(syncId);
}

/**
 * Check if a file is currently being synced (by checking for marker file)
 */
export function isFileBeingSynced(projectDir: string, filePath: string): boolean {
  const markFileName = `.${filePath}.syncing`;
  const markFilePath = join(projectDir, markFileName);
  return existsSync(markFilePath);
}

export type { FileChangeEvent, ChangeEventHandler };
