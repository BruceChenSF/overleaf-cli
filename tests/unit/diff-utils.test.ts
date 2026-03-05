import { describe, it, expect } from 'vitest';
import { DiffUtils } from '../../src/shared/diff-utils';
import type { DiffPatch } from '../../src/shared/types';

describe('DiffUtils', () => {
  describe('computeDiff', () => {
    it('should detect insertions', async () => {
      const oldContent = 'Hello';
      const newContent = 'Hello World';

      const diff = await DiffUtils.computeDiff(oldContent, newContent);

      expect(diff.type).toBe('diff');
      expect(diff.checksum).toBeTruthy();
      expect(diff.changes.length).toBeGreaterThan(0);

      // Check if there's an INSERT change for ' World'
      const insertChange = diff.changes.find(c => c.type === 'INSERT' && c.text.includes('World'));
      expect(insertChange).toBeDefined();
    });

    it('should detect deletions', async () => {
      const oldContent = 'Hello World';
      const newContent = 'Hello';

      const diff = await DiffUtils.computeDiff(oldContent, newContent);

      const deleteChange = diff.changes.find(c => c.type === 'DELETE' && c.text.includes('World'));
      expect(deleteChange).toBeDefined();
    });

    it('should handle multiple changes', async () => {
      const oldContent = 'The quick brown fox';
      const newContent = 'The slow blue cat';

      const diff = await DiffUtils.computeDiff(oldContent, newContent);

      const insertions = diff.changes.filter(c => c.type === 'INSERT');
      const deletions = diff.changes.filter(c => c.type === 'DELETE');

      expect(insertions.length).toBeGreaterThan(0);
      expect(deletions.length).toBeGreaterThan(0);
    });

    it('should generate checksum for new content', async () => {
      const oldContent = 'Hello';
      const newContent = 'Hello World';

      const diff = await DiffUtils.computeDiff(oldContent, newContent);

      const expectedHash = await DiffUtils.hashContent(newContent);
      expect(diff.checksum).toBe(expectedHash);
    });

    it('should handle empty content', async () => {
      const diff = await DiffUtils.computeDiff('', 'Hello');

      expect(diff.changes.length).toBeGreaterThan(0);
    });

    it('should handle identical content', async () => {
      const content = 'Hello World';
      const diff = await DiffUtils.computeDiff(content, content);

      // When content is identical, we skip EQUAL changes for efficiency
      expect(diff.changes.length).toBe(0);
      expect(diff.checksum).toBe(await DiffUtils.hashContent(content));
    });
  });

  describe('applyDiff', () => {
    it('should apply insertion diff', async () => {
      const baseContent = 'Hello';
      const diff: DiffPatch = {
        type: 'diff',
        checksum: 'abc123',
        timestamp: Date.now(),
        changes: [
          { type: 'INSERT', text: ' World', position: 5 }
        ]
      };

      const result = await DiffUtils.applyDiff(baseContent, diff);

      expect(result).toBe('Hello World');
    });

    it('should apply deletion diff', async () => {
      const baseContent = 'Hello World';
      const diff: DiffPatch = {
        type: 'diff',
        checksum: 'abc123',
        timestamp: Date.now(),
        changes: [
          { type: 'DELETE', text: ' World', position: 5 }
        ]
      };

      const result = await DiffUtils.applyDiff(baseContent, diff);

      expect(result).toBe('Hello');
    });

    it('should apply complex diff with multiple changes', async () => {
      const baseContent = 'The quick brown fox';

      // Generate actual diff to get correct positions
      const newContent = 'The slow blue cat';
      const diff = await DiffUtils.computeDiff(baseContent, newContent);

      const result = await DiffUtils.applyDiff(baseContent, diff);

      expect(result).toBe(newContent);
    });

    it('should handle empty diff', async () => {
      const baseContent = 'Hello';
      const diff: DiffPatch = {
        type: 'diff',
        checksum: await DiffUtils.hashContent(baseContent),
        timestamp: Date.now(),
        changes: []
      };

      const result = await DiffUtils.applyDiff(baseContent, diff);

      expect(result).toBe(baseContent);
    });
  });

  describe('hashContent', () => {
    it('should generate consistent hash for same content', async () => {
      const content = 'Hello World';

      const hash1 = await DiffUtils.hashContent(content);
      const hash2 = await DiffUtils.hashContent(content);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different content', async () => {
      const hash1 = await DiffUtils.hashContent('Hello');
      const hash2 = await DiffUtils.hashContent('World');

      expect(hash1).not.toBe(hash2);
    });

    it('should generate fixed-length hash', async () => {
      const hash = await DiffUtils.hashContent('Hello World');

      expect(hash).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it('should handle empty string', async () => {
      const hash = await DiffUtils.hashContent('');

      expect(hash).toHaveLength(64);
    });
  });

  describe('areContentsEqual', () => {
    it('should return true for identical content', async () => {
      const content1 = 'Hello World';
      const content2 = 'Hello World';

      const result = await DiffUtils.areContentsEqual(content1, content2);

      expect(result).toBe(true);
    });

    it('should return false for different content', async () => {
      const content1 = 'Hello';
      const content2 = 'World';

      const result = await DiffUtils.areContentsEqual(content1, content2);

      expect(result).toBe(false);
    });

    it('should handle empty strings', async () => {
      const result = await DiffUtils.areContentsEqual('', '');

      expect(result).toBe(true);
    });
  });
});
