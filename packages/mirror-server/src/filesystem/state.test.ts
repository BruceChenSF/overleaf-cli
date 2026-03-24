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

  it('should handle corrupted state file gracefully', async () => {
    // First, create a valid state file
    const stateFilePath = join(testDir, '.overleaf-state.json');
    await fs.writeFile(stateFilePath, JSON.stringify({
      projectId: 'test-project',
      lastSync: Date.now(),
      localVersion: {},
      remoteVersion: {},
      pendingSync: [],
    }), 'utf-8');

    // Now corrupt it with invalid JSON
    await fs.writeFile(stateFilePath, 'invalid json content {', 'utf-8');

    // Create a new manager instance (no state loaded in memory)
    const manager = new StateManager(testDir, 'test-project');

    // Should throw a descriptive error when trying to initialize
    await expect(manager.initialize()).rejects.toThrow(
      /Failed to load state from.*\.overleaf-state\.json/
    );
  });

  it('should prevent race condition in initialize', async () => {
    const manager = new StateManager(testDir, 'test-project');

    // Call initialize multiple times concurrently
    await Promise.all([
      manager.initialize(),
      manager.initialize(),
      manager.initialize(),
    ]);

    // Should still work correctly
    const state = await manager.load();
    expect(state.projectId).toBe('test-project');
    expect(state.localVersion).toEqual({});
  });

  it('should auto-initialize when calling update methods', async () => {
    const manager = new StateManager(testDir, 'test-project');

    // Don't call initialize explicitly
    await manager.updateLocalVersion('main.tex', 'v1');

    const state = await manager.load();
    expect(state.localVersion['main.tex']).toBe('v1');
  });

  it('should auto-initialize when calling get methods', async () => {
    const manager = new StateManager(testDir, 'test-project');

    // Don't call initialize explicitly
    const version = await manager.getLocalVersion('main.tex');

    expect(version).toBeUndefined();
  });

  it('should auto-initialize when calling hasConflict', async () => {
    const manager = new StateManager(testDir, 'test-project');

    // Don't call initialize explicitly
    const hasConflict = await manager.hasConflict('main.tex');

    expect(hasConflict).toBe(false);
  });

  it('should auto-initialize when calling addPendingSync', async () => {
    const manager = new StateManager(testDir, 'test-project');

    // Don't call initialize explicitly
    await manager.addPendingSync({
      operation: 'update',
      path: 'main.tex',
      content: 'content',
      attempts: 0,
      lastAttempt: Date.now(),
    });

    const state = await manager.load();
    expect(state.pendingSync).toHaveLength(1);
  });
});
