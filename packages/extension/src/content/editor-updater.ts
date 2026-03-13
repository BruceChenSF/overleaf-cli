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
  async updateDocument(
    docId: string,
    content: string
  ): Promise<string> {
    const syncId = generateSyncId();
    console.log(`[EditorUpdater] 📝 Updating doc: ${docId} (syncId: ${syncId})`);

    // Step 1: Check if current document is the target document
    const currentDocId = this.getCurrentDocId();
    console.log(`[EditorUpdater] 🔍 Current docId: ${currentDocId}, Target docId: ${docId}`);

    if (currentDocId !== docId) {
      console.log(`[EditorUpdater] 📂 Target document not open, switching...`);

      // 🔥 IMPORTANT: Set up event listener BEFORE clicking the file
      // Otherwise the joinDoc event might fire before we're listening
      const joinDocPromise = this.waitForJoinDocEvent(docId);

      // Try to switch by docId first (most reliable)
      try {
        await this.switchToDocumentById(docId);
      } catch (error) {
        console.log(`[EditorUpdater] ⚠️ Could not switch by docId, trying by file name...`);
        // Fallback: switch by file name
        await this.switchToDocumentByFileName(docId);
      }

      // Wait for joinDoc event
      console.log(`[EditorUpdater] ⏳ Waiting for joinDoc event...`);
      await joinDocPromise;

      // 🔥 IMPORTANT: Wait for CodeMirror to fully initialize after joinDoc
      console.log(`[EditorUpdater] ⏳ Waiting for CodeMirror to be ready...`);
      await this.waitForEditorReady();
    }

    // Step 2: Find the CodeMirror 6 content element
    const cmContent = document.querySelector('.cm-content');

    if (!cmContent) {
      throw new Error('CodeMirror editor not found');
    }

    console.log(`[EditorUpdater] ✅ Found .cm-content element`);

    // 🔥 IMPORTANT: Get the ACTUAL docId after document switch
    // This may be different from our target docId if there's a mismatch
    const actualDocId = this.getCurrentDocId();
    console.log(`[EditorUpdater] 🔍 Actual docId after switch: ${actualDocId}`);

    // 🔥 Set sync ID with the ACTUAL docId so EditMonitor can properly filter our updates
    (window as any)[SYNC_ID_KEY] = {
      syncId,
      docId: actualDocId || docId,  // Use actual docId, fallback to target
      timestamp: Date.now()
    };
    console.log(`[EditorUpdater] 🔒 Set sync ID: ${syncId} for docId: ${actualDocId || docId}`);

    // Step 3: Directly update the textContent
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
   * Wait for CodeMirror editor to be ready after document switch
   * This checks if the editor has content and is fully initialized
   */
  private async waitForEditorReady(timeout = 5000): Promise<void> {
    console.log(`[EditorUpdater] ⏳ Waiting for CodeMirror editor ready...`);

    const startTime = Date.now();
    const checkInterval = 100;

    while (Date.now() - startTime < timeout) {
      const cmContent = document.querySelector('.cm-content');
      if (cmContent) {
        // Check if editor has some content rendered
        const hasLines = cmContent.querySelector('.cm-line');
        const hasContent = (cmContent as HTMLElement).textContent?.length || 0 > 0;

        if (hasLines && hasContent) {
          console.log(`[EditorUpdater] ✅ CodeMirror editor ready`);
          return;
        }
      }

      await this.sleep(checkInterval);
    }

    console.log(`[EditorUpdater] ⚠️ Editor readiness check timeout, proceeding anyway`);
  }

  /**
   * Get the current open document ID
   */
  private getCurrentDocId(): string | null {
    try {
      // Method 1: Try documentManager (older Overleaf versions)
      const currentDoc = (window as any).editor?.documentManager?.getCurrentDoc();
      if (currentDoc?._id) {
        console.log(`[EditorUpdater] 🔍 Current docId from documentManager: ${currentDoc._id}`);
        return currentDoc._id;
      }
    } catch (e) {
      // Ignore errors
    }

    try {
      // Method 2: Try from React state / editor store (newer Overleaf versions)
      const editorState = (window as any).__overleaf_editor_state__;
      if (editorState?.doc_id) {
        console.log(`[EditorUpdater] 🔍 Current docId from __overleaf_editor_state__: ${editorState.doc_id}`);
        return editorState.doc_id;
      }
    } catch (e) {
      // Ignore errors
    }

    try {
      // Method 3: Extract from URL
      const urlMatch = window.location.href.match(/doc\/([a-f0-9]{24})/);
      if (urlMatch && urlMatch[1]) {
        console.log(`[EditorUpdater] 🔍 Current docId from URL: ${urlMatch[1]}`);
        return urlMatch[1];
      }
    } catch (e) {
      // Ignore errors
    }

    console.log(`[EditorUpdater] 🔍 Current docId: null (no method found)`);
    return null;
  }

  /**
   * Switch to a document by clicking it in the file tree using docId
   */
  private async switchToDocumentById(docId: string): Promise<void> {
    console.log(`[EditorUpdater] 📂 Looking for doc in tree: ${docId}`);

    // Try to find element with data-entity-id attribute
    const fileElement = document.querySelector(`[data-entity-id="${docId}"]`);

    if (!fileElement) {
      // Fallback: try to find by old attribute name
      const oldElement = document.querySelector(`[data-entity="${docId}"]`);
      if (oldElement) {
        console.log(`[EditorUpdater] ✅ Found doc by old data-entity attribute`);
        (this.findClickableParent(oldElement as HTMLElement) || oldElement as HTMLElement).click();
        await this.sleep(500);
        return;
      }

      throw new Error(`Doc not found in file tree: ${docId}`);
    }

    console.log(`[EditorUpdater] ✅ Found doc by data-entity-id, clicking...`);

    // Find the clickable parent and click
    const clickableElement = this.findClickableParent(fileElement as HTMLElement) || (fileElement as HTMLElement);
    clickableElement.click();

    // Wait a bit for the click to take effect
    await this.sleep(500);
  }

  /**
   * Switch to a document by file name (fallback method)
   * This looks up the docId in the global docIdToPath mapping and uses the file name
   */
  private async switchToDocumentByFileName(docId: string): Promise<void> {
    console.log(`[EditorUpdater] 📂 Looking up docId in mapping: ${docId}`);

    // Try to get the file info from the global OverleafWebSocketClient
    const docInfo = (window as any).__overleaf_docIdToPath__?.get(docId);

    if (!docInfo) {
      throw new Error(`Doc info not found in mapping for docId: ${docId}`);
    }

    console.log(`[EditorUpdater] 📄 Found file in mapping: ${docInfo.path}`);

    // Use the existing switchToDocument method
    await this.switchToDocument(docInfo.path);
  }

  /**
   * Switch to a document by clicking it in the file tree (legacy method, using file path)
   * @deprecated Use switchToDocumentById instead
   */
  private async switchToDocument(filePath: string): Promise<void> {
    console.log(`[EditorUpdater] 📂 Looking for file in tree: ${filePath}`);

    // Extract file name from path
    const fileName = filePath.split('/').pop() || filePath;
    console.log(`[EditorUpdater] 🔍 File name: ${fileName}`);

    // Try multiple selectors for the file tree
    const selectors = [
      '#ide-redesign-file-tree .item-name span',  // New Overleaf UI
      '.file-tree .file-name',                    // Old Overleaf UI
      '.file-tree [data-entity-type="doc"]',      // Legacy with data attribute
    ];

    let fileElement: HTMLElement | null = null;

    for (const selector of selectors) {
      console.log(`[EditorUpdater] 🔍 Trying selector: ${selector}`);
      const elements = document.querySelectorAll(selector);
      console.log(`[EditorUpdater] 🔍 Found ${elements.length} elements`);

      for (const element of elements) {
        // Find the clickable parent or use the element itself
        const clickableParent = this.findClickableParent(element as HTMLElement);
        const name = element.textContent?.trim();

        console.log(`[EditorUpdater] 🔍 Checking file: ${name}`);

        if (name === fileName || name === filePath) {
          fileElement = clickableParent;
          break;
        }
      }

      if (fileElement) break;
    }

    if (!fileElement) {
      // Debug: log all file names found in the tree
      console.log(`[EditorUpdater] 🔍 Debug: listing all files in tree...`);
      const allSpans = document.querySelectorAll('#ide-redesign-file-tree .item-name span, .file-tree .file-name');
      allSpans.forEach(span => {
        console.log(`[EditorUpdater] 🔍 - Found: ${span.textContent?.trim()}`);
      });

      throw new Error(`File not found in file tree: ${filePath}`);
    }

    console.log(`[EditorUpdater] ✅ Found target file, clicking...`);

    // Click the file to switch to it
    fileElement.click();

    // Wait a bit for the click to take effect
    await this.sleep(500);
  }

  /**
   * Find the clickable parent element (div with click handler or li element)
   */
  private findClickableParent(element: HTMLElement): HTMLElement | null {
    // Try to find a clickable parent (up to 3 levels)
    let current = element;
    for (let i = 0; i < 3; i++) {
      if (!current.parentElement) break;
      current = current.parentElement;

      // Check if this is a likely clickable element
      // - has file-tree-entity-details class
      // - or has onclick attribute
      // - or is an li element in the file tree
      if (
        current.classList.contains('file-tree-entity-details') ||
        current.getAttribute('onclick') !== null ||
        (current.tagName === 'LI' && current.closest('#ide-redesign-file-tree'))
      ) {
        return current;
      }
    }

    // Fallback: return the original element
    return element;
  }

  /**
   * Wait for joinDoc event to confirm document has loaded
   */
  private async waitForJoinDocEvent(targetDocId: string, timeout = 10000): Promise<void> {
    console.log(`[EditorUpdater] ⏳ Waiting for joinDoc event: ${targetDocId} (timeout: ${timeout}ms)`);

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let eventListener: ((event: MessageEvent) => void) | null = null;

      // Cleanup function
      const cleanup = () => {
        if (eventListener) {
          window.removeEventListener('message', eventListener);
          eventListener = null;
        }
      };

      // Set up timeout
      const timeoutId = setTimeout(() => {
        cleanup();
        console.error(`[EditorUpdater] ❌ Timeout waiting for joinDoc event`);
        console.error(`[EditorUpdater]    Expected docId: ${targetDocId}`);
        console.error(`[EditorUpdater]    Elapsed: ${Date.now() - startTime}ms`);
        reject(new Error(`Timeout waiting for joinDoc event: ${targetDocId}`));
      }, timeout);

      // Listen for joinDoc event
      eventListener = (event: MessageEvent) => {
        // Security check: only accept messages from same origin
        if (event.source !== window) return;

        const { type, data } = event.data;

        if (type === 'OVERLEAF_CC_JOIN_DOC') {
          const receivedDocId = data?.doc_id;
          console.log(`[EditorUpdater] 🔍 Received joinDoc event: ${receivedDocId}`);

          if (receivedDocId === targetDocId) {
            // Match found!
            clearTimeout(timeoutId);
            cleanup();

            console.log(`[EditorUpdater] ✅ Document loaded: ${targetDocId}`);

            // 🔥 IMPORTANT: Wait for CodeMirror to fully initialize
            // joinDoc only means "started loading", not "ready for editing"
            setTimeout(() => {
              console.log(`[EditorUpdater] ✅ CodeMirror initialization wait complete`);
              resolve();
            }, 1000); // Wait 1 second for CodeMirror to initialize
          }
        }
      };

      // Add event listener
      window.addEventListener('message', eventListener);
    });
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

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
