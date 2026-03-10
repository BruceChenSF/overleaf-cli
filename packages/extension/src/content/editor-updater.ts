/**
 * EditorUpdater - Update Overleaf editor content
 *
 * This module simulates human editing by directly manipulating
 * the Overleaf editor (Ace Editor / CodeMirror).
 */

export class EditorUpdater {
  /**
   * Update document content in Overleaf editor
   *
   * @param docId - Document ID to update
   * @param content - New content for the document
   * @returns Promise<void>
   */
  async updateDocument(docId: string, content: string): Promise<void> {
    console.log(`[EditorUpdater] 📝 Updating doc: ${docId}`);

    try {
      // Method 1: Try to update via Overleaf's internal editor API
      const result = await this.updateViaEditorAPI(docId, content);

      if (result) {
        console.log(`[EditorUpdater] ✅ Updated via editor API: ${docId}`);
        return;
      }

      // Method 2: If document is not open, open it first
      console.log(`[EditorUpdater] 📂 Document not open, opening: ${docId}`);
      await this.openAndUpdateDocument(docId, content);
      console.log(`[EditorUpdater] ✅ Updated after opening: ${docId}`);

    } catch (error) {
      console.error(`[EditorUpdater] ❌ Failed to update ${docId}:`, error);
      throw error;
    }
  }

  /**
   * Update document if it's currently open in editor
   *
   * @param docId - Document ID
   * @param content - New content
   * @returns Promise<boolean> - true if updated, false if not open
   * @private
   */
  private async updateViaEditorAPI(docId: string, content: string): Promise<boolean> {
    // Access Overleaf's global editor instance
    const editor = (window as any).editor;

    if (!editor) {
      console.warn('[EditorUpdater] ⚠️ No editor instance found');
      return false;
    }

    // Get current document
    const currentDoc = editor.documentManager?.getCurrentDoc();

    if (!currentDoc) {
      console.warn('[EditorUpdater] ⚠️ No current document');
      return false;
    }

    // Check if the current document is the one we want to update
    if (currentDoc.id === docId) {
      console.log('[EditorUpdater] ✅ Document is currently open');

      // Get the editor session
      const session = editor.sharejs_doc?.session;

      if (!session) {
        console.error('[EditorUpdater] ❌ No editor session found');
        return false;
      }

      // Update content using Ace Editor API
      this.updateAceSession(session, content);

      return true;
    }

    console.log(`[EditorUpdater] ⚠️ Wrong document open (current: ${currentDoc.id}, target: ${docId})`);
    return false;
  }

  /**
   * Update Ace Editor session content
   *
   * @param session - Ace Editor session
   * @param content - New content
   * @private
   */
  private updateAceSession(session: any, content: string): void {
    // Get current cursor position to restore later
    const cursorPosition = session.selection.getCursor();

    // Select all content
    session.selection.selectAll();

    // Replace with new content
    // Note: This simulates a "select all + paste" operation
    const selection = session.selection;
    const range = selection.getSelectionRange();
    session.replace(range, content);

    // Restore cursor position (if possible)
    try {
      session.selection.moveCursorToPosition(cursorPosition);
    } catch (e) {
      // If cursor position is invalid, move to end
      session.selection.moveCursorTo(session.getLength(), 0);
    }

    console.log('[EditorUpdater] ✅ Content updated in editor');
  }

  /**
   * Open document and then update it
   *
   * @param docId - Document ID
   * @param content - New content
   * @private
   */
  private async openAndUpdateDocument(docId: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const editor = (window as any).editor;

      if (!editor) {
        reject(new Error('No editor instance'));
        return;
      }

      // Navigate to the document
      const url = `/project/${editor.project_id}/doc/${docId}`;

      console.log('[EditorUpdater] 🔗 Navigating to:', url);

      // Navigate and wait for load
      window.location.href = url;

      // Set up a listener to detect when the document is loaded
      const checkInterval = setInterval(() => {
        const currentDoc = editor.documentManager?.getCurrentDoc();

        if (currentDoc && currentDoc.id === docId) {
          clearInterval(checkInterval);

          // Wait a bit for editor to initialize
          setTimeout(() => {
            this.updateViaEditorAPI(docId, content).then((success) => {
              if (success) {
                resolve();
              } else {
                reject(new Error('Failed to update after opening'));
              }
            }).catch(reject);
          }, 500);
        }
      }, 100);

      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for document to load'));
      }, 10000);
    });
  }
}
