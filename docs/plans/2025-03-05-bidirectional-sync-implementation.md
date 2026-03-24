# Bidirectional File Synchronization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement bidirectional file synchronization between Overleaf and local Claude Code environment with dual terminal support, conflict detection, and Git-based change tracking.

**Architecture:** Chrome extension content scripts monitor Overleaf DOM for changes and sync via WebSocket to local bridge CLI. Bridge uses Git for change tracking and detects Claude Code task completion for immediate sync. Mixed sync strategy: event-based for Overleaf→Local, polling + task-completion trigger for Local→Overleaf.

**Tech Stack:**
- Chrome Extension Manifest V3
- TypeScript
- xterm.js (terminal UI)
- fast-diff (diff computation)
- simple-git (change tracking in bridge)
- Vitest (testing)
- Playwright (E2E testing)

---

## Task 1: Setup Foundation - Type Definitions

**Files:**
- Create: `src/shared/types.ts` (extend existing)
- Test: N/A (type definitions)

**Step 1: Add new type definitions to `src/shared/types.ts`**

```typescript
// Add to existing types.ts

/**
 * Diff Patch structure for partial sync
 */
export interface DiffPatch {
  type: 'diff';
  checksum: string;
  timestamp: number;
  baseChecksum?: string;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'INSERT' | 'DELETE' | 'EQUAL';
  text: string;
  position: number;
}

/**
 * Sync status types
 */
export type SyncMode = 'auto' | 'manual';
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'pending' | 'conflict' | 'error';

/**
 * File information with metadata
 */
export interface FileInfoExtended {
  id: string;
  name: string;
  path: string;
  type?: string;
  checksum?: string;
  modifiedTime?: number;
}

/**
 * Conflict information
 */
export interface ConflictInfo {
  type: 'conflict';
  path: string;
  editorChecksum: string;
  localChecksum: string;
  lastSyncedChecksum: string;
  editorContent?: string;
  localContent?: string;
}

/**
 * Change record from Git
 */
export interface ChangeRecord {
  hash: string;
  date: string;
  message: string;
  filePath: string;
  source: 'overleaf' | 'claude';
}

/**
 * Application state
 */
export interface AppState {
  connection: {
    bridge: 'connected' | 'disconnected' | 'error';
    websocket: 'connected' | 'disconnected';
    lastError: string | null;
  };
  sync: {
    mode: SyncMode;
    status: SyncStatus;
    pendingChanges: number;
    lastSyncTime: number | null;
    currentFile: string | null;
  };
  terminal: {
    mode: 'local' | 'in-page';
    sidebarVisible: boolean;
    popupWindowId: number | null;
  };
  preferences: {
    syncMode: SyncMode;
    terminalMode: 'local' | 'in-page';
    autoSyncInterval: number;
  };
}

/**
 * WebSocket messages
 */
export type ExtensionToBridgeMessage =
  | { type: 'GET_FILE_CONTENT'; payload: { path: string } }
  | { type: 'SET_FILE_CONTENT'; payload: { path: string; content: string; source: 'overleaf' | 'claude' } }
  | { type: 'APPLY_DIFF'; payload: { path: string; diff: DiffPatch; source: string } }
  | { type: 'GET_FILE_STATUS'; payload: { path: string } }
  | { type: 'GET_ALL_FILES'; payload?: never }
  | { type: 'GET_HISTORY'; payload: { path: string; limit?: number } }
  | { type: 'PING'; payload?: never };

export type BridgeToExtensionMessage =
  | { type: 'FILE_CONTENT'; payload: { path: string; content: string; checksum: string } }
  | { type: 'FILE_STATUS'; payload: { path: string; checksum: string; modifiedTime: number } }
  | { type: 'ALL_FILES'; payload: FileInfoExtended[] }
  | { type: 'FILE_CHANGED'; payload: { path: string; checksum: string } }
  | { type: 'TASK_COMPLETE'; payload: { taskId: string; modifiedFiles: string[] } }
  | { type: 'CONFLICT_DETECTED'; payload: ConflictInfo }
  | { type: 'HISTORY'; payload: ChangeRecord[] }
  | { type: 'PONG'; payload?: never }
  | { type: 'ERROR'; payload: { message: string; code?: string } };

/**
 * Error handling types
 */
export interface ErrorRecord {
  id: string;
  message: string;
  stack?: string;
  context: ErrorContext;
  timestamp: number;
}

export interface ErrorContext {
  category: 'connection' | 'sync' | 'file' | 'unknown';
  operation: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details?: Record<string, unknown>;
}

/**
 * Notification types
 */
export interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  action: () => void;
}
```

