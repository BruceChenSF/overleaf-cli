import path, { join, extname } from 'path';
import { ProjectConfig } from '../config/types';
import { OverleafAPIClient } from '../api/overleaf-client';
import { FileSystemManager } from '../filesystem/manager';
import { TEXT_FILE_EXTENSIONS } from '../shared-types';
import fs from 'fs-extra';

/**
 * File information from Overleaf
 */
interface FileInfo {
  _id?: string;
  name: string;
  path: string;
}

/**
 * Mirror request from webRequest interception
 */
interface MirrorRequest {
  projectId: string;
  method: 'POST' | 'PUT' | 'DELETE';
  apiEndpoint: string;
  body?: any;
}

/**
 * Handle file operations (create, delete, rename) from Overleaf
 */
export class FileOperationHandler {
  private fileManager: FileSystemManager;

  constructor(
    private projectConfig: ProjectConfig,
    private apiClient: OverleafAPIClient
  ) {
    this.fileManager = new FileSystemManager(projectConfig.localPath);
  }

  /**
   * Handle mirror request from browser extension
   */
  async handleMirrorRequest(request: MirrorRequest): Promise<void> {
    const { projectId, method, apiEndpoint, body } = request;

    // Parse API endpoint
    // Examples:
    // - /project/{id}/doc -> create document
    // - /project/{id}/doc/{doc_id} -> update/delete document
    // - /project/{id}/folder -> create folder

    const match = apiEndpoint.match(/\/project\/([^\/]+)\/(.+)/);
    if (!match) {
      console.warn('[FileHandler] Unrecognized endpoint:', apiEndpoint);
      return;
    }

    const [, _projectId, action] = match;

    try {
      switch (method) {
        case 'POST':
          if (action === 'doc') {
            await this.handleFileCreate(projectId, body);
          } else if (action === 'folder') {
            await this.handleFolderCreate(projectId, body?.folder_path);
          }
          break;

        case 'DELETE':
          if (action.startsWith('doc/')) {
            const docId = action.split('/')[1];
            await this.handleFileDelete(projectId, docId);
          } else if (action.startsWith('folder/')) {
            const folderPath = action.split('/')[1];
            await this.handleFolderDelete(projectId, folderPath);
          }
          break;

        case 'PUT':
          // Handle file/folder rename
          if (action.startsWith('doc/') || action.startsWith('file/')) {
            // Parse rename operation from body
            // Overleaf sends: { _id: "...", name: "new_name.tex" }
            if (body && body.name) {
              await this.handleFileRename(projectId, body);
            }
          } else if (action.startsWith('folder/')) {
            // Handle folder rename
            if (body && body.name) {
              await this.handleFolderRename(projectId, body);
            }
          }
          break;

        default:
          console.warn('[FileHandler] Unhandled method:', method);
      }
    } catch (error) {
      console.error('[FileHandler] Error handling request:', error);
    }
  }

