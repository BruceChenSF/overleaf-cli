/**
 * EditorUpdater - Update Overleaf editor content
 *
 * This module updates Overleaf's CodeMirror 6 editor by directly
 * manipulating the DOM. Overleaf will auto-save the changes.
 *
 * IMPORTANT: Uses a distributed lock mechanism to prevent circular sync.
 * When we update the editor, we set a flag that EditMonitor checks
 * to ignore the resulting edit events.
 */

const UPDATE_FLAG = '__overleaf_cc_editor_updating__';
const UPDATE_TIMEOUT = 5000; // 5 seconds timeout for safety

export class EditorUpdater {
  /**
   * Update document content in Overleaf editor
   *
   * @param docId - Document ID to update (not used for CM6, but kept for API compatibility)
   * @param content - New content for the document
   * @returns Promise<void>
   */
  async updateDocument(docId: string, content: string): Promise<void> {
    console.log(`[EditorUpdater] 📝 Updating doc: ${docId}`);

    // 🔥 Set flag to prevent EditMonitor from picking up this change
    (window as any)[UPDATE_FLAG] = {
      docId,
      timestamp: Date.now(),
      content
    };
    console.log(`[EditorUpdater] 🔒 Set update flag to prevent circular sync`);

    try {
      // Find the CodeMirror 6 content element
      const cmContent = document.querySelector('.cm-content');

      if (!cmContent) {
        throw new Error('CodeMirror editor not found');
      }

      console.log(`[EditorUpdater] ✅ Found .cm-content element`);

      // Directly update the textContent
      // CodeMirror 6 will detect the change via MutationObserver
      // Overleaf will auto-save
      (cmContent as HTMLElement).textContent = content;

      console.log(`[EditorUpdater] ✅ Updated content (${content.length} chars)`);

      // Wait a bit for the change to propagate, then clear flag
      // This gives time for Overleaf to process but prevents old flags from lingering
      setTimeout(() => {
        this.clearUpdateFlag();
      }, 2000);

    } catch (error) {
      // Clear flag on error
      this.clearUpdateFlag();
      throw error;
    }
  }

  /**
   * Clear the update flag
   * @private
   */
  private clearUpdateFlag(): void {
    delete (window as any)[UPDATE_FLAG];
    console.log(`[EditorUpdater] 🔓 Cleared update flag`);
  }

  /**
   * Check if editor is being updated (for EditMonitor to use)
   * @returns true if currently updating, false otherwise
   */
  static isUpdating(): boolean {
    return !!(window as any)[UPDATE_FLAG];
  }

  /**
   * Get current update info (for EditMonitor to use)
   */
  static getUpdateInfo(): { docId: string; timestamp: number; content: string } | null {
    const info = (window as any)[UPDATE_FLAG];

    // Check for stale flags (older than timeout)
    if (info && Date.now() - info.timestamp > UPDATE_TIMEOUT) {
      console.warn('[EditorUpdater] ⚠️ Found stale update flag, clearing');
      delete (window as any)[UPDATE_FLAG];
      return null;
    }

    return info || null;
  }
}
