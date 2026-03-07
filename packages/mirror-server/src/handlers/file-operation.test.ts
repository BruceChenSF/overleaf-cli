import { FileOperationHandler } from './file-operation';
import { ProjectConfig } from '../config/types';
import { OverleafAPIClient } from '../api/overleaf-client';
import fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FileOperationHandler', () => {
  const testDir = join(tmpdir(), 'file-op-test');
  let handler: FileOperationHandler;
  let mockAPIClient: jest.Mocked<OverleafAPIClient>;
  let projectConfig: ProjectConfig;

  beforeEach(async () => {
    await fs.ensureDir(testDir);

    projectConfig = {
      projectId: 'test-project',
      localPath: testDir,
      createdAt: Date.now(),
      lastSyncAt: 0,
      syncBinaryFiles: false
    };

    mockAPIClient = {
      getDocContent: jest.fn(),
      getFileContent: jest.fn()
    } as any;

    handler = new FileOperationHandler(projectConfig, mockAPIClient);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('handleFileCreate', () => {
    it('should create text file from API', async () => {
      const docContent = '\\documentclass{article}';
      mockAPIClient.getDocContent.mockResolvedValue(docContent);

      await handler.handleFileCreate('test-project', {
        _id: 'doc-123',
        name: 'main.tex',
        path: 'main.tex'
      });

      const filePath = join(testDir, 'main.tex');
      expect(await fs.pathExists(filePath)).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe(docContent);
    });

    it('should skip binary files if sync disabled', async () => {
      await handler.handleFileCreate('test-project', {
        _id: 'file-456',
        name: 'figure.pdf',
        path: 'figure.pdf'
      });

      // Verify API was not called
      expect(mockAPIClient.getFileContent).not.toHaveBeenCalled();

      const filePath = join(testDir, 'figure.pdf');
      expect(await fs.pathExists(filePath)).toBe(false);
    });
  });

  describe('handleFileDelete', () => {
    it('should delete existing file', async () => {
      const testFile = join(testDir, 'to-delete.tex');
      await fs.writeFile(testFile, 'content');

      await handler.handleFileDelete('test-project', 'to-delete.tex');

      expect(await fs.pathExists(testFile)).toBe(false);
    });

    it('should handle non-existent file gracefully', async () => {
      // Should not throw
      await expect(
        handler.handleFileDelete('test-project', 'non-existent.tex')
      ).resolves.not.toThrow();
    });
  });

  describe('handleFolderCreate', () => {
    it('should create folder', async () => {
      await handler.handleFolderCreate('test-project', 'new_folder');

      const folderPath = join(testDir, 'new_folder');
      expect(await fs.pathExists(folderPath)).toBe(true);
    });
  });

  describe('handleFolderDelete', () => {
    it('should delete existing folder', async () => {
      const folderPath = join(testDir, 'to-delete');
      await fs.ensureDir(folderPath);

      await handler.handleFolderDelete('test-project', 'to-delete');

      expect(await fs.pathExists(folderPath)).toBe(false);
    });

    it('should handle non-existent folder gracefully', async () => {
      await expect(
        handler.handleFolderDelete('test-project', 'non-existent')
      ).resolves.not.toThrow();
    });
  });
});
