import { promises as fs } from 'fs';
import path from 'path';
import WebSocket from 'ws';

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

  constructor(projectId: string, projectDir: string, extensionPort?: WebSocket) {
    this.projectId = projectId;
    this.projectDir = projectDir;
    this.extensionPort = extensionPort;
  }

  /**
   * Send a message to the content script via the Chrome extension
   */
  private async sendToContentScript(message: { type: string; payload?: unknown }): Promise<any> {
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

      // Set up timeout
      const timeout = setTimeout(() => {
        console.error(`[SyncManagerDOM] Message ${messageId} timeout after 10s`);
        reject(new Error('Extension message timeout'));
      }, 10000);

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
   */
  async fetchFileContent(filePath: string): Promise<string> {
    console.log(`[SyncManagerDOM] Fetching content for ${filePath}...`);

    try {
      const fileContent: FileContent = await this.sendToContentScript({
        type: 'GET_FILE_CONTENT',
        payload: { path: filePath }
      });

      console.log(`[SyncManagerDOM] Got content, length: ${fileContent.content.length}`);
      return fileContent.content;
    } catch (error) {
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
   */
  async initialSync(): Promise<void> {
    console.log('[SyncManagerDOM] Starting initial sync...');

    try {
      // Fetch all files
      const files = await this.fetchAllFiles();
      console.log(`[SyncManagerDOM] Found ${files?.length || 0} files`);

      if (!files || files.length === 0) {
        console.warn('[SyncManagerDOM] No files found in project, will try to sync current document only');
        // Try to get current document content even if file list is empty
        try {
          const content = await this.fetchFileContent('/main.tex');
          const localPath = path.join(this.projectDir, 'main.tex');
          await fs.mkdir(path.dirname(localPath), { recursive: true });
          await fs.writeFile(localPath, content, 'utf-8');
          console.log(`[SyncManagerDOM] Synced current document to ${localPath}`);
        } catch (err) {
          console.error('[SyncManagerDOM] Could not sync current document:', err);
        }
        console.log('[SyncManagerDOM] Initial sync complete (no files found)');
        return;
      }

      // Filter to only get document files (not folders)
      const docFiles = files.filter(f => f.type === 'doc' || f.name.endsWith('.tex') || f.name.endsWith('.bib') || f.name.endsWith('.cls') || f.name.endsWith('.sty'));

      if (docFiles.length === 0) {
        console.warn('[SyncManagerDOM] No document files found (only folders?)');
        return;
      }

      console.log(`[SyncManagerDOM] Found ${docFiles.length} document files`);

      // Try to find main.tex first, otherwise use the first .tex file, otherwise first doc file
      const mainFile = docFiles.find(f => f.name === 'main.tex') ||
                       docFiles.find(f => f.name.endsWith('.tex')) ||
                       docFiles[0];

      console.log(`[SyncManagerDOM] Syncing main file: ${mainFile.name}`);

      const content = await this.fetchFileContent(mainFile.path);

      // Write to local file system
      const localPath = path.join(this.projectDir, mainFile.name);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, content, 'utf-8');

      console.log(`[SyncManagerDOM] Synced ${mainFile.name} to ${localPath}`);
      console.log('[SyncManagerDOM] Initial sync complete!');
    } catch (error) {
      console.error('[SyncManagerDOM] Error during initial sync:', error);
      throw error;
    }
  }

  /**
   * Start watching for local file changes
   * For now, this is a placeholder - we'll implement this later
   */
  startWatching(): void {
    console.log('[SyncManagerDOM] File watching not yet implemented');
    // TODO: Implement file watching with chokidar or similar
  }

  /**
   * Stop watching for file changes
   */
  stop(): void {
    console.log('[SyncManagerDOM] Stopping sync manager');
    // TODO: Clean up file watchers
  }
}
