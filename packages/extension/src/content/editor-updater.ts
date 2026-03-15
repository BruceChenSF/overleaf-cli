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
const CURRENT_DOC_ID_KEY = '__overleaf_cc_current_doc_id__';

/**
 * Generate a unique sync ID
 */
function generateSyncId(): string {
  return `sync-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export class EditorUpdater {
  private static initialized = false;

  /**
   * Initialize the EditorUpdater
   * This sets up event listeners for joinDoc events
   */
  static initialize() {
    if (this.initialized) {
      console.log('[EditorUpdater] ℹ️ Already initialized');
      return;
    }

    console.log('[EditorUpdater] 🚀 Initializing...');

    // Listen for joinDoc events from EditMonitorBridge
    window.addEventListener('message', (event) => {
      // Security check: only accept messages from same origin
      if (event.source !== window) return;

      if (event.data.type === 'OVERLEAF_CC_JOIN_DOC') {
        const docId = event.data.data?.doc_id;
        if (docId) {
          console.log(`[EditorUpdater] 📄 joinDoc event received, setting current docId: ${docId}`);
          (window as any)[CURRENT_DOC_ID_KEY] = docId;
        }
      }
    });

    this.initialized = true;
    console.log('[EditorUpdater] ✅ Initialized');
  }

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

      // Wait for document to be open and editor to be ready
      const isOpened = await this.ensureDocumentOpened(docId);

      if (!isOpened) {
        throw new Error(`Failed to open document: ${docId}`);
      }
    }

    // Step 2: Find the CodeMirror 6 content element
    console.log(`[EditorUpdater] 🔍 Looking for .cm-content element...`);
    const cmContent = document.querySelector('.cm-content');

    if (!cmContent) {
      console.error(`[EditorUpdater] ❌ .cm-content not found!`);
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
   * This actively checks if the editor is fully initialized by:
   * 1. Checking for .cm-content element
   * 2. Checking for .cm-line elements (content rendered)
   * 3. Checking for reasonable content length
   * 4. Optionally checking Overleaf's editor state
   */
  private async waitForEditorReady(timeout = 5000): Promise<boolean> {
    console.log(`[EditorUpdater] ⏳ Waiting for CodeMirror editor ready...`);

    const startTime = Date.now();
    const checkInterval = 50; // Check every 50ms
    let lastLogTime = 0;

    while (Date.now() - startTime < timeout) {
      const elapsed = Date.now() - startTime;

      // Log progress every 500ms
      if (elapsed - lastLogTime > 500) {
        console.log(`[EditorUpdater] ⏳ Still waiting for editor... (${elapsed}ms)`);
        lastLogTime = elapsed;
      }

      // Check 1: .cm-content exists
      const cmContent = document.querySelector('.cm-content');
      if (!cmContent) {
        await this.sleep(checkInterval);
        continue;
      }

      // Check 2: Has .cm-line elements (editor has rendered content)
      const lines = cmContent.querySelectorAll('.cm-line');
      if (lines.length === 0) {
        await this.sleep(checkInterval);
        continue;
      }

      // Check 3: Editor has actual content (not just empty lines)
      const content = (cmContent as HTMLElement).textContent || '';
      if (content.length === 0) {
        await this.sleep(checkInterval);
        continue;
      }

      // Check 4: Editor is not in a loading state
      const isLoading = cmContent.querySelector('.cm-loading') !== null;
      if (isLoading) {
        await this.sleep(checkInterval);
        continue;
      }

      // Check 5: Try to verify Overleaf's editor state (if available)
      try {
        const editor = (window as any).editor;
        if (editor && editor.documentManager) {
          const currentDoc = editor.documentManager.getCurrentDoc();
          if (currentDoc && currentDoc._id) {
            // Editor state is accessible and has a current doc
            console.log(`[EditorUpdater] ✅ CodeMirror editor ready (verified via editor state)`);
            return true;
          }
        }
      } catch (e) {
        // Editor state not accessible, but DOM checks passed
      }

      // All DOM checks passed
      console.log(`[EditorUpdater] ✅ CodeMirror editor ready (verified via DOM, ${lines.length} lines, ${content.length} chars)`);
      return true;
    }

    // Timeout - but don't fail, just log and continue
    console.warn(`[EditorUpdater] ⚠️ Editor readiness check timeout after ${timeout}ms`);
    console.warn(`[EditorUpdater] ⚠️ Proceeding with update anyway (editor might not be fully ready)`);

    // Do a final check to see if at least .cm-content exists
    const cmContent = document.querySelector('.cm-content');
    if (cmContent) {
      console.log(`[EditorUpdater] ⚠️ .cm-content found, will attempt update`);
      return true;
    }

    console.error(`[EditorUpdater] ❌ .cm-content not found, update will likely fail`);
    return false;
  }

  /**
   * Get the current open document ID
   */
  private getCurrentDocId(): string | null {
    // Method 1: Check the recorded docId from joinDoc events
    const recordedDocId = (window as any)[CURRENT_DOC_ID_KEY];
    if (recordedDocId) {
      console.log(`[EditorUpdater] 🔍 Current docId from joinDoc event: ${recordedDocId}`);
      return recordedDocId;
    }

    // Method 2: Try documentManager (older Overleaf versions)
    try {
      const currentDoc = (window as any).editor?.documentManager?.getCurrentDoc();
      if (currentDoc?._id) {
        console.log(`[EditorUpdater] 🔍 Current docId from documentManager: ${currentDoc._id}`);
        return currentDoc._id;
      }
    } catch (e) {
      // Ignore errors
    }

    // Method 3: Try from React state / editor store (newer Overleaf versions)
    try {
      const editorState = (window as any).__overleaf_editor_state__;
      if (editorState?.doc_id) {
        console.log(`[EditorUpdater] 🔍 Current docId from __overleaf_editor_state__: ${editorState.doc_id}`);
        return editorState.doc_id;
      }
    } catch (e) {
      // Ignore errors
    }

    // Method 4: Extract from URL (doesn't work with new Overleaf UI)
    try {
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
   * Ensure document is opened and editor is ready
   * This method checks if the document is already open (by URL) and opens it if not
   *
   * @param docId - Document ID to open
   * @returns true if document is open and editor is ready
   */
  private async ensureDocumentOpened(docId: string): Promise<boolean> {
    console.log(`[EditorUpdater] 🔔 Ensuring document is opened: ${docId}`);

    // Check if document is already open by inspecting URL
    const urlMatch = window.location.href.match(/doc\/([a-f0-9]{24})/);
    const currentDocIdFromUrl = urlMatch ? urlMatch[1] : null;

    if (currentDocIdFromUrl === docId) {
      console.log(`[EditorUpdater] ✅ Document already open (from URL): ${docId}`);
    } else {
      console.log(`[EditorUpdater] 📂 Document not open, switching... (current: ${currentDocIdFromUrl}, target: ${docId})`);

      // Set up event listener BEFORE clicking the file
      const joinDocPromise = this.waitForJoinDocEvent(docId, 10000);

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
      console.log(`[EditorUpdater] ✅ joinDoc event received`);
    }

    // Wait for CodeMirror to be truly ready
    console.log(`[EditorUpdater] ⏳ Waiting for CodeMirror to be ready...`);
    const isReady = await this.waitForEditorReady();

    if (!isReady) {
      console.error(`[EditorUpdater] ❌ CodeMirror editor failed to initialize`);
      return false;
    }

    console.log(`[EditorUpdater] ✅ Document opened and editor ready`);
    return true;
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

    // Wait for the click to take effect and Overleaf to send joinDoc event
    // For newly created files, Overleaf may need more time to complete the switch
    // especially if it just auto-joined and left the document during creation
    await this.sleep(1500);
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

      // 🔧 NEW: Check if document is already open (handles the case where Overleaf auto-joined during file creation)
      const checkIfAlreadyOpen = () => {
        const currentDocId = this.getCurrentDocId();
        if (currentDocId === targetDocId) {
          console.log(`[EditorUpdater] ✅ Document already open: ${targetDocId}`);
          cleanup();
          resolve();
          return true;
        }
        return false;
      };

      // Check immediately
      if (checkIfAlreadyOpen()) {
        return;
      }

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
            resolve();
          }
        }
      };

      // Add event listener
      window.addEventListener('message', eventListener);

      // 🔧 NEW: Poll for document being already open (handles race conditions)
      // Check every 100ms for the first 1 second
      let pollCount = 0;
      const maxPolls = 10; // 1 second total (10 * 100ms)
      const pollInterval = setInterval(() => {
        pollCount++;
        if (checkIfAlreadyOpen()) {
          clearInterval(pollInterval);
          clearTimeout(timeoutId);
        } else if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          // Continue waiting for event or timeout
        }
      }, 100);
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
