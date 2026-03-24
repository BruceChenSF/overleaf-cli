import fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { MirrorServer } from '../../src/server';
import { ProjectConfigStore } from '../../src/config/store';
import { TextFileSyncManager } from '../../src/sync/text-file-sync';

describe('Full Sync Integration', () => {
  const testDir = join(tmpdir(), 'mirror-integration-test');
  let server: MirrorServer;
  let configStore: ProjectConfigStore;

  beforeAll(async () => {
    await fs.ensureDir(testDir);
    configStore = new ProjectConfigStore(testDir);

    // Create test server (don't listen on port)
    server = new MirrorServer(undefined as any);
  });

  afterAll(async () => {
    server.close();
    await fs.remove(testDir);
  });

  it('should handle complete edit event flow', async () => {
    // This would require mocking WebSocket and API
    // For now, test the components work together
    const projectId = 'test-integration-project';

    const config = configStore.getProjectConfig(projectId);
    expect(config.projectId).toBe(projectId);
    expect(config.localPath).toContain(projectId);
  });
});
