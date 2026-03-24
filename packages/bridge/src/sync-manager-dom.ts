import { promises as fs } from 'fs';
import path from 'path';
import WebSocket from 'ws';
import chokidar from 'chokidar';

interface FileInfo {
  id: string;
  name: string;
  path: string;
  type?: string;
}

interface FileContent {
  content: string;
  path: string;
}

/**
 * SyncManager that reads/writes Overleaf files via Chrome extension content scripts
 * This avoids the need for Overleaf API calls
 */
export class SyncManagerDOM {
  private projectId: string;
  private projectDir: string;
  private overleafTabId?: number;
  private extensionPort?: WebSocket;
  private fileWatcher?: chokidar.FSWatcher;

  constructor(projectId: string, projectDir: string, extensionPort?: WebSocket) {
    this.projectId = projectId;
    this.projectDir = projectDir;
    this.extensionPort = extensionPort;
  }

  /**
   * Send a message to the content script via the Chrome extension
   */
  private async sendToContentScript(message: { type: string; payload?: unknown }, timeoutMs: number = 120000): Promise<any> {
    if (!this.extensionPort) {
      throw new Error('No extension connection available');
    }

    // Check if extension port is still open
    if (this.extensionPort.readyState !== WebSocket.OPEN) {
      throw new Error('Extension connection is closed');
    }

    return new Promise((resolve, reject) => {
      const messageId = Math.random().toString(36).substring(7);
      console.log(`[SyncManagerDOM] Sending message ${messageId}:`, message.type);

      // Set up timeout (default 120 seconds for large file syncs)
      const timeout = setTimeout(() => {
        console.error(`[SyncManagerDOM] Message ${messageId} timeout after ${timeoutMs/1000}s`);
        reject(new Error('Extension message timeout'));
      }, timeoutMs);

      // Listen for response
      const messageHandler = (data: WebSocket.Data) => {
        try {
          const responseText = data.toString();
          const response = JSON.parse(responseText);

          // Log all EXTENSION_MESSAGE responses for debugging
          if (response.type === 'EXTENSION_MESSAGE' && response.messageId === messageId) {
            console.log(`[SyncManagerDOM] Received response for ${messageId}:`, JSON.stringify(response.data).substring(0, 200));
            clearTimeout(timeout);
            this.extensionPort?.removeListener('message', messageHandler);

            if (response.data && response.data.success) {
              // Response is double-nested: response.data.data = { success: true, data: [...] }
              const innerResponse = response.data.data as { success?: boolean; data?: unknown };
              if (innerResponse && innerResponse.success && innerResponse.data) {
                resolve(innerResponse.data);
              } else {
                resolve(response.data.data);
              }
            } else {
              const errorMsg = response.data?.error || 'Unknown error';
              console.error(`[SyncManagerDOM] Error in response:`, errorMsg);
              reject(new Error(errorMsg));
            }
          }
        } catch (err) {
          // Ignore non-JSON messages or parse errors
        }
      };

      this.extensionPort?.on('message', messageHandler);

      // Send message to extension, which will forward to content script
      if (!this.extensionPort) {
        clearTimeout(timeout);
        reject(new Error('Extension connection is not available'));
        return;
      }

      const messageToSend = {
        type: 'EXTENSION_MESSAGE',
        messageId,
        data: {
          action: 'sendToContentScript',
          projectId: this.projectId,
          message
        }
      };

      console.log(`[SyncManagerDOM] Sending to extension:`, JSON.stringify(messageToSend).substring(0, 300));
      this.extensionPort.send(JSON.stringify(messageToSend));
    });
  }

  /**
   * Fetch all files from the Overleaf project
   */
  async fetchAllFiles(): Promise<FileInfo[]> {
    console.log('[SyncManagerDOM] Fetching all files from Overleaf...');

    try {
      const files = await this.sendToContentScript({
        type: 'GET_ALL_FILES'
      });

      console.log(`[SyncManagerDOM] Found ${files.length} files`);
      return files;
    } catch (error) {
      console.error('[SyncManagerDOM] Error fetching files:', error);
      throw error;
    }
  }

