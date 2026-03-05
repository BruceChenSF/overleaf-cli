import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateManager } from '../../src/content/state-manager';
import type { AppState, SyncMode } from '../../src/shared/types';

// Mock chrome.storage.local
const mockStorage = {
  data: {} as Record<string, unknown>,
  get: vi.fn(function(this: typeof mockStorage, keys: string | string[], callback?: (items: Record<string, unknown>) => void) {
    const result: Record<string, unknown> = {};
    const keysArray = Array.isArray(keys) ? keys : [keys];

    for (const key of keysArray) {
      if (key in this.data) {
        result[key] = this.data[key];
      }
    }

    if (callback) {
      callback(result);
    }
    return Promise.resolve(result);
  }),
  set: vi.fn(function(this: typeof mockStorage, items: Record<string, unknown>, callback?: () => void) {
    Object.assign(this.data, items);
    if (callback) callback();
    return Promise.resolve();
  })
};

(global as any).chrome = {
  storage: {
    local: mockStorage
  }
};

describe('StateManager', () => {
  let stateManager: StateManager;

  beforeEach(() => {
    stateManager = new StateManager();
    mockStorage.data = {};
    vi.clearAllMocks();
  });

  describe('getState', () => {
    it('should return current state', () => {
      const state = stateManager.getState();

      expect(state).toHaveProperty('connection');
      expect(state).toHaveProperty('sync');
      expect(state).toHaveProperty('terminal');
      expect(state).toHaveProperty('preferences');
    });

    it('should return a copy of state (not reference)', () => {
      const state1 = stateManager.getState();
      const state2 = stateManager.getState();

      expect(state1).not.toBe(state2);
    });
  });

  describe('setState', () => {
    it('should update partial state', () => {
      const updates: Partial<AppState> = {
        sync: {
          ...stateManager.getState().sync,
          mode: 'manual' as SyncMode
        }
      };

      stateManager.setState(updates);
      const newState = stateManager.getState();

      expect(newState.sync.mode).toBe('manual');
    });

    it('should notify subscribers on change', () => {
      const callback = vi.fn();
      stateManager.subscribe('sync.mode', callback);

      stateManager.setState({
        sync: {
          ...stateManager.getState().sync,
          mode: 'manual'
        }
      });

      expect(callback).toHaveBeenCalledWith('manual', 'auto');
    });

    it('should persist to chrome.storage', async () => {
      await stateManager.setState({
        preferences: {
          ...stateManager.getState().preferences,
          syncMode: 'manual'
        }
      });

      expect(mockStorage.set).toHaveBeenCalledWith(
        expect.objectContaining({
          appState: expect.objectContaining({
            preferences: expect.objectContaining({
              syncMode: 'manual'
            })
          })
        })
      );
    });
  });

  describe('subscribe', () => {
    it('should register callback for state key', () => {
      const callback = vi.fn();
      stateManager.subscribe('sync.mode', callback);

      stateManager.setState({
        sync: {
          ...stateManager.getState().sync,
          mode: 'manual'
        }
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = stateManager.subscribe('sync.mode', callback);

      unsubscribe();

      stateManager.setState({
        sync: {
          ...stateManager.getState().sync,
          mode: 'manual'
        }
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should support multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      stateManager.subscribe('sync.mode', callback1);
      stateManager.subscribe('sync.mode', callback2);

      stateManager.setState({
        sync: {
          ...stateManager.getState().sync,
          mode: 'manual'
        }
      });

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('load', () => {
    it('should load state from chrome.storage', async () => {
      mockStorage.data = {
        appState: {
          preferences: {
            syncMode: 'manual',
            terminalMode: 'in-page',
            autoSyncInterval: 5000
          },
          terminal: {
            mode: 'in-page'
          }
        }
      };

      await stateManager.load();

      const state = stateManager.getState();
      expect(state.preferences.syncMode).toBe('manual');
      expect(state.preferences.terminalMode).toBe('in-page');
      expect(state.preferences.autoSyncInterval).toBe(5000);
    });

    it('should reset connection status on load', async () => {
      mockStorage.data = {
        appState: {
          connection: {
            bridge: 'connected',
            websocket: 'connected',
            lastError: null
          }
        }
      };

      await stateManager.load();

      const state = stateManager.getState();
      expect(state.connection.bridge).toBe('disconnected');
      expect(state.connection.websocket).toBe('disconnected');
    });
  });
});
