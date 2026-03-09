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
  private startTime: number = 0;
  private silentPeriod: number = 3000; // 3 seconds silent period after start

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
    console.log(`[FileWatcher] 🔧 Silent period: ${this.silentPeriod}ms`);

    // Record start time for silent period
    this.startTime = Date.now();

    this.watcher = chokidar.watch(this.projectDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files
    });

    console.log(`[FileWatcher] 🔧 Chokidar watcher created`);

    this.watcher
      .on('add', (path) => {
        // Ignore events during silent period
        if (this.isInSilentPeriod()) {
          console.log(`[FileWatcher] 🔇 Silencing add event during silent period: ${this.extractRelativePath(path)}`);
          return;
        }

        const relativePath = this.extractRelativePath(path);
        console.log(`[FileWatcher] ➕ File added: ${relativePath}`);
        console.log(`[FileWatcher] 🔧 Full path: ${path}`);
        this.onChangeCallback?.({
          type: 'create',
          path: relativePath
        });
      })
      .on('change', (path) => {
        // Ignore events during silent period
        if (this.isInSilentPeriod()) {
          console.log(`[FileWatcher] 🔇 Silencing change event during silent period: ${this.extractRelativePath(path)}`);
          return;
        }

        const relativePath = this.extractRelativePath(path);
        console.log(`[FileWatcher] ✏️ File modified: ${relativePath}`);
        console.log(`[FileWatcher] 🔧 Full path: ${path}`);
        this.onChangeCallback?.({
          type: 'update',
          path: relativePath
        });
      })
      .on('unlink', (path) => {
        // Ignore events during silent period
        if (this.isInSilentPeriod()) {
          console.log(`[FileWatcher] 🔇 Silencing unlink event during silent period: ${this.extractRelativePath(path)}`);
          return;
        }

        const relativePath = this.extractRelativePath(path);
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
   * Check if currently in silent period (just after start)
   * This prevents triggering sync for files saved during initial sync
   */
  private isInSilentPeriod(): boolean {
    const elapsed = Date.now() - this.startTime;
    const inSilentPeriod = elapsed < this.silentPeriod;

    if (inSilentPeriod) {
      console.log(`[FileWatcher] 🔇 In silent period: ${elapsed}ms < ${this.silentPeriod}ms`);
    }

    return inSilentPeriod;
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

export type { FileChangeEvent, ChangeEventHandler };
