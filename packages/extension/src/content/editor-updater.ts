/**
 * EditorUpdater - Update Overleaf editor content
 *
 * This module updates Overleaf's CodeMirror 6 editor by directly
 * manipulating the DOM. Overleaf will auto-save the changes.
 */

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
  }
}
