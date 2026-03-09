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
    console.log(`[FileWatcher] Watching directory: ${this.projectDir}`);

    this.watcher = chokidar.watch(this.projectDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files
    });

    this.watcher
      .on('add', (path) => {
        const relativePath = this.extractRelativePath(path);
        console.log(`[FileWatcher] File added: ${relativePath}`);
        this.onChangeCallback?.({
          type: 'create',
          path: relativePath
        });
      })
      .on('change', (path) => {
        const relativePath = this.extractRelativePath(path);
        console.log(`[FileWatcher] File modified: ${relativePath}`);
        this.onChangeCallback?.({
          type: 'update',
          path: relativePath
        });
      })
      .on('unlink', (path) => {
        const relativePath = this.extractRelativePath(path);
        console.log(`[FileWatcher] File deleted: ${relativePath}`);
        this.onChangeCallback?.({
          type: 'delete',
          path: relativePath
        });
      })
      .on('error', (error) => {
        console.error(`[FileWatcher] Watcher error: ${error}`);
      });
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

export type { FileChangeEvent, ChangeEventHandler };
