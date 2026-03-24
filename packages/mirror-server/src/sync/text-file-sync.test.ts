import fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { TextFileSyncManager } from './text-file-sync';
import { ProjectConfigStore } from '../config/store';
import { OverleafAPIClient } from '../api/overleaf-client';
import { AnyOperation } from '../shared-types';

describe('TextFileSyncManager', () => {
  const testDir = join(tmpdir(), 'text-sync-test');
  let manager: TextFileSyncManager;
  let mockConfigStore: jest.Mocked<ProjectConfigStore>;
  let mockAPIClient: jest.Mocked<OverleafAPIClient>;

  beforeEach(async () => {
    await fs.ensureDir(testDir);

    // Mock dependencies
    mockConfigStore = {
      getProjectConfig: jest.fn().mockReturnValue({
        projectId: 'test-project',
        localPath: testDir,
        syncBinaryFiles: false
      }),
      updateLastSync: jest.fn().mockResolvedValue(undefined)
    } as any;

    mockAPIClient = {
      getDocContent: jest.fn()
    } as any;

    manager = new TextFileSyncManager(
      mockConfigStore.getProjectConfig('test-project'),
      mockAPIClient
    );
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('applyOps', () => {
    it('should apply insert operation', async () => {
      const testFile = join(testDir, 'test.tex');
      await fs.writeFile(testFile, 'Hello World');

      const ops: AnyOperation[] = [{ p: 5, i: ' Beautiful' }];

      await manager.applyOps('test.tex', ops);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('Hello Beautiful World');
    });

    it('should apply delete operation', async () => {
      const testFile = join(testDir, 'test.tex');
      await fs.writeFile(testFile, 'Hello Beautiful World');

      const ops: AnyOperation[] = [{ p: 6, d: 'Beautiful ' }];

      await manager.applyOps('test.tex', ops);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('Hello World');
    });

    it('should apply multiple operations in correct order', async () => {
      const testFile = join(testDir, 'test.tex');
      await fs.writeFile(testFile, 'AB');

      // Insert 'X' at position 1, then 'Y' at position 2
      // Result should be: AXBY
      const ops: AnyOperation[] = [
        { p: 2, i: 'Y' },
        { p: 1, i: 'X' }
      ];

      await manager.applyOps('test.tex', ops);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('AXBY');
    });

    it('should handle empty ops array', async () => {
      const testFile = join(testDir, 'test.tex');
      const originalContent = 'Original Content';
      await fs.writeFile(testFile, originalContent);

      await manager.applyOps('test.tex', []);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe(originalContent);
    });
  });

  describe('initialSync', () => {
    it('should fetch and create file on initial sync', async () => {
      const docContent = '\\documentclass{article}';
      mockAPIClient.getDocContent.mockResolvedValue(docContent);

      await manager.initialSync('doc-123', 'main.tex');

      const testFile = join(testDir, 'main.tex');
      expect(await fs.pathExists(testFile)).toBe(true);

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe(docContent);
    });
  });
});
