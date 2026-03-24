import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OverleafWebSocketClient } from '../src/content/overleaf-websocket';

describe('OverleafWebSocketClient - File Deletion', () => {
  let client: OverleafWebSocketClient;

  beforeEach(() => {
    client = new OverleafWebSocketClient();

    // Add test files to docIdToPath
    (client as any).docIdToPath.set('test-doc-id', {
      id: 'test-doc-id',
      path: '/test.tex',
      name: 'test.tex',
      type: 'doc'
    });

    (client as any).docIdToPath.set('test-file-id', {
      id: 'test-file-id',
      path: '/test.pdf',
      name: 'test.pdf',
      type: 'file',
      hash: 'abc123'
    });
  });

  afterEach(() => {
    client.disconnect();
  });

  it('should handle removeEntity message correctly for documents', () => {
    const callback = vi.fn();
    client.onChange(callback);

    // Simulate removeEntity message for a document
    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['test-doc-id', 'editor']
    });

    expect(callback).toHaveBeenCalledWith({
      type: 'deleted',
      path: '/test.tex',
      docId: 'test-doc-id'
    });
  });

  it('should handle removeEntity message correctly for files', () => {
    const callback = vi.fn();
    client.onChange(callback);

    // Simulate removeEntity message for a file
    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['test-file-id', 'file']
    });

    expect(callback).toHaveBeenCalledWith({
      type: 'deleted',
      path: '/test.pdf',
      docId: 'test-file-id'
    });
  });

  it('should remove deleted files from docIdToPath', () => {
    expect((client as any).docIdToPath.has('test-doc-id')).toBe(true);

    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['test-doc-id', 'editor']
    });

    expect((client as any).docIdToPath.has('test-doc-id')).toBe(false);
  });

  it('should handle unknown entity IDs gracefully', () => {
    const callback = vi.fn();
    client.onChange(callback);

    // Mock console.error to verify error is logged
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['unknown-id', 'editor']
    });

    expect(callback).toHaveBeenCalledWith({
      type: 'deleted',
      path: '/unknown-id',
      docId: 'unknown-id'
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('should handle docRemoved message', () => {
    const callback = vi.fn();
    client.onChange(callback);

    (client as any).handleDataMessage({
      name: 'docRemoved',
      args: [{ doc: 'test-doc-id', path: '/test.tex' }]
    });

    expect(callback).toHaveBeenCalledWith({
      type: 'deleted',
      path: '/test.tex',
      docId: 'test-doc-id'
    });

    expect((client as any).docIdToPath.has('test-doc-id')).toBe(false);
  });

  it('should handle fileRemoved message', () => {
    const callback = vi.fn();
    client.onChange(callback);

    (client as any).handleDataMessage({
      name: 'fileRemoved',
      args: [{ file: 'test-file-id', path: '/test.pdf' }]
    });

    expect(callback).toHaveBeenCalledWith({
      type: 'deleted',
      path: '/test.pdf',
      docId: 'test-file-id'
    });
  });

  it('should not crash when no callback is registered', () => {
    // Mock console.warn to verify warning is logged
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => {
      (client as any).handleDataMessage({
        name: 'removeEntity',
        args: ['test-doc-id', 'editor']
      });
    }).not.toThrow();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No onChangeCallback registered')
    );

    consoleWarnSpy.mockRestore();
  });

  it('should handle multiple deletions in sequence', () => {
    const callback = vi.fn();
    client.onChange(callback);

    // Delete first file
    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['test-doc-id', 'editor']
    });

    // Delete second file
    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['test-file-id', 'file']
    });

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenNthCalledWith(1, {
      type: 'deleted',
      path: '/test.tex',
      docId: 'test-doc-id'
    });
    expect(callback).toHaveBeenNthCalledWith(2, {
      type: 'deleted',
      path: '/test.pdf',
      docId: 'test-file-id'
    });

    expect((client as any).docIdToPath.size).toBe(0);
  });

  it('should get doc info before deletion', () => {
    const docInfo = client.getDocInfo('test-doc-id');
    expect(docInfo).toEqual({
      id: 'test-doc-id',
      path: '/test.tex',
      name: 'test.tex',
      type: 'doc'
    });

    // After deletion, doc info should be removed
    (client as any).handleDataMessage({
      name: 'removeEntity',
      args: ['test-doc-id', 'editor']
    });

    const docInfoAfter = client.getDocInfo('test-doc-id');
    expect(docInfoAfter).toBeUndefined();
  });
});
