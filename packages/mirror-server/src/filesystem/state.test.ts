import fs from 'fs-extra';
import { tmpdir } from 'os';
import { join } from 'path';
import { StateManager } from './state';

describe('StateManager', () => {
  const testDir = join(tmpdir(), 'overleaf-mirror-test');

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  it('should create initial state file', async () => {
    const manager = new StateManager(testDir, 'test-project');
    await manager.initialize();

    const state = await manager.load();
    expect(state.projectId).toBe('test-project');
    expect(state.localVersion).toEqual({});
    expect(state.remoteVersion).toEqual({});
    expect(state.pendingSync).toEqual([]);
  });

  it('should save and load state', async () => {
    const manager = new StateManager(testDir, 'test-project');
    await manager.initialize();

    await manager.updateLocalVersion('main.tex', 'v3');
    await manager.updateRemoteVersion('main.tex', 'v3');

    const state = await manager.load();
    expect(state.localVersion['main.tex']).toBe('v3');
    expect(state.remoteVersion['main.tex']).toBe('v3');
  });

  it('should detect version conflicts', async () => {
    const manager = new StateManager(testDir, 'test-project');
    await manager.initialize();

    await manager.updateLocalVersion('main.tex', 'v3');
    await manager.updateRemoteVersion('main.tex', 'v4');

    const hasConflict = await manager.hasConflict('main.tex');
    expect(hasConflict).toBe(true);
  });

  it('should add pending sync task', async () => {
    const manager = new StateManager(testDir, 'test-project');
    await manager.initialize();

    await manager.addPendingSync({
      operation: 'update',
      path: 'main.tex',
      content: 'new content',
      attempts: 0,
      lastAttempt: Date.now(),
    });

    const state = await manager.load();
    expect(state.pendingSync).toHaveLength(1);
    expect(state.pendingSync[0].path).toBe('main.tex');
  });
});
