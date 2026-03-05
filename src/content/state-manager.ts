import type { AppState, SyncMode } from '../shared/types';

type StateChangeListener = (newValue: unknown, oldValue: unknown) => void;

export class StateManager {
  private state: AppState;
  private listeners: Map<string, Set<StateChangeListener>> = new Map();

  constructor() {
    this.state = this.getInitialState();
  }

  /**
   * Get initial state
   */
  private getInitialState(): AppState {
    return {
      connection: {
        bridge: 'disconnected',
        websocket: 'disconnected',
        lastError: null
      },
      sync: {
        mode: 'auto',
        status: 'idle',
        pendingChanges: 0,
        lastSyncTime: null,
        currentFile: null
      },
      terminal: {
        mode: 'local',
        sidebarVisible: false,
        popupWindowId: null
      },
      preferences: {
        syncMode: 'auto',
        terminalMode: 'local',
        autoSyncInterval: 3000
      }
    };
  }

  /**
   * Get current state
   */
  getState(): AppState {
    return { ...this.state };
  }

  /**
   * Update state
   */
  setState(updates: Partial<AppState>): void {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...updates };

    // Notify listeners
    this.notifyListeners(oldState, this.state);

    // Persist preferences
    this.persistState();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(key: string, callback: StateChangeListener): () => void {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(key)?.delete(callback);
    };
  }

  /**
   * Load state from chrome.storage
   */
  async load(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.get(['appState'], (result) => {
        if (result.appState) {
          const stored = result.appState as Partial<AppState>;

          // Merge preferences and terminal mode
          if (stored.preferences) {
            this.state.preferences = {
              ...this.state.preferences,
              ...stored.preferences
            };
          }

          if (stored.terminal?.mode) {
            this.state.terminal.mode = stored.terminal.mode;
          }

          // Set sync mode from preferences
          if (stored.preferences?.syncMode) {
            this.state.sync.mode = stored.preferences.syncMode;
          }
        }
        resolve();
      });
    });
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.state = this.getInitialState();
  }

  /**
   * Notify listeners of changes
   */
  private notifyListeners(oldState: AppState, newState: AppState): void {
    this.listeners.forEach((callbacks, key) => {
      const oldValue = this.getNestedValue(oldState, key);
      const newValue = this.getNestedValue(newState, key);

      if (oldValue !== newValue) {
        callbacks.forEach(callback => callback(newValue, oldValue));
      }
    });
  }

  /**
   * Persist state to chrome.storage
   */
  private persistState(): void {
    const toPersist = {
      appState: {
        preferences: this.state.preferences,
        terminal: {
          mode: this.state.terminal.mode
        }
      }
    };

    chrome.storage.local.set(toPersist);
  }

  /**
   * Get nested value from object by path
   */
  private getNestedValue(obj: any, path: string): unknown {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

// Export singleton
export const stateManager = new StateManager();
