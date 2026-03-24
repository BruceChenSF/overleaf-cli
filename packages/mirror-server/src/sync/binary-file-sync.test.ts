import { BinaryFileSyncManager } from './binary-file-sync';
import { ProjectConfig } from '../config/types';
import { OverleafAPIClient } from '../api/overleaf-client';
import { ProjectFile } from '../api/types';
import fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';

describe('BinaryFileSyncManager', () => {
  const testDir = join(tmpdir(), 'binary-sync-test');
  let manager: BinaryFileSyncManager;
  let mockAPIClient: jest.Mocked<OverleafAPIClient>;
  let projectConfig: ProjectConfig;

  beforeEach(async () => {
    await fs.ensureDir(testDir);

    projectConfig = {
      projectId: 'test-project',
      localPath: testDir,
      createdAt: Date.now(),
      lastSyncAt: 0,
      syncBinaryFiles: true
    };

    mockAPIClient = {
      getFileContent: jest.fn(),
      getProjectFiles: jest.fn()
    } as any;

    manager = new BinaryFileSyncManager(projectConfig, mockAPIClient);
  });

  afterEach(async () => {
    manager.stop();
    await fs.remove(testDir);
  });

  describe('syncOnce', () => {
    it('should skip binary files when sync disabled', async () => {
      projectConfig.syncBinaryFiles = false;

      manager = new BinaryFileSyncManager(projectConfig, mockAPIClient);
      await manager.syncOnce();

      expect(mockAPIClient.getFileContent).not.toHaveBeenCalled();
    });

    it('should download new binary files', async () => {
      const mockBuffer = Buffer.from('fake pdf content');
      mockAPIClient.getFileContent.mockResolvedValue(mockBuffer);

      const remoteFiles: ProjectFile[] = [
        {
          _id: 'file-1',
          name: 'figure.pdf',
          path: 'figure.pdf',
          type: 'file',
          created: new Date().toISOString(),
          updated: new Date().toISOString()
        }
      ];

      (mockAPIClient.getProjectFiles as jest.Mock).mockResolvedValue(remoteFiles);

      await manager.syncOnce();

      const filePath = join(testDir, 'figure.pdf');
      expect(await fs.pathExists(filePath)).toBe(true);
    });
  });

  describe('start/stop', () => {
    it('should start and stop periodic sync', (done) => {
      const syncSpy = jest.spyOn(manager, 'syncOnce').mockResolvedValue();

      manager.start(100); // 100ms interval

      setTimeout(() => {
        expect(syncSpy).toHaveBeenCalled();
        manager.stop();
        done();
      }, 150);
    });
  });
});
