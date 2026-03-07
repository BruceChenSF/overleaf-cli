import fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { ProjectConfigStore } from './store';
import { ProjectConfig } from './types';

describe('ProjectConfigStore', () => {
  const testDir = join(tmpdir(), 'overleaf-mirror-config-test');
  let store: ProjectConfigStore;

  beforeEach(async () => {
    await fs.ensureDir(testDir);
    store = new ProjectConfigStore(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('getProjectConfig', () => {
    it('should create default config for new project', () => {
      const config = store.getProjectConfig('new-project-id');

      expect(config.projectId).toBe('new-project-id');
      expect(config.localPath).toContain('new-project-id');
      expect(config.syncBinaryFiles).toBe(false);
      expect(config.createdAt).toBeGreaterThan(0);
    });

    it('should return existing config if present', async () => {
      const customPath = '/custom/path';
      await store.setProjectPath('existing-project', customPath);

      const config = store.getProjectConfig('existing-project');

      expect(config.localPath).toBe(customPath);
    });
  });

  describe('setProjectPath', () => {
    it('should set custom path for project', async () => {
      const customPath = '/my/custom/path';

      await store.setProjectPath('project-123', customPath);
      const config = store.getProjectConfig('project-123');

      expect(config.localPath).toBe(customPath);
    });

    it('should persist to disk', async () => {
      const customPath = '/persistent/path';

      await store.setProjectPath('project-456', customPath);

      // Create new store instance to test persistence
      const newStore = new ProjectConfigStore(testDir);
      const config = newStore.getProjectConfig('project-456');

      expect(config.localPath).toBe(customPath);
    });
  });

  describe('updateLastSync', () => {
    it('should update last sync timestamp', async () => {
      await store.setProjectPath('project-789', '/path');

      const before = Date.now();
      await store.updateLastSync('project-789');
      const after = Date.now();

      const config = store.getProjectConfig('project-789');

      expect(config.lastSyncAt).toBeGreaterThanOrEqual(before);
      expect(config.lastSyncAt).toBeLessThanOrEqual(after);
    });
  });

  describe('listProjects', () => {
    it('should return empty array initially', () => {
      const projects = store.listProjects();
      expect(projects).toEqual([]);
    });

    it('should return all configured projects', async () => {
      await store.setProjectPath('project-1', '/path1');
      await store.setProjectPath('project-2', '/path2');

      const projects = store.listProjects();

      expect(projects).toHaveLength(2);
      expect(projects[0].projectId).toBe('project-1');
      expect(projects[1].projectId).toBe('project-2');
    });
  });
});