**Step 2: Run TypeScript compiler to verify types**

Run: `npm run typecheck`

Expected: No type errors

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add comprehensive type definitions for sync system

Add types for:
- DiffPatch and DiffChange for partial sync
- AppState and sync status types
- WebSocket message types
- Error handling and notification types

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Implement Diff Utilities

**Files:**
- Create: `src/shared/diff-utils.ts`
- Test: `tests/unit/diff-utils.test.ts`

**Step 1: Create test file for diff utilities**

Create: `tests/unit/diff-utils.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { DiffUtils } from '../../src/shared/diff-utils';
import type { DiffPatch } from '../../src/shared/types';

describe('DiffUtils', () => {
  describe('computeDiff', () => {
    it('should detect insertions', () => {
      const oldContent = 'Hello';
      const newContent = 'Hello World';

      const diff = DiffUtils.computeDiff(oldContent, newContent);

      expect(diff.type).toBe('diff');
      expect(diff.checksum).toBeTruthy();
      expect(diff.changes.length).toBeGreaterThan(0);
      expect(diff.changes).toContainEqual({
        type: 'INSERT',
        text: ' World',
        position: 5
      });
    });

    it('should detect deletions', () => {
      const oldContent = 'Hello World';
      const newContent = 'Hello';

      const diff = DiffUtils.computeDiff(oldContent, newContent);

      expect(diff.changes).toContainEqual({
        type: 'DELETE',
        text: ' World',
        position: 5
      });
    });

    it('should handle multiple changes', () => {
      const oldContent = 'The quick brown fox';
      const newContent = 'The slow blue cat';

      const diff = DiffUtils.computeDiff(oldContent, newContent);

      const insertions = diff.changes.filter(c => c.type === 'INSERT');
      const deletions = diff.changes.filter(c => c.type === 'DELETE');

      expect(insertions.length).toBeGreaterThan(0);
      expect(deletions.length).toBeGreaterThan(0);
    });

    it('should generate checksum for new content', () => {
      const oldContent = 'Hello';
      const newContent = 'Hello World';

      const diff = DiffUtils.computeDiff(oldContent, newContent);

      expect(diff.checksum).toBe(DiffUtils.hashContent(newContent));
    });

    it('should handle empty content', () => {
      const diff = DiffUtils.computeDiff('', 'Hello');

      expect(diff.changes.length).toBeGreaterThan(0);
    });

    it('should handle identical content', () => {
      const content = 'Hello World';
      const diff = DiffUtils.computeDiff(content, content);

      expect(diff.changes.filter(c => c.type === 'EQUAL').length).toBe(1);
    });
  });

  describe('applyDiff', () => {
    it('should apply insertion diff', () => {
      const baseContent = 'Hello';
      const diff: DiffPatch = {
        type: 'diff',
        checksum: 'abc123',
        timestamp: Date.now(),
        changes: [
          { type: 'INSERT', text: ' World', position: 5 }
        ]
      };

      const result = DiffUtils.applyDiff(baseContent, diff);

      expect(result).toBe('Hello World');
    });

    it('should apply deletion diff', () => {
      const baseContent = 'Hello World';
      const diff: DiffPatch = {
        type: 'diff',
        checksum: 'abc123',
        timestamp: Date.now(),
        changes: [
          { type: 'DELETE', text: ' World', position: 5 }
        ]
      };

      const result = DiffUtils.applyDiff(baseContent, diff);

      expect(result).toBe('Hello');
    });

    it('should apply complex diff with multiple changes', () => {
      const baseContent = 'The quick brown fox';
      const diff: DiffPatch = {
        type: 'diff',
        checksum: 'abc123',
        timestamp: Date.now(),
        changes: [
          { type: 'DELETE', text: 'quick ', position: 4 },
          { type: 'INSERT', text: 'slow ', position: 4 },
          { type: 'DELETE', text: 'brown', position: 13 },
          { type: 'INSERT', text: 'blue', position: 13 }
        ]
      };

      const result = DiffUtils.applyDiff(baseContent, diff);

      expect(result).toBe('The slow blue fox');
    });

    it('should handle empty diff', () => {
      const baseContent = 'Hello';
      const diff: DiffPatch = {
        type: 'diff',
        checksum: DiffUtils.hashContent(baseContent),
        timestamp: Date.now(),
        changes: []
      };

      const result = DiffUtils.applyDiff(baseContent, diff);

      expect(result).toBe(baseContent);
    });
  });

  describe('hashContent', () => {
    it('should generate consistent hash for same content', () => {
      const content = 'Hello World';

      const hash1 = DiffUtils.hashContent(content);
      const hash2 = DiffUtils.hashContent(content);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different content', () => {
      const hash1 = DiffUtils.hashContent('Hello');
      const hash2 = DiffUtils.hashContent('World');

      expect(hash1).not.toBe(hash2);
    });

    it('should generate fixed-length hash', () => {
      const hash = DiffUtils.hashContent('Hello World');

      expect(hash).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it('should handle empty string', () => {
      const hash = DiffUtils.hashContent('');

      expect(hash).toHaveLength(64);
    });
  });

  describe('areContentsEqual', () => {
    it('should return true for identical content', () => {
      const content1 = 'Hello World';
      const content2 = 'Hello World';

      expect(DiffUtils.areContentsEqual(content1, content2)).toBe(true);
    });

    it('should return false for different content', () => {
      const content1 = 'Hello';
      const content2 = 'World';

      expect(DiffUtils.areContentsEqual(content1, content2)).toBe(false);
    });

    it('should handle empty strings', () => {
      expect(DiffUtils.areContentsEqual('', '')).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- diff-utils`

