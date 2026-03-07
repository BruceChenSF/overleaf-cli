import fs from 'fs-extra';
import { join } from 'path';
import { ProjectConfig } from '../config/types';
import { OverleafAPIClient } from '../api/overleaf-client';
import { ProjectFile } from '../api/types';
import { FileSystemManager } from '../filesystem/manager';
import { TEXT_FILE_EXTENSIONS } from '@overleaf-cc/shared';

/**
 * Binary file sync manager with periodic polling
 */
export class BinaryFileSyncManager {
  private fileManager: FileSystemManager;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private projectConfig: ProjectConfig,
    private apiClient: OverleafAPIClient
  ) {
    this.fileManager = new FileSystemManager(projectConfig.localPath);
  }

  /**
   * Start periodic polling
   * @param intervalMs Polling interval in milliseconds (default: 60000 = 1 minute)
   */
  start(intervalMs: number = 60000): void {
    if (this.timer) {
      console.warn('[BinarySync] Already running');
      return;
    }

    console.log(`[BinarySync] Starting with interval ${intervalMs}ms`);

    // Initial sync
    this.syncOnce().catch(err => {
      console.error('[BinarySync] Initial sync error:', err);
    });

    // Periodic sync
    this.timer = setInterval(async () => {
      try {
        await this.syncOnce();
      } catch (error) {
        console.error('[BinarySync] Sync error:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop periodic polling
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[BinarySync] Stopped');
    }
  }

  /**
   * Perform one sync check
   */
  async syncOnce(): Promise<void> {
    if (!this.projectConfig.syncBinaryFiles) {
      return;
    }

    try {
      const remoteFiles = await this.getRemoteBinaryFiles();

      for (const file of remoteFiles) {
        if (await this.shouldUpdate(file)) {
          console.log(`[BinarySync] Updating: ${file.path}`);
          await this.downloadFile(file);
        }
      }
    } catch (error) {
      console.error('[BinarySync] Failed to sync:', error);
    }
  }

  /**
   * Get list of binary files from Overleaf
   */
  async getRemoteBinaryFiles(): Promise<ProjectFile[]> {
    const allFiles = await this.apiClient.getProjectFiles(
      this.projectConfig.projectId
    );

    // Filter to only binary files
    return allFiles.filter(file => {
      if (file.type === 'folder') return false;

      const ext = this.getExtension(file.name);
      return !TEXT_FILE_EXTENSIONS.has(ext);
    });
  }

  /**
   * Check if file should be updated
   */
  async shouldUpdate(file: ProjectFile): Promise<boolean> {
    const localPath = join(this.projectConfig.localPath, file.path);

    // File doesn't exist locally
    if (!await fs.pathExists(localPath)) {
      return true;
    }

    // Compare modification times
    const localStats = await fs.stat(localPath);
    const localMtime = localStats.mtimeMs;
    const remoteMtime = new Date(file.updated).getTime();

    return remoteMtime > localMtime;
  }

  /**
   * Download file from Overleaf
   */
  async downloadFile(file: ProjectFile): Promise<void> {
    try {
      const content = await this.apiClient.getFileContent(
        this.projectConfig.projectId,
        file.path
      );

      const localPath = join(this.projectConfig.localPath, file.path);

      // Ensure directory exists
      await fs.ensureDir(join(localPath, '..'));

      // Write file
      await fs.writeFile(localPath, content);

      console.log(`[BinarySync] Downloaded: ${file.path} (${content.length} bytes)`);
    } catch (error) {
      console.error(`[BinarySync] Failed to download ${file.path}:`, error);
    }
  }

  /**
   * Get file extension
   */
  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot) : '';
  }
}
