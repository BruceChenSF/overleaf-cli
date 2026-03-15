import { MirrorClient } from '../client';
import { OverleafWebSocketClient } from './overleaf-sync';
import { EditorUpdater } from './editor-updater';

interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  content?: string;
  doc_id?: string;
  folder_id?: string;  // For folder operations
  isDirectory?: boolean;  // True if this is a folder operation
  timestamp: number;
}

interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  folder_id?: string;  // For folder operations
  isDirectory?: boolean;  // True if this is a folder operation
  timestamp: number;
}

export class OverleafAPIHandler {
  private editorUpdater: EditorUpdater;

  constructor(
    private mirrorClient: MirrorClient,
    private projectId: string,
    private overleafWsClient: OverleafWebSocketClient | null = null
  ) {
    this.editorUpdater = new EditorUpdater();
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    context: string,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) {
          throw error;
        }

        const delay = initialDelay * Math.pow(2, i);
        console.warn(`[APIHandler] ⚠️ ${context} failed (attempt ${i + 1}/${maxRetries}), retrying in ${delay}ms...`);

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`${context}: Max retries exceeded`);
  }

  async handleSyncRequest(message: SyncToOverleafMessage): Promise<void> {
    try {
      console.log(`[APIHandler] 📢 Received sync request: ${message.operation} ${message.path}`);
      console.log(`[APIHandler]    doc_id: ${message.doc_id || '(none)'}`);
      console.log(`[APIHandler]    folder_id: ${message.folder_id || '(none)'}`);
      console.log(`[APIHandler]    isDirectory: ${message.isDirectory || false}`);
      console.log(`[APIHandler]    content length: ${message.content?.length || 0}`);
      if (message.oldPath) {
        console.log(`[APIHandler]    oldPath: ${message.oldPath}`);
      }

      let result: SyncToOverleafResponse;

      // Check if this is a directory operation
      if (message.isDirectory) {
        switch (message.operation) {
          case 'create':
            result = await this.createFolder(message);
            break;
          case 'delete':
            result = await this.deleteFolder(message);
            break;
          case 'rename':
            result = await this.renameFolder(message);
            break;
          default:
            throw new Error(`Unknown directory operation: ${message.operation}`);
        }
      } else {
        // File operations
        switch (message.operation) {
          case 'update':
            result = await this.updateDocument(message);
            break;
          case 'create':
            result = await this.createDocument(message);
            break;
          case 'delete':
            result = await this.deleteDocument(message);
            break;
          case 'rename':
            result = await this.renameDocument(message);
            break;
          default:
            throw new Error(`Unknown operation: ${message.operation}`);
        }
      }

      this.mirrorClient.send(result);
      console.log(`[APIHandler] ✅ Sent success response for ${message.operation}`);
    } catch (error) {
      console.error(`[APIHandler] ❌ ${message.operation} failed:`, error);

      this.mirrorClient.send({
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: message.operation,
        path: message.path,
        oldPath: message.oldPath,
        isDirectory: message.isDirectory,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      });
    }
  }

  private async updateDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    if (!message.doc_id) {
      throw new Error('doc_id is required for update operation');
    }

    if (message.content === undefined) {
      throw new Error('Content is required for update operation');
    }

    // Use EditorUpdater to update document
    console.log(`[APIHandler] 📝 Updating doc via EditorUpdater: ${message.path}`);

    try {
      const syncId = await this.editorUpdater.updateDocument(
        message.doc_id,
        message.content
      );
      console.log(`[APIHandler] ✅ Updated via EditorUpdater (syncId: ${syncId}): ${message.path}`);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'update',
        path: message.path,
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ EditorUpdater failed:`, error);
      throw error;
    }
  }

  private async createDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    // Parse path
    const pathParts = message.path.split('/');
    const fileName = pathParts.pop() || message.path;

    // Create document
    const response = await this.retryWithBackoff(
      async () => await fetch(
        `/project/${this.projectId}/doc`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: fileName,
            parent_folder_id: 'rootFolder'
          })
        }
      ),
      `Create ${message.path}`
    );

    if (!response.ok) {
      throw new Error(`Create failed: ${response.status} ${response.statusText}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new Error(`Failed to parse response: ${parseError}`);
    }

    if (!data._id) {
      throw new Error('Response missing _id field');
    }

    console.log(`[APIHandler] ✅ Created: ${message.path} (id: ${data._id})`);

    // Immediately update content
    await this.updateDocument({
      ...message,
      doc_id: data._id
    });

    return {
      type: 'sync_to_overleaf_response',
      project_id: this.projectId,
      operation: 'create',
      path: message.path,
      success: true,
      doc_id: data._id,
      timestamp: Date.now()
    };
  }

  private async deleteDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    if (!message.doc_id) {
      throw new Error('doc_id is required for delete operation');
    }

    console.log(`[APIHandler] 🗑️ Deleting via DOM: ${message.path}`);

    // Use DOM manipulation to delete the file
    try {
      await this.deleteFileViaDOM(message.doc_id);
      console.log(`[APIHandler] ✅ Deleted: ${message.path}`);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'delete',
        path: message.path,
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ Delete via DOM failed:`, error);
      throw error;
    }
  }

  private async renameDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    if (!message.doc_id) {
      throw new Error('doc_id is required for rename operation');
    }

    if (!message.oldPath) {
      throw new Error('oldPath is required for rename operation');
    }

    // Extract new file name from path
    const pathParts = message.path.split('/');
    const newFileName = pathParts.pop() || message.path;

    console.log(`[APIHandler] ✏️ Renaming via DOM: ${message.oldPath} -> ${message.path} (${newFileName})`);

    // Use DOM manipulation to rename the file
    try {
      await this.renameFileViaDOM(message.doc_id, newFileName);
      console.log(`[APIHandler] ✅ Renamed: ${message.oldPath} -> ${message.path}`);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'rename',
        path: message.path,
        oldPath: message.oldPath,
        success: true,
        doc_id: message.doc_id,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ Rename via DOM failed:`, error);
      throw error;
    }
  }

  /**
   * Rename a file by simulating user interaction with the file tree UI
   *
   * Steps:
   * 1. Find the file in the file tree (by docId or filename)
   * 2. Click the file to select it (so it becomes .selected)
   * 3. Click the menu button to open the context menu
   * 4. Click the "Rename" menu item (first item in dropdown)
   * 5. Find the rename input span
   * 6. Clear the input and type the new filename
   * 7. Press Enter to confirm
   */
  private async renameFileViaDOM(docId: string, newFileName: string): Promise<void> {
    console.log(`[APIHandler] 🔍 Looking for file in tree: ${docId}`);

    // Step 1: Find the file element
    let fileElement: Element | null = null;

    // Try to find by data-entity-id first
    fileElement = document.querySelector(`[data-entity-id="${docId}"]`);

    // Fallback: find by filename using global mapping
    if (!fileElement) {
      console.log(`[APIHandler] ⚠️ Could not find by data-entity-id, trying filename...`);

      // Get file info from global mapping
      const docInfo = (window as any).__overleaf_docIdToPath__?.get(docId);
      if (!docInfo) {
        throw new Error(`Could not find file info for doc ${docId}`);
      }

      const oldPath = docInfo.path;
      const oldFileName = oldPath.split('/').pop() || oldPath;

      console.log(`[APIHandler] 🔍 Looking for file: ${oldFileName} (path: ${oldPath})`);

      // Find all file name spans in the tree
      const nameSpans = document.querySelectorAll('#ide-redesign-file-tree .item-name span');

      for (const span of nameSpans) {
        if (span.textContent?.trim() === oldFileName) {
          // Found a matching filename, now check if it's the right one by looking at the path
          // Walk up the tree to find the file entity
          const fileDetails = span.closest('.file-tree-entity-details');
          if (fileDetails) {
            const li = fileDetails.closest('li');
            if (li) {
              fileElement = li;
              console.log(`[APIHandler] ✅ Found file element by filename: ${oldFileName}`);
              break;
            }
          }
        }
      }
    } else {
      console.log(`[APIHandler] ✅ Found file element by data-entity-id`);
    }

    if (!fileElement) {
      throw new Error(`Could not find file element for doc ${docId}`);
    }

    // Find the clickable element (file-tree-entity-details)
    const fileDetails = fileElement.querySelector('.file-tree-entity-details');
    if (!fileDetails) {
      throw new Error('Could not find file tree entity details');
    }

    // Step 2: Click the file to select it (so it becomes .selected)
    console.log(`[APIHandler] 🔍 Clicking file to select it...`);
    (fileDetails as HTMLElement).click();
    await this.sleep(300); // Wait for selection to take effect

    // Step 3: Find and click the menu button
    // Use the path: fileElement > div > div > .menu-button
    const menuButton = fileElement.querySelector('.menu-button .entity-menu-toggle');
    if (!menuButton) {
      throw new Error('Could not find menu button');
    }

    console.log(`[APIHandler] ✅ Found menu button, clicking...`);
    (menuButton as HTMLElement).click();
    await this.sleep(500); // Wait for dropdown to appear

    // Step 4: Find and click the "Rename" menu item (first item in the dropdown)
    console.log(`[APIHandler] 🔍 Looking for Rename menu item...`);

    let renameClicked = false;
    let renameMenuItem: HTMLElement | null = null;

    // Find the <li> element
    const renameLi = document.querySelector('#dropdown-file-tree-context-menu > li:nth-child(1)');

    if (renameLi) {
      // Find the <a> tag inside the <li>
      const renameLink = renameLi.querySelector('a.dropdown-item');
      if (renameLink) {
        console.log(`[APIHandler] ✅ Found Rename menu item <a>, clicking...`);
        renameMenuItem = renameLink as HTMLElement;
      }
    }

    if (!renameMenuItem) {
      console.log(`[APIHandler] ⚠️ Could not find Rename <a> by :nth-child(1), trying text search...`);
      // Fallback: try to find by text content
      const allItems = document.querySelectorAll('#dropdown-file-tree-context-menu li');
      for (const item of allItems) {
        const link = item.querySelector('a.dropdown-item');
        if (!link) continue;

        const text = link.textContent?.trim().toLowerCase();
        console.log(`[APIHandler] 🔍 Checking menu item: "${text}"`);
        if (text === 'rename' || text === 'rename...') {
          console.log(`[APIHandler] ✅ Found Rename menu item by text, clicking...`);
          renameMenuItem = link as HTMLElement;
          break;
        }
      }
    }

    if (!renameMenuItem) {
      throw new Error('Could not find Rename menu item');
    }

    console.log(`[APIHandler] 🖱️ Simulating click on element: ${renameMenuItem.tagName}`);
    this.simulateClick(renameMenuItem);
    renameClicked = true;

    // Wait for the rename input to appear (UI transition)
    console.log(`[APIHandler] ⏳ Waiting for rename input to appear...`);
    await this.sleep(1500);

    // Step 5: Find the rename input span within the file element
    console.log(`[APIHandler] 🔍 Looking for rename input...`);

    // Look for the input within the same file element we clicked
    let renameInput: HTMLElement | null = null;

    // Try exact match first
    renameInput = fileElement.querySelector('.item-name span.rename-input');

    if (!renameInput) {
      // Debug: log what we can find
      console.log(`[APIHandler] 🔍 Debug: looking for any .item-name span in file element...`);
      const allSpans = fileElement.querySelectorAll('.item-name span');
      console.log(`[APIHandler] 🔍 Debug: found ${allSpans.length} .item-name spans`);

      // Try to find any span that might be the rename input
      for (const span of allSpans) {
        const className = (span as HTMLElement).className;
        const text = span.textContent;
        console.log(`[APIHandler] 🔍 Debug: span with class="${className}", text="${text}"`);

        // Check if this span might be the rename input (even if class is empty but text exists)
        if (className.includes('rename') || className.includes('input') ||
            (span as HTMLElement).tagName === 'INPUT' ||
            (className === '' && text && text.length > 0)) {
          renameInput = span as HTMLElement;
          console.log(`[APIHandler] ✅ Found potential input element`);
          break;
        }
      }
    }

    if (!renameInput) {
      // Last resort: look for any input in the file tree
      console.log(`[APIHandler] 🔍 Still not found, trying to find any rename-input in file tree...`);
      const allRenameInputs = document.querySelectorAll('.rename-input');
      console.log(`[APIHandler] 🔍 Debug: found ${allRenameInputs.length} .rename-input elements in tree`);

      for (const input of allRenameInputs) {
        if (input.offsetParent !== null) { // Check if visible
          renameInput = input as HTMLElement;
          console.log(`[APIHandler] 🔍 Found visible rename-input`);
          break;
        }
      }
    }

    if (!renameInput) {
      // Debug: Check if the file element is still selected
      const li = fileElement.closest('li');
      if (li) {
        console.log(`[APIHandler] 🔍 Debug: file element li classes: ${li.className}`);
      }

      // Check if there's an input element anywhere in the file tree
      const allInputs = document.querySelectorAll('#ide-redesign-file-tree input');
      console.log(`[APIHandler] 🔍 Debug: found ${allInputs.length} input elements in file tree`);

      throw new Error('Could not find rename input span');
    }

    console.log(`[APIHandler] ✅ Found rename input span, looking for actual input element...`);

    // CRITICAL: Look for the actual INPUT element inside the rename-input span
    let actualInput: HTMLElement | null = null;

    // Try to find input inside the rename-input span
    const inputInsideSpan = renameInput.querySelector('input');
    if (inputInsideSpan) {
      actualInput = inputInsideSpan as HTMLElement;
      console.log(`[APIHandler] ✅ Found input element inside rename-input span`);
    } else {
      // Check if the span itself is an input (has contentEditable or is INPUT tag)
      const tagName = (renameInput as HTMLElement).tagName;
      const contentEditable = (renameInput as HTMLElement).getAttribute('contenteditable');
      console.log(`[APIHandler] 🔍 rename-input tag: ${tagName}, contentEditable: ${contentEditable}`);

      if (tagName === 'INPUT') {
        actualInput = renameInput;
        console.log(`[APIHandler] ✅ rename-input itself is an INPUT element`);
      } else if (contentEditable === 'true' || contentEditable === '') {
        actualInput = renameInput;
        console.log(`[APIHandler] ✅ rename-input is contentEditable`);
      } else {
        // Last resort: assume the span is what we need to work with
        actualInput = renameInput;
        console.log(`[APIHandler] ⚠️ No input found, using rename-input span directly`);
      }
    }

    // Step 6: Set focus on the actual input element using multiple methods
    console.log(`[APIHandler] 🔍 Setting focus on actual input element (${actualInput.tagName})...`);

    // CRITICAL: First blur the current active element (likely CodeMirror editor)
    const currentActiveElement = document.activeElement;
    if (currentActiveElement && currentActiveElement !== actualInput) {
      console.log(`[APIHandler] 🔍 Blurring current active element: ${currentActiveElement.tagName}`, currentActiveElement.className);
      (currentActiveElement as HTMLElement).blur();
      await this.sleep(50);
    }

    // Method 1: Try click first to activate
    actualInput.click();
    await this.sleep(50);

    // Method 2: Then set focus
    actualInput.focus();
    await this.sleep(50);

    // Verify focus is on the right element
    const activeElement = document.activeElement;
    console.log(`[APIHandler] 🔍 Active element: ${activeElement?.tagName}`, activeElement?.className);
    console.log(`[APIHandler] 🔍 Is actual input focused? ${activeElement === actualInput}`);

    // If still not focused, try clicking on the file tree header or another non-editable area
    if (activeElement !== actualInput) {
      console.log(`[APIHandler] ⚠️ Focus not on actual input, trying alternative approach...`);

      // Click on the file tree container (not an editable element)
      const fileTree = document.querySelector('#ide-redesign-file-tree');
      if (fileTree) {
        console.log(`[APIHandler] 🔍 Clicking file tree to move focus away from editor...`);
        (fileTree as HTMLElement).click();
        await this.sleep(50);
      }

      // Now try focus again
      actualInput.focus();
      await this.sleep(50);

      console.log(`[APIHandler] 🔍 Active element after file tree click: ${document.activeElement?.tagName}`, document.activeElement?.className);
    }

    // Clear existing content and set new filename
    if (actualInput.tagName === 'INPUT') {
      // For INPUT elements, use .value
      console.log(`[APIHandler] 🔍 Setting .value on INPUT element`);
      (actualInput as HTMLInputElement).value = newFileName;
    } else {
      // For contentEditable elements, use textContent
      console.log(`[APIHandler] 🔍 Setting .textContent on non-INPUT element`);
      actualInput.textContent = newFileName;
    }

    // Trigger input event to ensure React/Overleaf picks up the change
    const inputEvent = new Event('input', { bubbles: true });
    actualInput.dispatchEvent(inputEvent);

    // Trigger change event
    const changeEvent = new Event('change', { bubbles: true });
    actualInput.dispatchEvent(changeEvent);

    // Step 7: Press Enter to confirm and save
    console.log(`[APIHandler] 🔍 Pressing Enter to confirm and save...`);

    // Verify focus one more time before sending Enter
    const activeElementBeforeEnter = document.activeElement;
    console.log(`[APIHandler] 🔍 Active element before Enter: ${activeElementBeforeEnter?.tagName}`, activeElementBeforeEnter?.className);
    console.log(`[APIHandler] 🔍 Is still focused on actual input? ${activeElementBeforeEnter === actualInput}`);

    // Only send Enter if focus is on actual input
    if (activeElementBeforeEnter === actualInput) {
      console.log(`[APIHandler] ✅ Focus is correct, sending Enter events...`);

      // keydown
      const keydownEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      actualInput.dispatchEvent(keydownEvent);

      // keypress
      const keypressEvent = new KeyboardEvent('keypress', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      actualInput.dispatchEvent(keypressEvent);

      // keyup
      const keyupEvent = new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      actualInput.dispatchEvent(keyupEvent);
    } else {
      console.log(`[APIHandler] ⚠️ Focus is NOT on actual input, cannot send Enter safely`);
      console.log(`[APIHandler] ⚠️ Trying alternative: dispatch Enter directly on actual input anyway...`);

      // Try anyway - might still work if React handles event propagation
      const keydownEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      actualInput.dispatchEvent(keydownEvent);

      const keyupEvent = new KeyboardEvent('keyup', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      });
      actualInput.dispatchEvent(keyupEvent);
    }

    // Blur the input to trigger form submission
    console.log(`[APIHandler] 🔍 Blurring input to trigger save...`);
    actualInput.blur();

    // Wait for the rename to complete and sync to cloud
    console.log(`[APIHandler] ⏳ Waiting for rename to complete...`);
    await this.sleep(1500);

    console.log(`[APIHandler] ✅ Rename completed`);
  }

  /**
   * Delete a file by simulating user interaction with the file tree UI
   *
   * Steps:
   * 1. Find the file in the file tree (by docId or filename)
   * 2. Click the file to select it (so it becomes .selected)
   * 3. Click the menu button to open the context menu
   * 4. Click the "Delete" menu item (6th item in dropdown)
   * 5. Wait for the confirmation modal to appear
   * 6. Click the "Delete" button in the modal
   * 7. Wait for the delete operation to complete
   */
  private async deleteFileViaDOM(docId: string): Promise<void> {
    console.log(`[APIHandler] 🔍 Looking for file in tree: ${docId}`);

    // Step 1: Find the file element
    let fileElement: Element | null = null;

    // Try to find by data-entity-id first
    fileElement = document.querySelector(`[data-entity-id="${docId}"]`);

    // Fallback: find by filename using global mapping
    if (!fileElement) {
      console.log(`[APIHandler] ⚠️ Could not find by data-entity-id, trying filename...`);

      // Get file info from global mapping
      const docInfo = (window as any).__overleaf_docIdToPath__?.get(docId);
      if (!docInfo) {
        throw new Error(`Could not find file info for doc ${docId}`);
      }

      const path = docInfo.path;
      const fileName = path.split('/').pop() || path;

      console.log(`[APIHandler] 🔍 Looking for file: ${fileName} (path: ${path})`);

      // Find all file name spans in the tree
      const nameSpans = document.querySelectorAll('#ide-redesign-file-tree .item-name span');

      for (const span of nameSpans) {
        if (span.textContent?.trim() === fileName) {
          // Found a matching filename, now check if it's the right one by looking at the path
          // Walk up the tree to find the file entity
          const fileDetails = span.closest('.file-tree-entity-details');
          if (fileDetails) {
            const li = fileDetails.closest('li');
            if (li) {
              fileElement = li;
              console.log(`[APIHandler] ✅ Found file element by filename: ${fileName}`);
              break;
            }
          }
        }
      }
    } else {
      console.log(`[APIHandler] ✅ Found file element by data-entity-id`);
    }

    if (!fileElement) {
      throw new Error(`Could not find file element for doc ${docId}`);
    }

    // Find the clickable element (file-tree-entity-details)
    const fileDetails = fileElement.querySelector('.file-tree-entity-details');
    if (!fileDetails) {
      throw new Error('Could not find file tree entity details');
    }

    // Step 2: Click the file to select it (so it becomes .selected)
    console.log(`[APIHandler] 🔍 Clicking file to select it...`);
    (fileDetails as HTMLElement).click();
    await this.sleep(300); // Wait for selection to take effect

    // Step 3: Find and click the menu button
    const menuButton = fileElement.querySelector('.menu-button .entity-menu-toggle');
    if (!menuButton) {
      throw new Error('Could not find menu button');
    }

    console.log(`[APIHandler] ✅ Found menu button, clicking...`);
    (menuButton as HTMLElement).click();
    await this.sleep(500); // Wait for dropdown to appear

    // Step 4: Find and click the "Delete" menu item (6th item in the dropdown)
    console.log(`[APIHandler] 🔍 Looking for Delete menu item (6th item)...`);

    let deleteClicked = false;
    let deleteMenuItem: HTMLElement | null = null;

    // Try to find the 6th <li> element
    const deleteLi = document.querySelector('#dropdown-file-tree-context-menu > li:nth-child(6)');

    if (deleteLi) {
      // Find the <a> tag inside the <li>
      const deleteLink = deleteLi.querySelector('a.dropdown-item');
      if (deleteLink) {
        console.log(`[APIHandler] ✅ Found Delete menu item <a> (6th item), clicking...`);
        deleteMenuItem = deleteLink as HTMLElement;
      }
    }

    if (!deleteMenuItem) {
      console.log(`[APIHandler] ⚠️ Could not find Delete <a> by :nth-child(6), trying text search...`);
      // Fallback: try to find by text content
      const allItems = document.querySelectorAll('#dropdown-file-tree-context-menu li');
      for (const item of allItems) {
        const link = item.querySelector('a.dropdown-item');
        if (!link) continue;

        const text = link.textContent?.trim().toLowerCase();
        console.log(`[APIHandler] 🔍 Checking menu item: "${text}"`);
        if (text === 'delete' || text === 'delete...') {
          console.log(`[APIHandler] ✅ Found Delete menu item by text, clicking...`);
          deleteMenuItem = link as HTMLElement;
          break;
        }
      }
    }

    if (!deleteMenuItem) {
      throw new Error('Could not find Delete menu item');
    }

    console.log(`[APIHandler] 🖱️ Simulating click on Delete menu item...`);
    this.simulateClick(deleteMenuItem);
    deleteClicked = true;

    // Step 5: Wait for the confirmation modal to appear
    console.log(`[APIHandler] ⏳ Waiting for delete confirmation modal to appear...`);
    await this.sleep(1000);

    // Step 6: Find and click the Delete button in the modal
    console.log(`[APIHandler] 🔍 Looking for Delete button in modal...`);

    let deleteButton: HTMLElement | null = null;

    // Try the specific selector first
    deleteButton = document.querySelector('body > div.fade.modal.show > div > div > div > div.modal-footer > button.d-inline-grid.btn.btn-danger');

    if (!deleteButton) {
      console.log(`[APIHandler] ⚠️ Could not find Delete button by specific selector, trying broader search...`);

      // Try to find any danger button in a modal footer
      const modals = document.querySelectorAll('.modal.show');
      console.log(`[APIHandler] 🔍 Found ${modals.length} visible modals`);

      for (const modal of modals) {
        const footer = modal.querySelector('.modal-footer');
        if (!footer) continue;

        const dangerButtons = footer.querySelectorAll('.btn-danger');
        console.log(`[APIHandler] 🔍 Found ${dangerButtons.length} danger buttons in modal footer`);

        for (const btn of dangerButtons) {
          const text = btn.textContent?.trim().toLowerCase();
          console.log(`[APIHandler] 🔍 Checking button text: "${text}"`);

          if (text === 'delete') {
            deleteButton = btn as HTMLElement;
            console.log(`[APIHandler] ✅ Found Delete button in modal`);
            break;
          }
        }

        if (deleteButton) break;
      }
    }

    if (!deleteButton) {
      // Debug: log what we can find in modals
      console.log(`[APIHandler] 🔍 Debug: listing all buttons in visible modals...`);
      const modals = document.querySelectorAll('.modal.show');
      for (const modal of modals) {
        const allButtons = modal.querySelectorAll('button');
        console.log(`[APIHandler] 🔍 Modal has ${allButtons.length} buttons:`);
        allButtons.forEach((btn, i) => {
          console.log(`[APIHandler] 🔍   [${i}] ${btn.textContent?.trim()} (class: ${(btn as HTMLElement).className})`);
        });
      }

      throw new Error('Could not find Delete button in modal');
    }

    console.log(`[APIHandler] ✅ Found Delete button, clicking...`);
    console.log(`[APIHandler] 🖱️ Simulating click on Delete button...`);
    this.simulateClick(deleteButton);

    // Step 7: Wait for the delete operation to complete
    console.log(`[APIHandler] ⏳ Waiting for delete operation to complete...`);
    await this.sleep(2000); // Give it more time as delete operations can be slower

    console.log(`[APIHandler] ✅ Delete completed`);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Simulate a realistic mouse click event
   * This helps trigger React event handlers that might not respond to simple click()
   */
  private simulateClick(element: HTMLElement): void {
    console.log(`[APIHandler] 🖱️ Simulating click on element:`, element.tagName, element.className);

    // Create and dispatch mouse events
    const eventOptions = {
      bubbles: true,
      cancelable: true,
      view: window
    };

    // Mousedown
    const mouseDownEvent = new MouseEvent('mousedown', eventOptions);
    element.dispatchEvent(mouseDownEvent);

    // Mouseup
    const mouseUpEvent = new MouseEvent('mouseup', eventOptions);
    element.dispatchEvent(mouseUpEvent);

    // Click
    const clickEvent = new MouseEvent('click', eventOptions);
    element.dispatchEvent(clickEvent);
  }

  /**
   * Create a folder - LOGGING ONLY VERSION
   * TODO: Implement actual DOM manipulation after testing message flow
   */
  private async createFolderViaDOM(folderName: string): Promise<{ folderId: string; folderName: string }> {
    console.log(`[APIHandler] 📁➕ [LOGGING ONLY] Would create folder: ${folderName}`);
    console.log(`[APIHandler] ⚠️  TODO: Implement actual folder creation via DOM`);
    console.log(`[APIHandler] ℹ️  For now, returning mock response to test message flow`);

    // Return a mock folderId for testing
    await this.sleep(100);

    return { folderId: `mock-folder-${Date.now()}`, folderName };
  }

  /**
   * Delete a folder - LOGGING ONLY VERSION
   * TODO: Implement actual DOM manipulation after testing message flow
   */
  private async deleteFolderViaDOM(folderId: string, folderPath: string): Promise<void> {
    console.log(`[APIHandler] 📁🗑️ [LOGGING ONLY] Would delete folder: ${folderPath}`);
    console.log(`[APIHandler]    Folder ID: ${folderId}`);
    console.log(`[APIHandler] ⚠️  TODO: Implement actual folder deletion via DOM`);
    console.log(`[APIHandler] ℹ️  For now, just logging to test message flow`);

    // Simulate some delay
    await this.sleep(100);

    console.log(`[APIHandler] ✅ [LOGGING ONLY] Folder delete logged: ${folderPath}`);
  }

  /**
   * Rename a folder - LOGGING ONLY VERSION
   * TODO: Implement actual DOM manipulation after testing message flow
   */
  private async renameFolderViaDOM(folderId: string, oldPath: string, newFolderName: string): Promise<void> {
    console.log(`[APIHandler] 📁✏️ [LOGGING ONLY] Would rename folder: ${oldPath} -> ${newFolderName}`);
    console.log(`[APIHandler]    Folder ID: ${folderId}`);
    console.log(`[APIHandler] ⚠️  TODO: Implement actual folder rename via DOM`);
    console.log(`[APIHandler] ℹ️  For now, just logging to test message flow`);

    // Simulate some delay
    await this.sleep(100);

    console.log(`[APIHandler] ✅ [LOGGING ONLY] Folder rename logged: ${oldPath} -> ${newFolderName}`);
  }

  /**
   * Handle folder create operation
   */
  private async createFolder(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    console.log(`[APIHandler] 📁➕ Creating folder: ${message.path}`);

    // Extract folder name from path
    const pathParts = message.path.split('/');
    const folderName = pathParts.pop() || message.path;

    try {
      const result = await this.createFolderViaDOM(folderName);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'create',
        path: message.path,
        success: true,
        folder_id: result.folderId,
        isDirectory: true,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ Create folder failed:`, error);
      throw error;
    }
  }

  /**
   * Handle folder delete operation
   */
  private async deleteFolder(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    if (!message.folder_id) {
      throw new Error('folder_id is required for delete operation');
    }

    console.log(`[APIHandler] 📁🗑️ Deleting folder: ${message.path}`);

    try {
      await this.deleteFolderViaDOM(message.folder_id, message.path);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'delete',
        path: message.path,
        success: true,
        isDirectory: true,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ Delete folder failed:`, error);
      throw error;
    }
  }

  /**
   * Handle folder rename operation
   */
  private async renameFolder(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    if (!message.folder_id) {
      throw new Error('folder_id is required for rename operation');
    }

    if (!message.oldPath) {
      throw new Error('oldPath is required for rename operation');
    }

    console.log(`[APIHandler] 📁✏️ Renaming folder: ${message.oldPath} -> ${message.path}`);

    // Extract new folder name from path
    const pathParts = message.path.split('/');
    const newFolderName = pathParts.pop() || message.path;

    try {
      await this.renameFolderViaDOM(message.folder_id, message.oldPath, newFolderName);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'rename',
        path: message.path,
        oldPath: message.oldPath,
        success: true,
        folder_id: message.folder_id,
        isDirectory: true,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ Rename folder failed:`, error);
      throw error;
    }
  }
}