Expected: FAIL with "Cannot find module '../../src/shared/diff-utils'"

**Step 3: Install fast-diff dependency**

Run: `npm install fast-diff`

Run: `npm install -D @types/fast-diff`

**Step 4: Implement DiffUtils**

Create: `src/shared/diff-utils.ts`

```typescript
import fastDiff from 'fast-diff';
import type { DiffPatch, DiffChange } from './types';
import { createHash } from 'crypto';

export class DiffUtils {
  /**
   * Compute diff between two strings
   */
  static computeDiff(oldContent: string, newContent: string): DiffPatch {
    // Use fast-diff to compute character-level diff
    const rawDiff = fastDiff(oldContent, newContent);

    // Convert to our DiffChange format
    const changes: DiffChange[] = [];
    let position = 0;

    for (const [type, text] of rawDiff) {
      if (type !== 0) { // Skip EQUAL (type 0)
        changes.push({
          type: type === 1 ? 'INSERT' : 'DELETE',
          text,
          position
        });
      }
      position += text.length;
    }

    return {
      type: 'diff',
      checksum: this.hashContent(newContent),
      timestamp: Date.now(),
      changes
    };
  }

  /**
   * Apply diff to base content
   */
  static applyDiff(baseContent: string, patch: DiffPatch): string {
    let result = baseContent;
    let offset = 0;

    for (const change of patch.changes) {
      const position = change.position + offset;

      if (change.type === 'INSERT') {
        result = result.slice(0, position) + change.text + result.slice(position);
        offset += change.text.length;
      } else if (change.type === 'DELETE') {
        result = result.slice(0, position) + result.slice(position + change.text.length);
        offset -= change.text.length;
      }
    }

    return result;
  }

  /**
   * Generate SHA-256 hash of content
   */
  static hashContent(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Compare two contents using their hashes
   */
  static areContentsEqual(content1: string, content2: string): boolean {
    return this.hashContent(content1) === this.hashContent(content2);
  }
}
```

**Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- diff-utils`

Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/shared/diff-utils.ts tests/unit/diff-utils.test.ts package.json package-lock.json
git commit -m "feat: implement diff utilities for partial sync

Add fast-diff-based DiffUtils class:
- computeDiff: Calculate changes between strings
- applyDiff: Apply changes to base content
- hashContent: Generate SHA-256 checksum
- areContentsEqual: Compare contents via hash

Tests cover:
- Insertion and deletion detection
- Multiple changes handling
- Edge cases (empty, identical content)
- Hash consistency

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Implement State Manager

**Files:**
- Create: `src/content/state-manager.ts`
- Test: `tests/unit/state-manager.test.ts`

**Step 1: Create state manager tests**

Create: `tests/unit/state-manager.test.ts`

```typescript
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
        }),
        expect.any(Function)
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
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- state-manager`

Expected: FAIL with "Cannot find module '../../src/content/state-manager'"

**Step 3: Implement StateManager**

Create: `src/content/state-manager.ts`

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- state-manager`

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/content/state-manager.ts tests/unit/state-manager.test.ts
git commit -m "feat: implement global state manager

