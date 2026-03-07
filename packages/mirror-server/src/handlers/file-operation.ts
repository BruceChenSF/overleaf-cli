import { join, extname } from 'path';
import { ProjectConfig } from '../config/types';
import { OverleafAPIClient } from '../api/overleaf-client';
import { FileSystemManager } from '../filesystem/manager';
import { TEXT_FILE_EXTENSIONS } from '@overleaf-cc/shared';
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
          // Document updates are handled via edit events, ignore here
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
   */
  async handleFileCreate(projectId: string, fileInfo: FileInfo): Promise<void> {
    const isBinary = this.isBinaryFile(fileInfo.name);

    // Skip binary files if not configured
    if (isBinary && !this.projectConfig.syncBinaryFiles) {
      console.log(`[FileHandler] Skipping binary file: ${fileInfo.name}`);
      return;
    }

    try {
      let content: string | Buffer;

      if (fileInfo._id) {
        // Document type - fetch via API
        content = await this.apiClient.getDocContent(projectId, fileInfo._id);
      } else {
        // File type - fetch via API
        content = await this.apiClient.getFileContent(projectId, fileInfo.path);
      }

      const localPath = join(this.projectConfig.localPath, fileInfo.path);

      await this.fileManager.createFile(fileInfo.path, content.toString());

      console.log(`[FileHandler] Created: ${fileInfo.path}`);
    } catch (error) {
      console.error(`[FileHandler] Failed to create ${fileInfo.name}:`, error);
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
   * Check if file is binary based on extension
   */
  private isBinaryFile(filename: string): boolean {
    const ext = extname(filename);
    return !TEXT_FILE_EXTENSIONS.has(ext);
  }
}
