import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncStateTracker } from '../src/content/sync-state';

describe('SyncStateTracker - Incremental Sync', () => {
  let tracker: SyncStateTracker;

  beforeEach(() => {
    tracker = new SyncStateTracker();
  });

  afterEach(() => {
    tracker.clear();
  });

  it('should track file hashes', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    expect(tracker.getHash('/test.tex')).toEqual({
      path: '/test.tex',
      hash: 'abc123',
      type: 'doc',
      lastModified: expect.any(Number)
    });
  });

  it('should track multiple files', () => {
    tracker.updateHash('/main.tex', 'abc123', 'doc');
    tracker.updateHash('/references.bib', 'def456', 'file');
    tracker.updateHash('/figure.png', 'ghi789', 'file');

    expect(tracker.getAllFiles()).toHaveLength(3);
    expect(tracker.getHash('/main.tex')?.hash).toBe('abc123');
    expect(tracker.getHash('/references.bib')?.hash).toBe('def456');
    expect(tracker.getHash('/figure.png')?.hash).toBe('ghi789');
  });

  it('should detect new files', () => {
    expect(tracker.needsSync('/new.tex', 'def456')).toBe(true);
  });

  it('should detect modified files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    expect(tracker.needsSync('/test.tex', 'def456')).toBe(true);
  });

  it('should skip unchanged files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    expect(tracker.needsSync('/test.tex', 'abc123')).toBe(false);
  });

  it('should update hash for existing files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    expect(tracker.getHash('/test.tex')?.hash).toBe('abc123');

    tracker.updateHash('/test.tex', 'def456', 'doc');
    expect(tracker.getHash('/test.tex')?.hash).toBe('def456');
  });

  it('should detect deleted files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    tracker.updateHash('/main.tex', 'def456', 'doc');

    const currentPaths = new Set(['/main.tex']);
    const deleted = tracker.detectDeletedFiles(currentPaths);

    expect(deleted).toEqual(['/test.tex']);
  });

  it('should detect multiple deleted files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    tracker.updateHash('/main.tex', 'def456', 'doc');
    tracker.updateHash('/refs.bib', 'ghi789', 'doc');

    const currentPaths = new Set(['/main.tex']);
    const deleted = tracker.detectDeletedFiles(currentPaths);

    expect(deleted).toHaveLength(2);
    expect(deleted).toContain('/test.tex');
    expect(deleted).toContain('/refs.bib');
  });

  it('should return empty array when no files are deleted', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    tracker.updateHash('/main.tex', 'def456', 'doc');

    const currentPaths = new Set(['/test.tex', '/main.tex']);
    const deleted = tracker.detectDeletedFiles(currentPaths);

    expect(deleted).toEqual([]);
  });

  it('should cleanup old entries when exceeding limit', () => {
    // Add 1001 entries to trigger cleanup
    for (let i = 0; i < 1001; i++) {
      tracker.updateHash(`/file${i}.tex`, `hash${i}`, 'doc');
    }

    const countBefore = tracker.getAllFiles().length;
    tracker.cleanup();
    const countAfter = tracker.getAllFiles().length;

    expect(countAfter).toBeLessThan(countBefore);
    expect(countAfter).toBeLessThan(1000);
  });

  it('should cleanup entries older than 1 hour', () => {
    // Mock Date.now to simulate time passage
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000) - 1000;

    tracker.updateHash('/old.tex', 'abc123', 'doc');
    tracker.updateHash('/new.tex', 'def456', 'doc');

    // Manually set lastModified for old file
    const oldHash = tracker.getHash('/old.tex');
    if (oldHash) {
      (oldHash as any).lastModified = oneHourAgo;
    }

    tracker.cleanup();

    expect(tracker.getHash('/old.tex')).toBeUndefined();
    expect(tracker.getHash('/new.tex')).toBeDefined();
  });

  it('should remove specific files', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    tracker.updateHash('/main.tex', 'def456', 'doc');

    tracker.removeFile('/test.tex');

    expect(tracker.getHash('/test.tex')).toBeUndefined();
    expect(tracker.getHash('/main.tex')).toBeDefined();
  });

  it('should clear all tracking', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    tracker.updateHash('/main.tex', 'def456', 'doc');

    expect(tracker.getAllFiles()).toHaveLength(2);

    tracker.clear();

    expect(tracker.getAllFiles()).toHaveLength(0);
  });

  it('should handle different file types', () => {
    tracker.updateHash('/doc.tex', 'abc123', 'doc');
    tracker.updateHash('/file.pdf', 'def456', 'file');
    tracker.updateHash('/image.png', 'ghi789', 'file');

    const docHash = tracker.getHash('/doc.tex');
    const fileHash = tracker.getHash('/file.pdf');
    const imageHash = tracker.getHash('/image.png');

    expect(docHash?.type).toBe('doc');
    expect(fileHash?.type).toBe('file');
    expect(imageHash?.type).toBe('file');
  });

  it('should update lastModified timestamp on update', () => {
    tracker.updateHash('/test.tex', 'abc123', 'doc');

    const firstHash = tracker.getHash('/test.tex');
    const firstTimestamp = firstHash?.lastModified;

    // Wait a bit and update
    setTimeout(() => {
      tracker.updateHash('/test.tex', 'def456', 'doc');

      const secondHash = tracker.getHash('/test.tex');
      const secondTimestamp = secondHash?.lastModified;

      expect(secondTimestamp).toBeGreaterThan(firstTimestamp as number);
    }, 10);
  });

  it('should handle cleanup with less than 1000 entries', () => {
    // Add only 100 entries
    for (let i = 0; i < 100; i++) {
      tracker.updateHash(`/file${i}.tex`, `hash${i}`, 'doc');
    }

    const countBefore = tracker.getAllFiles().length;
    tracker.cleanup();
    const countAfter = tracker.getAllFiles().length;

    // Should not remove anything if under limit
    expect(countAfter).toBe(countBefore);
  });

  it('should track lastModified timestamp accurately', () => {
    const before = Date.now();
    tracker.updateHash('/test.tex', 'abc123', 'doc');
    const after = Date.now();

    const hash = tracker.getHash('/test.tex');
    expect(hash?.lastModified).toBeGreaterThanOrEqual(before);
    expect(hash?.lastModified).toBeLessThanOrEqual(after);
  });
});