Add StateManager class with:
- State get/set with nested path support
- Subscription system for state changes
- Chrome storage persistence
- Load/reset functionality

Tests cover:
- State updates and notifications
- Subscription/unsubscription
- Multiple subscribers
- Chrome storage integration
- Connection status reset on load

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Implement Error Handler

**Files:**
- Create: `src/content/error-handler.ts`
- Test: `tests/unit/error-handler.test.ts`

**Step 1: Create error handler tests**

Create: `tests/unit/error-handler.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorHandler } from '../../src/content/error-handler';
import { stateManager } from '../../src/content/state-manager';
import type { ErrorContext, ErrorRecord } from '../../src/shared/types';

// Mock stateManager
vi.mock('../../src/content/state-manager', () => ({
  stateManager: {
    setState: vi.fn()
  }
}));

// Mock notification system
const mockShowNotification = vi.fn();

describe('ErrorHandler', () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler();
    vi.clearAllMocks();
  });

  describe('handleError', () => {
    it('should handle string errors', () => {
      const context: ErrorContext = {
        category: 'sync',
        operation: 'test',
        severity: 'low'
      };

      errorHandler.handleError('Test error', context);

      const errors = errorHandler.getErrors();
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe('Test error');
    });

    it('should handle Error objects', () => {
      const context: ErrorContext = {
        category: 'sync',
        operation: 'test',
        severity: 'medium'
      };

      const error = new Error('Test error');
      errorHandler.handleError(error, context);

      const errors = errorHandler.getErrors();
      expect(errors[0].message).toBe('Test error');
      expect(errors[0].stack).toBeTruthy();
    });

    it('should update state manager on connection error', () => {
      const context: ErrorContext = {
        category: 'connection',
        operation: 'connect',
        severity: 'high'
      };

      errorHandler.handleError('Connection failed', context);

      expect(stateManager.setState).toHaveBeenCalledWith(
        expect.objectContaining({
          connection: expect.objectContaining({
            bridge: 'error',
            lastError: 'Connection failed'
          })
        })
      );
    });

    it('should update state manager on sync error', () => {
      const context: ErrorContext = {
        category: 'sync',
        operation: 'syncToOverleaf',
        severity: 'medium'
      };

      errorHandler.handleError('Sync failed', context);

      expect(stateManager.setState).toHaveBeenCalledWith(
        expect.objectContaining({
          sync: expect.objectContaining({
            status: 'error'
          })
        })
      );
    });
  });

  describe('getErrors', () => {
    it('should return all errors by default', () => {
      const context: ErrorContext = {
        category: 'sync',
        operation: 'test',
        severity: 'low'
      };

      errorHandler.handleError('Error 1', context);
      errorHandler.handleError('Error 2', context);

      const errors = errorHandler.getErrors();
      expect(errors).toHaveLength(2);
    });

    it('should respect limit parameter', () => {
      const context: ErrorContext = {
        category: 'sync',
        operation: 'test',
        severity: 'low'
      };

      for (let i = 0; i < 10; i++) {
        errorHandler.handleError(`Error ${i}`, context);
      }

      const errors = errorHandler.getErrors(5);
      expect(errors).toHaveLength(5);
    });
  });

  describe('clearErrors', () => {
    it('should clear all errors', () => {
      const context: ErrorContext = {
        category: 'sync',
        operation: 'test',
        severity: 'low'
      };

      errorHandler.handleError('Error', context);
      expect(errorHandler.getErrors()).toHaveLength(1);

      errorHandler.clearErrors();
      expect(errorHandler.getErrors()).toHaveLength(0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- error-handler`

Expected: FAIL with "Cannot find module '../../src/content/error-handler'"

**Step 3: Implement ErrorHandler**

Create: `src/content/error-handler.ts`

