import chokidar from 'chokidar';
import { join } from 'path';
import { homedir } from 'os';

/**
 * File watcher for monitoring local file changes
 * Currently logs changes without syncing (TODO: implement sync in future phase)
 */
export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;

  constructor(private projectId: string) {}

  /**
   * Start watching the project directory for file changes
   */
  async start(): Promise<void> {
    const projectDir = join(homedir(), 'overleaf-mirror', this.projectId);

    console.log(`[FileWatcher] Watching directory: ${projectDir}`);

    this.watcher = chokidar.watch(projectDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't trigger for existing files
    });

    this.watcher
      .on('add', (path) => {
        console.log(`[FileWatcher] File added: ${path}`);
        // TODO: Queue file to sync to Overleaf
      })
      .on('change', (path) => {
        console.log(`[FileWatcher] File modified: ${path}`);
        // TODO: Queue file to sync to Overleaf
      })
      .on('unlink', (path) => {
        console.log(`[FileWatcher] File deleted: ${path}`);
        // TODO: Queue deletion to sync to Overleaf
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
}
