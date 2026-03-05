import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager } from '../../src/content/sync-manager';
import type { SyncMode, SyncStatus } from '../../src/shared/types';
import { DiffUtils } from '../../src/shared/diff-utils';

// Mock bridge client
const mockBridgeClient = {
  sendMessage: vi.fn(),
  isConnected: vi.fn(() => false)
};

// Mock state manager
vi.mock('../../src/content/state-manager', () => ({
  stateManager: {
    getState: vi.fn(() => ({
      sync: { mode: 'auto' as SyncMode, status: 'idle' as SyncStatus, pendingChanges: 0 },
      connection: { bridge: 'disconnected' }
    })),
    setState: vi.fn(),
    subscribe: vi.fn()
  }
}));

import { stateManager } from '../../src/content/state-manager';

describe('SyncManager', () => {
  let syncManager: SyncManager;

  beforeEach(() => {
    vi.clearAllMocks();
    syncManager = new SyncManager(mockBridgeClient as any);
  });

  afterEach(() => {
    syncManager.destroy();
  });

  describe('initialization', () => {
    it('should initialize with default state', () => {
      expect(syncManager.isPolling()).toBe(false);
      expect(syncManager.getCurrentMode()).toBe('auto');
    });

    it('should not start polling automatically', () => {
      expect(syncManager.isPolling()).toBe(false);
    });
  });

  describe('connection status', () => {
    it('should update connection status from bridge', async () => {
      mockBridgeClient.isConnected.mockReturnValue(true);
      await syncManager.checkConnection();

      expect(stateManager.setState).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: expect.objectContaining({
            bridge: 'connected'
          })
        })
      );
    });

    it('should emit connection status changes', (done) => {
      syncManager.on('connection:changed', (status) => {
        expect(status).toBe('connected');
        done();
      });

      mockBridgeClient.isConnected.mockReturnValue(true);
      syncManager.checkConnection();
    });
  });

  describe('syncToOverleaf', () => {
    it('should send GET_FILE_STATUS for each file first', async () => {
      // Return null checksum (new file) for both
      mockBridgeClient.sendMessage.mockResolvedValue({
        type: 'FILE_STATUS',
        payload: { checksum: null, modifiedTime: Date.now() }
      });

      const files = [
        { path: '/main.tex', content: '\\documentclass{article}', checksum: 'abc123' },
        { path: '/references.bib', content: '@misc{test}', checksum: 'def456' }
      ];

      await syncManager.syncToOverleaf(files);

      // Should call GET_FILE_STATUS then SET_FILE_CONTENT for each file (4 total)
      expect(mockBridgeClient.sendMessage).toHaveBeenCalledTimes(4);
    });

    it('should send SET_FILE_CONTENT when file is new (no remote checksum)', async () => {
      // Mock FILE_STATUS returns null checksum (new file)
      mockBridgeClient.sendMessage.mockResolvedValue({
        type: 'FILE_STATUS',
        payload: { checksum: null, modifiedTime: Date.now() }
      });

      const files = [{ path: '/main.tex', content: '\\documentclass{article}', checksum: 'abc123' }];
      await syncManager.syncToOverleaf(files);

      // Should call GET_FILE_STATUS then SET_FILE_CONTENT
      expect(mockBridgeClient.sendMessage).toHaveBeenCalledTimes(2);
      expect(mockBridgeClient.sendMessage).toHaveBeenLastCalledWith({
        type: 'SET_FILE_CONTENT',
        payload: {
          path: '/main.tex',
          content: '\\documentclass{article}',
          source: 'claude'
        }
      });
    });

    it('should update sync status to syncing', async () => {
      mockBridgeClient.sendMessage.mockResolvedValue({ type: 'FILE_CONTENT' });
      vi.spyOn(syncManager, 'emit');

      const files = [{ path: '/test.tex', content: 'test', checksum: 'abc' }];
      await syncManager.syncToOverleaf(files);

      expect(stateManager.setState).toHaveBeenCalledWith(
        expect.objectContaining({
          sync: expect.objectContaining({
            status: 'syncing'
          })
        })
      );
    });

    it('should update sync status to synced after completion', async () => {
      mockBridgeClient.sendMessage.mockResolvedValue({ type: 'FILE_CONTENT' });

      const files = [{ path: '/test.tex', content: 'test', checksum: 'abc' }];
      await syncManager.syncToOverleaf(files);

      expect(stateManager.setState).toHaveBeenCalledWith(
        expect.objectContaining({
          sync: expect.objectContaining({
            status: 'synced'
          })
        })
      );
    });

    it('should detect conflicts when checksums differ', async () => {
      // Mock bridge to return different checksum and content (conflict)
      mockBridgeClient.sendMessage.mockResolvedValueOnce({
        type: 'FILE_STATUS',
        payload: { path: '/test.tex', checksum: 'different', modifiedTime: Date.now() }
      }).mockResolvedValueOnce({
        type: 'FILE_CONTENT',
        payload: { path: '/test.tex', content: 'remote content', checksum: 'different' }
      });

      const files = [{ path: '/test.tex', content: 'new content', checksum: 'abc' }];
      await syncManager.syncToOverleaf(files);

      // Should set status to conflict when real conflict is detected
      const setStateCalls = (stateManager.setState as any).mock.calls;
      const conflictCall = setStateCalls.find(call => call[0].sync.status === 'conflict');

      expect(conflictCall).toBeDefined();
    });

    it('should use diff when content is partially changed', async () => {
      mockBridgeClient.sendMessage.mockResolvedValueOnce({
        type: 'FILE_CONTENT',
        payload: { path: '/test.tex', content: 'old content', checksum: 'old' }
      }).mockResolvedValueOnce({
        type: 'FILE_CONTENT',
        payload: { path: '/test.tex', content: 'old content', checksum: 'old' }
      });

      const files = [{ path: '/test.tex', content: 'old content updated', checksum: 'new' }];
      await syncManager.syncToOverleaf(files);

      // Should send APPLY_DIFF after getting current content
      expect(mockBridgeClient.sendMessage).toHaveBeenCalled();
    });
  });

  describe('syncFromOverleaf', () => {
    it('should fetch all files from bridge', async () => {
      mockBridgeClient.isConnected.mockReturnValue(true);
      mockBridgeClient.sendMessage.mockResolvedValue({
        type: 'ALL_FILES',
        payload: [
          { path: '/main.tex', content: 'test', id: '1' }
        ]
      });

      await syncManager.syncFromOverleaf();

      expect(mockBridgeClient.sendMessage).toHaveBeenCalledWith({
        type: 'GET_ALL_FILES'
      });
    });

    it('should emit event when files are received', (done) => {
      mockBridgeClient.isConnected.mockReturnValue(true);
      mockBridgeClient.sendMessage.mockResolvedValue({
        type: 'ALL_FILES',
        payload: [{ path: '/main.tex', content: 'test', id: '1' }]
      });

      syncManager.on('files:received', (files) => {
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe('/main.tex');
        done();
      });

      syncManager.syncFromOverleaf();
    });
  });

  describe('polling', () => {
    it('should start polling when startPolling is called', () => {
      syncManager.startPolling();
      expect(syncManager.isPolling()).toBe(true);
    });

    it('should stop polling when stopPolling is called', () => {
      syncManager.startPolling();
      syncManager.stopPolling();
      expect(syncManager.isPolling()).toBe(false);
    });

    it('should poll at the configured interval', async () => {
      vi.useFakeTimers();
      syncManager.setPollingInterval(100);
      syncManager.startPolling();

      mockBridgeClient.isConnected.mockReturnValue(true);

      // Fast forward past first poll
      await vi.advanceTimersByTimeAsync(150);
      expect(mockBridgeClient.isConnected).toHaveBeenCalled();

      syncManager.stopPolling();
      vi.useRealTimers();
    });

    it('should not poll when in manual mode', async () => {
      vi.useFakeTimers();
      syncManager.setMode('manual');
      syncManager.startPolling();

      mockBridgeClient.isConnected.mockReturnValue(true);

      await vi.advanceTimersByTimeAsync(5000);

      // Should not have polled in manual mode
      expect(mockBridgeClient.isConnected).not.toHaveBeenCalled();

      syncManager.stopPolling();
      vi.useRealTimers();
    });
  });

  describe('mode switching', () => {
    it('should switch to manual mode', () => {
      syncManager.setMode('manual');
      expect(syncManager.getCurrentMode()).toBe('manual');
    });

    it('should stop polling when switching to manual mode', () => {
      syncManager.startPolling();
      syncManager.setMode('manual');
      expect(syncManager.isPolling()).toBe(false);
    });

    it('should start polling when switching to auto mode', () => {
      syncManager.setMode('manual');
      syncManager.setMode('auto');
      expect(syncManager.isPolling()).toBe(true);
    });
  });

  describe('task completion handling', () => {
    it('should trigger sync when TASK_COMPLETE event is received', async () => {
      mockBridgeClient.sendMessage.mockResolvedValue({
        type: 'ALL_FILES',
        payload: []
      });

      const taskCompleteMessage = {
        type: 'TASK_COMPLETE',
        payload: { taskId: 'task-1', modifiedFiles: ['/main.tex'] }
      };

      await syncManager.handleTaskCompletion(taskCompleteMessage);

      expect(mockBridgeClient.sendMessage).toHaveBeenCalledWith({
        type: 'GET_ALL_FILES'
      });
    });
  });

  describe('event emission', () => {
    it('should emit sync:started event', (done) => {
      syncManager.on('sync:started', () => {
        done();
      });

      mockBridgeClient.sendMessage.mockResolvedValue({ type: 'FILE_CONTENT' });
      syncManager.syncToOverleaf([{ path: '/test.tex', content: 'test', checksum: 'abc' }]);
    });

    it('should emit sync:completed event', (done) => {
      syncManager.on('sync:completed', () => {
        done();
      });

      mockBridgeClient.sendMessage.mockResolvedValue({ type: 'FILE_CONTENT' });
      syncManager.syncToOverleaf([{ path: '/test.tex', content: 'test', checksum: 'abc' }]);
    });

    it('should emit conflict:detected event', (done) => {
      syncManager.on('conflict:detected', (conflict) => {
        expect(conflict.path).toBe('/test.tex');
        done();
      });

      mockBridgeClient.sendMessage.mockResolvedValue({
        type: 'FILE_STATUS',
        payload: { path: '/test.tex', checksum: 'different', modifiedTime: Date.now() }
      });

      syncManager.syncToOverleaf([{ path: '/test.tex', content: 'new', checksum: 'abc' }]);
    });
  });

  describe('cleanup', () => {
    it('should stop polling and remove all listeners on destroy', () => {
      syncManager.startPolling();
      const listener = vi.fn();
      syncManager.on('sync:started', listener);

      syncManager.destroy();

      expect(syncManager.isPolling()).toBe(false);
      syncManager.emit('sync:started');
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
