import fastDiff from 'fast-diff';
import type { DiffPatch, DiffChange } from './types';

export class DiffUtils {
  /**
   * Compute diff between two strings
   */
  static async computeDiff(oldContent: string, newContent: string): Promise<DiffPatch> {
    // Use fast-diff to compute character-level diff
    const rawDiff = fastDiff(oldContent, newContent);

    // Convert to our DiffChange format
    const changes: DiffChange[] = [];
    let oldPosition = 0; // Track position in OLD string

    for (const [type, text] of rawDiff) {
      if (type === 1) { // INSERT
        // For INSERT, position is where to insert (current oldPosition)
        changes.push({
          type: 'INSERT',
          text,
          position: oldPosition
        });
        // INSERT doesn't move oldPosition
      } else if (type === -1) { // DELETE
        // For DELETE, position is in old string
        changes.push({
          type: 'DELETE',
          text,
          position: oldPosition
        });
        // DELETE moves oldPosition by text length
        oldPosition += text.length;
      } else { // EQUAL
        // EQUAL moves oldPosition
        oldPosition += text.length;
      }
    }

    return {
      type: 'diff',
      checksum: await this.hashContent(newContent),
      timestamp: Date.now(),
      changes
    };
  }

  /**
   * Apply diff to base content
   */
  static async applyDiff(baseContent: string, patch: DiffPatch): Promise<string> {
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
   * Generate SHA-256 hash of content using Web Crypto API
   */
  static async hashContent(content: string): Promise<string> {
    // Use TextEncoder to convert string to bytes
    const encoder = new TextEncoder();
    const data = encoder.encode(content);

    // Use Web Crypto API for SHA-256 (browser compatible)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert buffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
  }

  /**
   * Compare two contents using their hashes
   */
  static async areContentsEqual(content1: string, content2: string): Promise<boolean> {
    const hash1 = await this.hashContent(content1);
    const hash2 = await this.hashContent(content2);
    return hash1 === hash2;
  }
}