```typescript
import { v4 as uuidv4 } from 'uuid';
import type { ErrorRecord, ErrorContext } from '../shared/types';
import { stateManager } from './state-manager';

export class ErrorHandler {
  private errorLog: ErrorRecord[] = [];
  private maxLogSize = 100;

  /**
   * Handle an error
   */
  handleError(error: Error | string, context: ErrorContext): void {
    const errorRecord: ErrorRecord = {
      id: uuidv4(),
      message: typeof error === 'string' ? error : error.message,
      stack: typeof error === 'string' ? undefined : error.stack,
      context,
      timestamp: Date.now()
    };

    // Log error
    this.logError(errorRecord);

    // Dispatch based on error type
    this.dispatchError(errorRecord);
  }

  /**
   * Log error to internal log
   */
  private logError(record: ErrorRecord): void {
    this.errorLog.push(record);

    // Limit log size
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }

    // Also log to console
    console.error(`[ErrorHandler] ${record.context.category}:`, record.message, record.context);
  }

  /**
   * Dispatch error handling based on category
   */
  private dispatchError(record: ErrorRecord): void {
    const { category } = record.context;

    switch (category) {
      case 'connection':
        this.handleConnectionError(record);
        break;

      case 'sync':
        this.handleSyncError(record);
        break;

      case 'file':
        this.handleFileError(record);
        break;

      default:
        this.handleGenericError(record);
    }
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(record: ErrorRecord): void {
    stateManager.setState({
      connection: {
        bridge: 'error',
        websocket: 'disconnected',
        lastError: record.message
      }
    });

    // TODO: Show notification to user (will be implemented with notification system)
    console.warn('Connection error:', record.message);
  }

  /**
   * Handle sync errors
   */
  private handleSyncError(record: ErrorRecord): void {
    stateManager.setState({
      sync: {
        ...stateManager.getState().sync,
        status: 'error'
      }
    });

    console.error('Sync error:', record.message);
  }

  /**
   * Handle file operation errors
   */
  private handleFileError(record: ErrorRecord): void {
    console.error('File operation error:', record.message);
  }

  /**
   * Handle generic errors
   */
  private handleGenericError(record: ErrorRecord): void {
    console.error('Error:', record.message);
  }

  /**
   * Get error log
   */
  getErrors(limit?: number): ErrorRecord[] {
    return limit ? this.errorLog.slice(-limit) : [...this.errorLog];
  }

  /**
   * Clear error log
   */
  clearErrors(): void {
    this.errorLog = [];
  }
}

// Export singleton
export const errorHandler = new ErrorHandler();
```

**Step 4: Install uuid dependency**

Run: `npm install uuid`

Run: `npm install -D @types/uuid`

**Step 5: Run tests to verify they pass**

Run: `npm run test:unit -- error-handler`

Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/content/error-handler.ts tests/unit/error-handler.test.ts package.json package-lock.json
git commit -m "feat: implement error handling system

Add ErrorHandler class with:
- Error logging with max size limit
- Category-based error dispatching
- State manager integration
- Error retrieval and clearing

Supports error types:
- Connection errors (update connection state)
- Sync errors (update sync status)
- File errors (log only)
- Generic errors (log only)

Tests cover:
- String and Error object handling
- State updates for different error types
- Error log management
- Limit and clear operations

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Implement Notification System

**Files:**
- Create: `src/content/notification.ts`
- Create: `src/styles/notifications.css`

**Step 1: Implement notification system**

Create: `src/content/notification.ts`

```typescript
export interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  action: () => void;
}

export class NotificationSystem {
  private container: HTMLElement | null = null;

  /**
   * Show notification
   */
  show(notification: Notification): void {
    this.ensureContainer();
    const element = this.createElement(notification);
    this.container!.appendChild(element);

    // Auto-hide after duration
    if (notification.duration) {
      setTimeout(() => {
        this.hide(element);
      }, notification.duration);
    }

    // Animate in
    requestAnimationFrame(() => {
      element.classList.add('show');
    });
  }

  /**
   * Ensure container exists
   */
  private ensureContainer(): void {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'claude-notifications';
      this.container.className = 'claude-notification-container';
      document.body.appendChild(this.container);
    }
  }

  /**
   * Create notification element
   */
  private createElement(notification: Notification): HTMLElement {
    const element = document.createElement('div');
    element.className = `claude-notification claude-notification-${notification.type}`;

    const styles: Record<string, { bg: string; icon: string }> = {
      info: { bg: '#3794ff', icon: 'ℹ️' },
      success: { bg: '#73c991', icon: '✓' },
      warning: { bg: '#ffc107', icon: '⚠️' },
      error: { bg: '#f14c4c', icon: '✕' }
    };

    const style = styles[notification.type];

    element.innerHTML = `
      <div class="notification-icon" style="background: ${style.bg}">
        ${style.icon}
      </div>
      <div class="notification-content">
        <div class="notification-title">${this.escapeHtml(notification.title)}</div>
        ${notification.message ? `<div class="notification-message">${this.escapeHtml(notification.message)}</div>` : ''}
        ${notification.actions ? this.renderActions(notification.actions) : ''}
      </div>
      <button class="notification-close" aria-label="Close">×</button>
    `;

    // Bind close button
    element.querySelector('.notification-close')?.addEventListener('click', () => {
      this.hide(element);
    });

    // Bind action buttons
    notification.actions?.forEach(action => {
      element.querySelector(`[data-action="${this.escapeHtml(action.label)}"]`)?.addEventListener('click', () => {
        action.action();
        this.hide(element);
      });
    });

    return element;
  }

  /**
   * Render action buttons
   */
  private renderActions(actions: NotificationAction[]): string {
    return `
      <div class="notification-actions">
        ${actions.map(action => `
          <button data-action="${this.escapeHtml(action.label)}" class="notification-action-btn">
            ${this.escapeHtml(action.label)}
          </button>
        `).join('')}
      </div>
    `;
  }

  /**
   * Hide notification
   */
  private hide(element: HTMLElement): void {
    element.classList.remove('show');
    element.classList.add('hide');

    setTimeout(() => {
      element.remove();
    }, 300);
  }

  /**
   * Clear all notifications
   */
  clearAll(): void {
    this.container?.remove();
    this.container = null;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Export singleton
export const notificationSystem = new NotificationSystem();

// Convenience function
export const showNotification = (notification: Notification) => {
  notificationSystem.show(notification);
};
```

