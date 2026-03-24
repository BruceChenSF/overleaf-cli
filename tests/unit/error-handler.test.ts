import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorHandler } from '../../src/content/error-handler';
import type { ErrorContext, ErrorRecord } from '../../src/shared/types';

// Mock stateManager
const mockState = {
  connection: { bridge: 'disconnected' as const, websocket: 'disconnected' as const, lastError: null },
  sync: { mode: 'auto' as const, status: 'idle' as const, pendingChanges: 0, lastSyncTime: null, currentFile: null },
  terminal: { mode: 'local' as const, sidebarVisible: false, popupWindowId: null },
  preferences: { syncMode: 'auto' as const, terminalMode: 'local' as const, autoSyncInterval: 3000 }
};

vi.mock('../../src/content/state-manager', () => ({
  stateManager: {
    setState: vi.fn(),
    getState: vi.fn(() => mockState)
  }
}));

// Import after mocking
import { stateManager } from '../../src/content/state-manager';

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
