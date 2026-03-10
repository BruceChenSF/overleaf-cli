/**
 * EditorUpdater - Update Overleaf editor content
 *
 * This module updates Overleaf's CodeMirror 6 editor by directly
 * manipulating the DOM. Overleaf will auto-save the changes.
 *
 * IMPORTANT: Uses a unique sync ID to mark our updates.
 * EditMonitor checks this ID to distinguish between our updates and user edits.
 */

const SYNC_ID_KEY = '__overleaf_cc_sync_id__';
const SYNC_TIMEOUT = 10000; // 10 seconds

/**
 * Generate a unique sync ID
 */
function generateSyncId(): string {
  return `sync-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export class EditorUpdater {
  /**
   * Update document content in Overleaf editor
   *
   * @param docId - Document ID to update
   * @param content - New content for the document
   * @returns the sync ID
   */
  updateDocument(docId: string, content: string): string {
    const syncId = generateSyncId();
    console.log(`[EditorUpdater] 📝 Updating doc: ${docId} (syncId: ${syncId})`);

    // Find the CodeMirror 6 content element
    const cmContent = document.querySelector('.cm-content');

    if (!cmContent) {
      throw new Error('CodeMirror editor not found');
    }

    console.log(`[EditorUpdater] ✅ Found .cm-content element`);

    // 🔥 Set sync ID to mark this as our update
    (window as any)[SYNC_ID_KEY] = {
      syncId,
      docId,
      timestamp: Date.now()
    };
    console.log(`[EditorUpdater] 🔒 Set sync ID: ${syncId}`);

    // Directly update the textContent
    (cmContent as HTMLElement).textContent = content;
    console.log(`[EditorUpdater] ✅ Updated content (${content.length} chars)`);

    // Auto-clear after timeout (in case no edit event comes)
    setTimeout(() => {
      const current = (window as any)[SYNC_ID_KEY];
      if (current && current.syncId === syncId) {
        console.log(`[EditorUpdater] ⏱️ Sync ID timeout, clearing: ${syncId}`);
        delete (window as any)[SYNC_ID_KEY];
      }
    }, SYNC_TIMEOUT);

    return syncId;
  }

  /**
   * Check if a sync ID is currently active (for EditMonitor to use)
   */
  static getSyncId(): { syncId: string; docId: string; timestamp: number } | null {
    const info = (window as any)[SYNC_ID_KEY];

    if (!info) {
      return null;
    }

    // Check for stale IDs
    if (Date.now() - info.timestamp > SYNC_TIMEOUT) {
      console.warn('[EditorUpdater] ⚠️ Found stale sync ID, clearing');
      delete (window as any)[SYNC_ID_KEY];
      return null;
    }

    return info;
  }

  /**
   * Clear the sync ID (called by EditMonitor after processing our update)
   */
  static clearSyncId(syncId: string): void {
    const current = (window as any)[SYNC_ID_KEY];
    if (current && current.syncId === syncId) {
      delete (window as any)[SYNC_ID_KEY];
      console.log(`[EditorUpdater] 🔓 Cleared sync ID: ${syncId}`);
    }
  }
}