**Step 2: Create notification styles**

Create: `src/styles/notifications.css`

```css
.claude-notification-container {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 99999;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  pointer-events: none;
}

.claude-notification {
  display: flex;
  gap: 12px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 16px;
  min-width: 320px;
  transform: translateX(120%);
  transition: transform 0.3s ease, opacity 0.3s ease;
  opacity: 0;
  pointer-events: auto;
}

.claude-notification.show {
  transform: translateX(0);
  opacity: 1;
}

.claude-notification.hide {
  transform: translateX(120%);
  opacity: 0;
}

.notification-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: white;
  flex-shrink: 0;
}

.notification-content {
  flex: 1;
}

.notification-title {
  font-weight: 600;
  margin-bottom: 4px;
  color: #1f1f1f;
}

.notification-message {
  font-size: 14px;
  color: #666;
  line-height: 1.4;
}

.notification-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.notification-action-btn {
  padding: 6px 12px;
  border: 1px solid #e5e5e5;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.notification-action-btn:hover {
  background: #f5f5f5;
  border-color: #d5d5d5;
}

.notification-close {
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 18px;
  color: #999;
  transition: color 0.2s ease;
  flex-shrink: 0;
}

.notification-close:hover {
  color: #333;
}
```

**Step 3: Inject styles in content script**

Create: `src/content/styles.ts`

```typescript
/**
 * Inject CSS styles into page
 */
export function injectStyles(css: string): void {
  const styleElement = document.createElement('style');
  styleElement.textContent = css;
  document.head.appendChild(styleElement);
}

/**
 * Load and inject notification styles
 */
export async function injectNotificationStyles(): Promise<void> {
  try {
    const response = await fetch(chrome.runtime.getURL('src/styles/notifications.css'));
    const css = await response.text();
    injectStyles(css);
  } catch (error) {
    console.error('[Styles] Failed to load notification styles:', error);
  }
}
```

**Step 4: Update vite.config to include styles in build**

Read: `vite.config.ts`

```typescript
// Add to existing vite.config.ts
// Ensure styles are copied to dist
```

**Step 5: Commit**

```bash
git add src/content/notification.ts src/content/styles.ts src/styles/notifications.css
git commit -m "feat: implement notification system

Add NotificationSystem class with:
- Toast-style notifications
- Auto-hide with configurable duration
- Multiple notification types (info/success/warning/error)
- Action buttons support
- XSS prevention via HTML escaping

Features:
- Fixed position container (top-right)
- Slide-in/out animations
- Multiple concurrent notifications
- Click-to-close

Styles include:
- Color-coded notification types
- Smooth animations
- Responsive button interactions

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

This completes Phase 1 (Foundation) of the implementation plan. The remaining phases will be added in the next continuation. Would you like me to:

1. Continue with Phase 2 (Dropdown Menu UI) and Phase 3 (File Synchronization)?
2. Start implementing Phase 1 tasks now?
3. Review and adjust the current plan first?

Please let me know how you'd like to proceed.
