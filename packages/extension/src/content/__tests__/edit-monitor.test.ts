import '@jest/globals';
import { EditMonitor } from '../edit-monitor';
import { MirrorClient } from '../../client';

// Mock MirrorClient
jest.mock('../../client');

describe('EditMonitor', () => {
  let editMonitor: EditMonitor;
  let mockMirrorClient: jest.Mocked<MirrorClient>;

  beforeEach(() => {
    mockMirrorClient = {
      send: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn()
    } as any;

    editMonitor = new EditMonitor('test-project', mockMirrorClient);
  });

  afterEach(() => {
    editMonitor.stop();
  });

  describe('convertChangesToOps', () => {
    it('should convert insert operation', () => {
      const mockChanges = {
        iterChanges: jest.fn((callback) => {
          callback(5, 5, 5, 10, { toString: () => 'Hello' });
        })
      };

      const mockStartState = {
        sliceDoc: jest.fn(() => '')
      };

      const ops = editMonitor['convertChangesToOps'](mockChanges as any, mockStartState as any);

      expect(ops).toEqual([{ p: 5, i: 'Hello' }]);
    });

    it('should convert delete operation', () => {
      const mockChanges = {
        iterChanges: jest.fn((callback) => {
          callback(5, 10, 5, 5, { toString: () => '' });
        })
      };

      const mockStartState = {
        sliceDoc: jest.fn((from: number, to: number) => 'World')
      };

      const ops = editMonitor['convertChangesToOps'](mockChanges as any, mockStartState as any);

      expect(ops).toEqual([{ p: 5, d: 'World' }]);
    });

    it('should handle multiple changes with position offset', () => {
      const mockChanges = {
        iterChanges: jest.fn((callback) => {
          // Delete "World" (5 chars) from position 5
          callback(5, 10, 5, 5, { toString: () => '' });
          // Insert "CodeMirror" (11 chars) at position 5 (after deletion in new doc)
          callback(5, 5, 5, 16, { toString: () => 'CodeMirror' });
        })
      };

      const mockStartState = {
        sliceDoc: jest.fn((from: number, to: number) => {
          if (from === 5 && to === 10) return 'World';
          return '';
        })
      };

      const ops = editMonitor['convertChangesToOps'](mockChanges as any, mockStartState as any);

      // After deleting 5 chars at position 5, positionOffset = -5
      // Insert at fromB=5, so p = 5 + (-5) = 0
      expect(ops).toEqual([
        { p: 5, d: 'World' },
        { p: 0, i: 'CodeMirror' }
      ]);
    });

    it('should handle empty changes', () => {
      const mockChanges = {
        iterChanges: jest.fn(() => {})
      };

      const mockStartState = {
        sliceDoc: jest.fn(() => '')
      };

      const ops = editMonitor['convertChangesToOps'](mockChanges as any, mockStartState as any);

      expect(ops).toEqual([]);
    });
  });

  describe('validateEditorView', () => {
    it('should validate valid EditorView', () => {
      const mockView = {
        state: {
          doc: {
            toString: () => 'test'
          }
        },
        dispatch: () => {}
      };

      expect(editMonitor['validateEditorView'](mockView)).toBe(true);
    });

    it('should reject null', () => {
      expect(editMonitor['validateEditorView'](null)).toBeFalsy();
    });

    it('should reject object without state', () => {
      expect(editMonitor['validateEditorView']({})).toBe(false);
    });

    it('should reject object without dispatch', () => {
      const mockView = {
        state: {
          doc: {
            toString: () => 'test'
          }
        }
      };

      expect(editMonitor['validateEditorView'](mockView)).toBe(false);
    });
  });

  describe('getExtension', () => {
    it('should extract extension from filename', () => {
      expect(editMonitor['getExtension']('document.tex')).toBe('.tex');
      expect(editMonitor['getExtension']('main.bib')).toBe('.bib');
      expect(editMonitor['getExtension']('file.name.with.dots.txt')).toBe('.txt');
    });

    it('should return empty string for filename without extension', () => {
      expect(editMonitor['getExtension']('README')).toBe('');
      expect(editMonitor['getExtension']('')).toBe('');
    });
  });

  describe('calculateDiffOps', () => {
    it('should detect insert at end', () => {
      const ops = editMonitor['calculateDiffOps']('Hello', 'Hello World');
      expect(ops).toEqual([{ p: 5, i: ' World' }]);
    });

    it('should detect delete at end', () => {
      const ops = editMonitor['calculateDiffOps']('Hello World', 'Hello');
      expect(ops).toEqual([{ p: 5, d: ' World' }]);
    });

    it('should detect replace', () => {
      const ops = editMonitor['calculateDiffOps']('Hello World', 'Hello CodeMirror');
      expect(ops).toEqual([
        { p: 6, d: 'World' },
        { p: 6, i: 'CodeMirror' }
      ]);
    });

    it('should return empty ops for identical text', () => {
      const ops = editMonitor['calculateDiffOps']('Hello', 'Hello');
      expect(ops).toEqual([]);
    });
  });
});