  /**
   * Fetch content of a specific file
   * Returns null if file is not currently open in editor
   */
  async fetchFileContent(filePath: string): Promise<string | null> {
    console.log(`[SyncManagerDOM] Fetching content for ${filePath}...`);

    try {
      const fileContent: FileContent = await this.sendToContentScript({
        type: 'GET_FILE_CONTENT',
        payload: { path: filePath }
      });

      console.log(`[SyncManagerDOM] Got content, length: ${fileContent.content.length}`);
      return fileContent.content;
    } catch (error: any) {
      // Check if this is a "file not open" error
      if (error.message && error.message.includes('FILE_NOT_OPEN')) {
        console.log(`[SyncManagerDOM] File ${filePath} is not open in editor, skipping`);
        return null;
      }
      console.error(`[SyncManagerDOM] Error fetching file content for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Update content of a specific file
   */
  async updateFileContent(filePath: string, content: string): Promise<void> {
    console.log(`[SyncManagerDOM] Updating content for ${filePath}...`);

    try {
      await this.sendToContentScript({
        type: 'SET_FILE_CONTENT',
        payload: { path: filePath, content }
      });

      console.log(`[SyncManagerDOM] Successfully updated ${filePath}`);
    } catch (error) {
      console.error(`[SyncManagerDOM] Error updating file content for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Perform initial sync - download all files from Overleaf to local directory
   * Uses Overleaf WebSocket API via extension to fetch all file contents
   */
  async initialSync(): Promise<void> {
    console.log('[SyncManagerDOM] Starting initial sync...');

    try {
      // Fetch all files via extension's WebSocket client
      const files = await this.sendToContentScript({
        type: 'SYNC_ALL_FILES'
      });

      if (!files || !Array.isArray(files) || files.length === 0) {
        console.warn('[SyncManagerDOM] No files received from extension');
        return;
      }

      console.log(`[SyncManagerDOM] Received ${files.length} files from extension`);

      // Write each file to local filesystem
      let syncedCount = 0;
      for (const file of files) {
        try {
          const localPath = path.join(this.projectDir, file.path || file.name);
          await fs.mkdir(path.dirname(localPath), { recursive: true });

          // Check if file is base64 encoded (binary file)
          if (file.encoding === 'base64') {
            // Decode base64 and write as binary
            const buffer = Buffer.from(file.content, 'base64');
            await fs.writeFile(localPath, buffer);
            console.log(`[SyncManagerDOM] ✓ Synced ${file.name} to ${localPath} (${buffer.length} bytes, binary)`);
          } else {
            // Write as text
            await fs.writeFile(localPath, file.content, 'utf-8');
            console.log(`[SyncManagerDOM] ✓ Synced ${file.name} to ${localPath}`);
          }

          syncedCount++;
        } catch (err) {
          console.error(`[SyncManagerDOM] ✗ Failed to sync ${file.name}:`, err);
        }
      }

      console.log(`[SyncManagerDOM] Successfully synced ${syncedCount}/${files.length} files`);
      console.log('[SyncManagerDOM] Initial sync complete!');
    } catch (error) {
      console.error('[SyncManagerDOM] Error during initial sync:', error);
      throw error;
    }
  }

  /**
   * Start watching for local file changes
   * When a file is modified locally, push the change to Overleaf
   */
  startWatching(): void {
    console.log('[SyncManagerDOM] Starting local file watcher...');

    // Watch the project directory for changes
    this.fileWatcher = chokidar.watch(this.projectDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't trigger on initial scan
      awaitWriteFinish: {
        stabilityThreshold: 1000, // Wait 1 second after write before processing
        pollInterval: 100
      }
    });

    // Watch for file changes
    this.fileWatcher.on('change', async (filePath) => {
      await this.handleLocalFileChange(filePath, 'modified');
    });

    // Watch for new files
    this.fileWatcher.on('add', async (filePath) => {
      await this.handleLocalFileChange(filePath, 'created');
    });

    // Watch for deleted files
    this.fileWatcher.on('unlink', async (filePath) => {
      await this.handleLocalFileChange(filePath, 'deleted');
    });

    console.log(`✅ [SyncManagerDOM] Watching ${this.projectDir} for changes`);
  }

  /**
   * Handle local file change and push to Overleaf
   */
  private async handleLocalFileChange(filePath: string, changeType: 'modified' | 'created' | 'deleted'): Promise<void> {
    try {
      // Get relative path from project directory
      const relativePath = path.relative(this.projectDir, filePath);
      console.log(`📝 [SyncManagerDOM] Local file ${changeType}: ${relativePath}`);

      // For now, just log the change
      // TODO: Implement push to Overleaf via extension
      console.log(`💡 [SyncManagerDOM] Note: Local → Overleaf sync not yet implemented`);
      console.log(`   This would require Overleaf API calls to update files`);
    } catch (error) {
      console.error(`❌ [SyncManagerDOM] Error handling local file change:`, error);
    }
  }

  /**
   * Stop watching for file changes
   */
  stop(): void {
    console.log('[SyncManagerDOM] Stopping sync manager');
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = undefined;
    }
  }
}