  /**
   * Handle file creation
   *
   * NOTE: Since Overleaf API doesn't work reliably, we create an empty
   * placeholder file. The actual content will be synced via:
   * 1. Browser-side WebSocket sync (for initial content)
   * 2. Edit events (for subsequent changes)
   */
  async handleFileCreate(projectId: string, fileInfo: FileInfo): Promise<void> {
    const isBinary = this.isBinaryFile(fileInfo.name);

    // Skip binary files if not configured
    if (isBinary && !this.projectConfig.syncBinaryFiles) {
      console.log(`[FileHandler] ⏭️ Skipping binary file: ${fileInfo.name}`);
      return;
    }

    try {
      // Check if file already exists (might be synced via browser)
      const exists = await this.fileManager.fileExists(fileInfo.path);

      if (exists) {
        console.log(`[FileHandler] ✅ File already exists: ${fileInfo.path} (skipping)`);
        return;
      }

      // Create empty file as placeholder
      // Content will be synced via browser WebSocket or edit events
      const fullPath = join(this.projectConfig.localPath, fileInfo.path);

      if (isBinary) {
        // For binary files, create empty buffer using fs directly
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, Buffer.alloc(0));
        console.log(`[FileHandler] ✅ Created empty binary file placeholder: ${fileInfo.path}`);
      } else {
        // For text files, create empty file
        await this.fileManager.createFile(fileInfo.path, '');
        console.log(`[FileHandler] ✅ Created empty text file placeholder: ${fileInfo.path}`);
      }

      // Log that we're waiting for browser sync
      console.log(`[FileHandler] ⏳ Waiting for browser to sync actual content for: ${fileInfo.path}`);
    } catch (error) {
      console.error(`[FileHandler] ❌ Failed to create ${fileInfo.name}:`, error);
    }
  }

  /**
   * Handle file deletion
   */
  async handleFileDelete(projectId: string, filePath: string): Promise<void> {
    try {
      const exists = await this.fileManager.fileExists(filePath);

      if (exists) {
        await this.fileManager.deleteFile(filePath);
        console.log(`[FileHandler] Deleted: ${filePath}`);
      } else {
        console.log(`[FileHandler] File not found (skipping): ${filePath}`);
      }
    } catch (error) {
      console.error(`[FileHandler] Failed to delete ${filePath}:`, error);
    }
  }

  /**
   * Handle folder creation
   */
  async handleFolderCreate(projectId: string, folderPath: string): Promise<void> {
    try {
      const fullPath = join(this.projectConfig.localPath, folderPath);
      await fs.ensureDir(fullPath);
      console.log(`[FileHandler] Created folder: ${folderPath}`);
    } catch (error) {
      console.error(`[FileHandler] Failed to create folder ${folderPath}:`, error);
    }
  }

  /**
   * Handle folder deletion
   */
  async handleFolderDelete(projectId: string, folderPath: string): Promise<void> {
    try {
      const fullPath = join(this.projectConfig.localPath, folderPath);
      const exists = await fs.pathExists(fullPath);

      if (exists) {
        await fs.remove(fullPath);
        console.log(`[FileHandler] Deleted folder: ${folderPath}`);
      }
    } catch (error) {
      console.error(`[FileHandler] Failed to delete folder ${folderPath}:`, error);
    }
  }

  /**
   * Handle file rename
   */
  async handleFileRename(projectId: string, renameInfo: { _id?: string; name: string; path?: string }): Promise<void> {
    try {
      // For rename, we need to find the current file and rename it
      // Overleaf sends: { _id: "...", name: "new_name.tex" }
      // But we don't have a reliable mapping from _id to path
      // So we'll need to search for the file

      // TODO: Implement proper _id to path mapping
      // For now, we'll just log the rename operation
      console.log(`[FileHandler] ⚠️ File rename requested:`, renameInfo);
      console.log(`[FileHandler] ⚠️ Note: File rename requires _id to path mapping, not yet implemented`);

      // Alternative approach: If the browser extension sends the old path,
      // we can use that to rename the file
      // This would require enhancing the intercepted request data

    } catch (error) {
      console.error(`[FileHandler] Failed to rename file:`, error);
    }
  }

  /**
   * Handle folder rename
   */
  async handleFolderRename(projectId: string, renameInfo: { _id?: string; name: string; path?: string }): Promise<void> {
    try {
      // Similar to file rename, we need the old path to rename
      console.log(`[FileHandler] ⚠️ Folder rename requested:`, renameInfo);
      console.log(`[FileHandler] ⚠️ Note: Folder rename requires _id to path mapping, not yet implemented`);

    } catch (error) {
      console.error(`[FileHandler] Failed to rename folder:`, error);
    }
  }

  /**
   * Check if file is binary based on extension
   */
  private isBinaryFile(filename: string): boolean {
    const ext = extname(filename);
    return !TEXT_FILE_EXTENSIONS.has(ext);
  }
}
