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

/**
 * Queue for managing folder creation requests
 * Ensures folders are created in the correct order (parent before child)
 */
class FolderCreationQueue {
  private queue: Array<{
    message: SyncToOverleafMessage;
    resolve: (response: SyncToOverleafResponse) => void;
    reject: (error: Error) => void;
  }> = [];
  private processing = false;
  private createdFolders = new Set<string>(); // Track folders that have been successfully created

  /**
   * Get the depth of a path (number of segments)
   */
  private getPathDepth(path: string): number {
    return path.split('/').filter(p => p.length > 0).length;
  }

  /**
   * Get the parent path of a folder
   */
  private getParentPath(path: string): string {
    const parts = path.split('/').filter(p => p.length > 0);
    parts.pop(); // Remove the last component (the folder itself)
    return parts.join('/');
  }

  /**
   * Check if all parent folders have been created
   */
  private areParentsCreated(path: string): boolean {
    const parentPath = this.getParentPath(path);
    if (parentPath === '') {
      return true; // Root level, no parents
    }
    return this.createdFolders.has(parentPath);
  }

  /**
   * Mark a folder as created
   */
  markFolderCreated(path: string): void {
    this.createdFolders.add(path);
    console.log(`[FolderQueue] ✅ Marked folder as created: ${path}`);
    console.log(`[FolderQueue] 📁 Created folders: ${Array.from(this.createdFolders).join(', ')}`);
  }

  /**
   * Add a folder creation request to the queue
   */
  async enqueue(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    return new Promise((resolve, reject) => {
      this.queue.push({ message, resolve, reject });

      // Sort queue by path depth (shallowest first) to ensure parents are created before children
      this.queue.sort((a, b) => {
        const depthA = this.getPathDepth(a.message.path);
        const depthB = this.getPathDepth(b.message.path);
        return depthA - depthB;
      });

      console.log(`[FolderQueue] 📥 Enqueued folder creation: ${message.path} (depth: ${this.getPathDepth(message.path)})`);
      console.log(`[FolderQueue] 📊 Queue size: ${this.queue.length} (processing: ${this.processing})`);

      // Log current queue state for debugging
      console.log(`[FolderQueue] 📋 Current queue:`);
      this.queue.forEach((item, index) => {
        console.log(`[FolderQueue]    [${index}] ${item.message.path} (depth: ${this.getPathDepth(item.message.path)})`);
      });

      // Only start processing if not already processing
      if (!this.processing) {
        console.log(`[FolderQueue] 🚀 Starting queue processing`);
        this.processQueue();
      } else {
        console.log(`[FolderQueue] ⏸️ Queue is being processed, new task will be handled in order`);
      }
    });
  }

  /**
   * Process the queue sequentially
   */
  private async processQueue(): Promise<void> {
    // Prevent multiple queue processing runs
    if (this.processing) {
      console.log(`[FolderQueue] ⏸️ Queue already processing, skipping`);
      return;
    }

    if (this.queue.length === 0) {
      console.log(`[FolderQueue] 📭 Queue is empty, nothing to process`);
      return;
    }

    this.processing = true;
    console.log(`[FolderQueue] 🚀 Starting queue processing, ${this.queue.length} items in queue`);

    let processedCount = 0;
    // Increased limit significantly to handle delays in parent folder creation
    const maxIterations = this.queue.length * 10;
    let iteration = 0;

    while (this.queue.length > 0 && iteration < maxIterations) {
      iteration++;

      // Check if we can process the first item in the queue
      const firstItem = this.queue[0];
      if (!firstItem) break;

      const { message, resolve, reject } = firstItem;

      // Check if parent folders have been created
      if (!this.areParentsCreated(message.path)) {
        const parentPath = this.getParentPath(message.path);
        console.log(`[FolderQueue] ⏸️ Parent folder not ready for: ${message.path}`);
        console.log(`[FolderQueue]    Waiting for parent: ${parentPath || '(root)'}`);
        console.log(`[FolderQueue]    Created folders: ${Array.from(this.createdFolders).join(', ')}`);
        console.log(`[FolderQueue]    Iteration: ${iteration}/${maxIterations}`);

        // Check if parent is in the queue (will be processed before this one)
        const parentInQueue = this.queue.some(item => item.message.path === parentPath);

        if (parentInQueue) {
          console.log(`[FolderQueue]    ✅ Parent is in queue, will be processed first`);
          // Move to next iteration (keep this one in queue)
          // Don't count this as an iteration towards the limit, since we're just waiting
          iteration--;
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        } else {
          // Parent not in queue and not created
          // This means parent hasn't arrived yet - wait for it
          console.log(`[FolderQueue]    ⏳ Parent NOT in queue and not created`);
          console.log(`[FolderQueue]    🔮 Waiting for parent to arrive...`);

          // Wait a bit and check again
          await new Promise(resolve => setTimeout(resolve, 200));

          // Check again if parent arrived (might have been added while we were waiting)
          const parentStillNotInQueue = !this.queue.some(item => item.message.path === parentPath);

          if (parentStillNotInQueue && !this.createdFolders.has(parentPath)) {
            // After waiting, parent still not here
            // If this is root level, process it; otherwise fail
            if (parentPath === '') {
              console.log(`[FolderQueue]    ✅ Root level, no parent needed, processing...`);
            } else {
              // Check if we've waited long enough (e.g., 20 iterations * 200ms = 4 seconds)
              // We use a local counter for this specific wait
              const waitIterations = iteration - processedCount; // Approximate wait time

              if (waitIterations > 20) {
                console.log(`[FolderQueue]    ❌ Waited too long for parent (${waitIterations} iterations), giving up`);
                // Remove from queue and fail
                this.queue.shift();
                reject(new Error(`Parent folder "${parentPath}" did not arrive in time`));
                processedCount++; // Count this as processed (even though failed)
                continue;
              } else {
                console.log(`[FolderQueue]    ⏳ Still waiting... (wait iteration ${waitIterations}/20)`);
                // Don't count this as an iteration towards the limit
                iteration--;
                continue; // Keep waiting
              }
            }
          } else {
            console.log(`[FolderQueue]    ✅ Parent arrived while waiting!`);
            // Don't count this as an iteration towards the limit
            iteration--;
            continue; // Check again in next iteration
          }
        }
      }

      // Remove the item from queue (we're going to process it)
      this.queue.shift();

      console.log(`[FolderQueue] ⏳ Processing folder creation: ${message.path} (${this.queue.length} items remaining)`);

      try {
        const response = await this.processItem(message);
        resolve(response);

        // Mark this folder as created
        this.createdFolders.add(message.path);
        processedCount++;

        console.log(`[FolderQueue] ✅ Completed folder creation: ${message.path}`);
      } catch (error) {
        console.error(`[FolderQueue] ❌ Failed to create folder: ${message.path}`, error);
        reject(error as Error);
        processedCount++; // Count failed items as processed
      }
    }

    if (iteration >= maxIterations) {
      console.warn(`[FolderQueue] ⚠️ Reached max iterations (${maxIterations}), stopping to prevent infinite loop`);
      console.warn(`[FolderQueue] ⚠️ Remaining items in queue: ${this.queue.length}`);
      console.warn(`[FolderQueue] ⚠️ Processed ${processedCount} items successfully/with errors`);
    }

    console.log(`[FolderQueue] 🏁 Queue processing complete (${processedCount} items processed)`);
    this.processing = false;
  }

  /**
   * Process a single folder creation item
   * This will be implemented by the OverleafAPIHandler
   */
  private processItem(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    // This is a placeholder - the actual implementation will be provided by the handler
    throw new Error('FolderCreationQueue.processItem not implemented');
  }

  /**
   * Set the handler for processing individual folder creation requests
   */
  setProcessHandler(handler: (message: SyncToOverleafMessage) => Promise<SyncToOverleafResponse>): void {
    this.processItem = handler;
  }
}

export class OverleafAPIHandler {
  private editorUpdater: EditorUpdater;
  private folderQueue: FolderCreationQueue;

  constructor(
    private mirrorClient: MirrorClient,
    private projectId: string,
    private overleafWsClient: OverleafWebSocketClient | null = null
  ) {
    // Initialize EditorUpdater (sets up event listeners)
    EditorUpdater.initialize();

    this.editorUpdater = new EditorUpdater();
    this.folderQueue = new FolderCreationQueue();

    // Set the process handler for the folder queue
    this.folderQueue.setProcessHandler(async (message) => {
      return this.processFolderCreation(message);
    });
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
            // Use queue for folder creation to ensure proper ordering
            console.log(`[APIHandler] 📥 Adding folder creation to queue: ${message.path}`);
            result = await this.folderQueue.enqueue(message);
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
        timestamp: message.timestamp
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
        timestamp: message.timestamp
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ EditorUpdater failed:`, error);
      throw error;
    }
  }

  /**
   * Create a document via DOM manipulation
   *
   * Steps:
   * 1. Parse path to get file name and parent folder path
   * 2. If there's a parent folder, navigate to it
   * 3. Click the "New File" button (1st button in toolbar)
   * 4. Enter the file name in the modal input
   * 5. Click the confirm button to create the file
   *
   * @param message - Sync message containing file path and optional content
   * @returns Object containing the doc ID
   */
  private async createDocumentViaDOM(message: SyncToOverleafMessage): Promise<{ docId: string; fileName: string }> {
    // Parse path to get file name and parent folder path
    const pathParts = message.path.split('/');
    const fileName = pathParts.pop() || message.path;
    const parentPath = pathParts.join('/');

    console.log(`[APIHandler] 📄➕ Creating document via DOM: ${fileName}`);
    console.log(`[APIHandler]    Parent path: ${parentPath || '(root)'}`);
    console.log(`[APIHandler]    Content length: ${message.content?.length || 0}`);

    try {
      // Step 1: Navigate to the parent folder (if specified)
      if (parentPath) {
        console.log(`[APIHandler] 🔍 Navigating to parent folder: ${parentPath}`);
        await this.navigateToFolder(parentPath);
      } else {
        // Step 2: If no parent, click blank area to ensure we're at root
        console.log(`[APIHandler] 🔍 Clicking blank area to ensure root location`);
        await this.clickBlankArea();
      }

      // Step 3: Click the "New File" button (1st button in toolbar)
      console.log(`[APIHandler] 🔍 Clicking "New File" button`);
      const newFileButton = document.querySelector('#ide-redesign-file-tree > div > div.file-tree-toolbar > div > button:nth-child(1)');
      if (!newFileButton) {
        throw new Error('Could not find "New File" button');
      }

      this.simulateClick(newFileButton as HTMLElement);
      await this.sleep(500); // Wait for modal to appear

      // Step 4: Enter file name in the modal input
      console.log(`[APIHandler] 🔍 Entering file name: ${fileName}`);
      const fileNameInput = document.querySelector('#new-doc-name') as HTMLInputElement;
      if (!fileNameInput) {
        throw new Error('Could not find file name input');
      }

      fileNameInput.value = fileName;
      fileNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      fileNameInput.dispatchEvent(new Event('change', { bubbles: true }));
      await this.sleep(200);

      // Step 5: Click the confirm button
      console.log(`[APIHandler] 🔍 Clicking confirm button`);
      const confirmButton = document.querySelector('body > div.fade.modal.show > div > div > div > div.modal-footer > button.d-inline-grid.btn.btn-primary');
      if (!confirmButton) {
        throw new Error('Could not find confirm button');
      }

      this.simulateClick(confirmButton as HTMLElement);
      await this.sleep(2500); // Wait for file creation to complete

      console.log(`[APIHandler] ✅ File created successfully: ${fileName}`);

      // Wait for the file to appear in the DOM before proceeding
      console.log(`[APIHandler] ⏳ Waiting for file to appear in DOM: ${fileName}`);
      const fileFound = await this.waitForFileToAppear(fileName, parentPath, 10000);

      if (!fileFound) {
        console.warn(`[APIHandler] ⚠️ File ${fileName} did not appear in DOM after waiting, but will continue`);
      } else {
        console.log(`[APIHandler] ✅ File ${fileName} is now visible in DOM`);
      }

      // Try to find the newly created file to get its ID
      const docId = await this.findFileId(fileName, parentPath);

      // 🔧 NEW: If content is provided, update the file using EditorUpdater (DOM manipulation)
      if (message.content && message.content.length > 0 && this.editorUpdater) {
        console.log(`[APIHandler] 📝 File has content (${message.content.length} chars), updating via EditorUpdater...`);

        // Use EditorUpdater to update content (direct DOM manipulation, Overleaf auto-saves)
        try {
          await this.editorUpdater.updateDocument(docId, message.content);
          console.log(`[APIHandler] ✅ Updated via EditorUpdater: ${fileName}`);
          console.log(`[APIHandler] 📄 Content preview: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`);
        } catch (error) {
          console.error(`[APIHandler] ❌ EditorUpdater update failed:`, error);
          throw new Error(`Failed to update file content via EditorUpdater: ${error}`);
        }
      } else if (message.content && message.content.length > 0) {
        console.log(`[APIHandler] ⚠️ Content provided but no EditorUpdater, skipping update`);
      } else {
        console.log(`[APIHandler] ℹ️ File is empty, skipping content update`);
      }

      return { docId, fileName };
    } catch (error) {
      console.error(`[APIHandler] ❌ Failed to create file via DOM:`, error);
      throw error;
    }
  }

  /**
   * Create a document - DOM VERSION
   */
  private async createDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    try {
      const result = await this.createDocumentViaDOM(message);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'create',
        path: message.path,
        success: true,
        doc_id: result.docId,
        timestamp: message.timestamp
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ Create document failed:`, error);
      throw error;
    }
  }

  private async deleteDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    if (!message.doc_id) {
      throw new Error('doc_id is required for delete operation');
    }

    console.log(`[APIHandler] 🗑️ Deleting via DOM: ${message.path}`);

    // Use DOM manipulation to delete the file
    try {
      await this.deleteFileViaDOM(message.doc_id, message.path);
      console.log(`[APIHandler] ✅ Deleted: ${message.path}`);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'delete',
        path: message.path,
        success: true,
        timestamp: message.timestamp
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
        timestamp: message.timestamp
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
  private async deleteFileViaDOM(docId: string, fallbackPath?: string): Promise<void> {
    console.log(`[APIHandler] 🔍 Looking for file in tree: ${docId}`);

    // Step 1: Find the file element
    let fileElement: Element | null = null;

    // Try to find by data-entity-id first
    fileElement = document.querySelector(`[data-entity-id="${docId}"]`);

    // Fallback 1: find by filename using global mapping
    if (!fileElement) {
      console.log(`[APIHandler] ⚠️ Could not find by data-entity-id, trying filename...`);

      // Get file info from global mapping
      const docInfo = (window as any).__overleaf_docIdToPath__?.get(docId);
      if (docInfo) {
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
        console.log(`[APIHandler] ⚠️ Could not find doc info in global mapping`);
      }
    }

    // Fallback 2: use the provided fallbackPath to find by filename
    if (!fileElement && fallbackPath) {
      console.log(`[APIHandler] ⚠️ Trying fallback path: ${fallbackPath}`);

      const fileName = fallbackPath.split('/').pop() || fallbackPath;
      console.log(`[APIHandler] 🔍 Looking for file: ${fileName} (from fallback path)`);

      // Find all file name spans in the tree
      const nameSpans = document.querySelectorAll('#ide-redesign-file-tree .item-name span');

      for (const span of nameSpans) {
        if (span.textContent?.trim() === fileName) {
          // Found a matching filename
          const fileDetails = span.closest('.file-tree-entity-details');
          if (fileDetails) {
            const li = fileDetails.closest('li');
            if (li) {
              fileElement = li;
              console.log(`[APIHandler] ✅ Found file element by fallback filename: ${fileName}`);
              break;
            }
          }
        }
      }
    }

    if (!fileElement) {
      throw new Error(`Could not find file element for doc ${docId}`);
    } else {
      console.log(`[APIHandler] ✅ Found file element`);
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
   * Create a folder by simulating user interaction with the file tree UI
   *
   * Steps:
   * 1. If there's a parent path, click the parent folder to navigate into it
   * 2. Otherwise, click the blank area to ensure we're at the root
   * 3. Click the "New Folder" button (2nd button in toolbar)
   * 4. Enter the folder name in the modal input
   * 5. Click the confirm button to create the folder
   *
   * @param folderName - Name of the folder to create
   * @param parentPath - Path of the parent folder (empty string for root)
   * @returns Object containing the folder ID and name
   */
  private async createFolderViaDOM(folderName: string, parentPath: string): Promise<{ folderId: string; folderName: string }> {
    console.log(`[APIHandler] 📁➕ Creating folder via DOM: ${folderName}`);
    console.log(`[APIHandler]    Parent path: ${parentPath || '(root)'}`);

    try {
      // Step 1: Navigate to the parent folder (if specified)
      if (parentPath) {
        console.log(`[APIHandler] 🔍 Navigating to parent folder: ${parentPath}`);
        await this.navigateToFolder(parentPath);
      } else {
        // Step 2: If no parent, click blank area to ensure we're at root
        console.log(`[APIHandler] 🔍 Clicking blank area to ensure root location`);
        await this.clickBlankArea();
      }

      // Step 3: Click the "New Folder" button
      console.log(`[APIHandler] 🔍 Clicking "New Folder" button`);
      const newFolderButton = document.querySelector('#ide-redesign-file-tree > div > div.file-tree-toolbar > div > button:nth-child(2)');
      if (!newFolderButton) {
        throw new Error('Could not find "New Folder" button');
      }

      this.simulateClick(newFolderButton as HTMLElement);
      await this.sleep(500); // Wait for modal to appear

      // Step 4: Enter folder name in the modal input
      console.log(`[APIHandler] 🔍 Entering folder name: ${folderName}`);
      const folderNameInput = document.querySelector('#folder-name') as HTMLInputElement;
      if (!folderNameInput) {
        throw new Error('Could not find folder name input');
      }

      folderNameInput.value = folderName;
      folderNameInput.dispatchEvent(new Event('input', { bubbles: true }));
      folderNameInput.dispatchEvent(new Event('change', { bubbles: true }));
      await this.sleep(200);

      // Step 5: Click the confirm button
      console.log(`[APIHandler] 🔍 Clicking confirm button`);
      const confirmButton = document.querySelector('body > div.fade.modal.show > div > div > div > div.modal-footer > button.d-inline-grid.btn.btn-primary');
      if (!confirmButton) {
        throw new Error('Could not find confirm button');
      }

      this.simulateClick(confirmButton as HTMLElement);
      await this.sleep(2500); // Wait longer for folder creation to complete (increased from 1500ms)

      console.log(`[APIHandler] ✅ Folder created successfully: ${folderName}`);

      // Wait for the folder to appear in the DOM before proceeding
      console.log(`[APIHandler] ⏳ Waiting for folder to appear in DOM: ${folderName}`);
      // Increase max wait time to 10 seconds for nested folders
      const folderFound = await this.waitForFolderToAppear(folderName, parentPath, 10000);

      if (!folderFound) {
        console.warn(`[APIHandler] ⚠️ Folder ${folderName} did not appear in DOM after waiting, but will continue`);
      } else {
        console.log(`[APIHandler] ✅ Folder ${folderName} is now visible in DOM`);
      }

      // Try to find the newly created folder to get its ID
      const folderId = await this.findFolderId(folderName, parentPath);

      return { folderId, folderName };
    } catch (error) {
      console.error(`[APIHandler] ❌ Failed to create folder via DOM:`, error);
      throw error;
    }
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
   * Rename a folder by simulating user interaction with the file tree UI
   *
   * Steps:
   * 1. Find the folder in the file tree using findFolderByName
   * 2. Click the folder to select it (so it becomes .selected)
   * 3. Click the menu button to open the context menu
   * 4. Click the "Rename" menu item (first <a> tag in dropdown)
   * 5. Find the rename input span in li.selected
   * 6. Clear the input and type the new folder name
   * 7. Press Enter to confirm
   */
  private async renameFolderViaDOM(folderId: string, oldPath: string, newFolderName: string): Promise<void> {
    console.log(`[APIHandler] 📁✏️ Renaming folder: ${oldPath} -> ${newFolderName}`);
    console.log(`[APIHandler]    Folder ID: ${folderId}`);

    // Extract old folder name from path
    const oldFolderName = oldPath.split('/').pop() || oldPath;

    // Step 1: Find the folder element using findFolderByName
    console.log(`[APIHandler] 🔍 Looking for folder: ${oldFolderName}`);

    let folderElement = await this.findFolderByName(oldFolderName);

    if (!folderElement) {
      throw new Error(`Could not find folder element for folder: ${oldFolderName}`);
    }

    console.log(`[APIHandler] ✅ Found folder element: ${oldFolderName}`);

    // Step 2: Click the folder to select it (so it becomes .selected)
    console.log(`[APIHandler] 🔍 Clicking folder to select it...`);

    // Find the clickable element (try multiple methods)
    let clickTarget: HTMLElement | null = null;

    // Method 1: Try to find file-tree-entity-button
    clickTarget = folderElement.querySelector('.file-tree-entity-button') as HTMLElement;

    // Method 2: Try to find .entity-name
    if (!clickTarget) {
      clickTarget = folderElement.querySelector('.entity-name') as HTMLElement;
    }

    // Method 3: Try to find button
    if (!clickTarget) {
      clickTarget = folderElement.querySelector('button') as HTMLElement;
    }

    // Method 4: Use the li element itself
    if (!clickTarget) {
      clickTarget = folderElement as HTMLElement;
    }

    this.simulateClick(clickTarget);
    await this.sleep(500); // Wait for selection to take effect

    // Verify the folder is now selected
    const isSelected = folderElement.classList.contains('selected');
    console.log(`[APIHandler] 🔍 Folder selected: ${isSelected}`);

    // Step 3: Find and click the menu button
    const menuButton = folderElement.querySelector('.menu-button .entity-menu-toggle');
    if (!menuButton) {
      throw new Error('Could not find menu button for folder');
    }

    console.log(`[APIHandler] ✅ Found menu button, clicking...`);
    this.simulateClick(menuButton as HTMLElement);
    await this.sleep(500); // Wait for dropdown to appear

    // Step 4: Find and click the "Rename" menu item (first <a> tag)
    console.log(`[APIHandler] 🔍 Looking for Rename menu item...`);

    // Find the first <a> tag in the dropdown menu
    const renameLink = document.querySelector('#dropdown-file-tree-context-menu > li:nth-child(1) > a.dropdown-item');

    if (!renameLink) {
      throw new Error('Could not find Rename menu item (first <a> tag)');
    }

    console.log(`[APIHandler] ✅ Found Rename menu item, clicking...`);
    this.simulateClick(renameLink as HTMLElement);

    // Wait for the rename input to appear
    console.log(`[APIHandler] ⏳ Waiting for rename input to appear...`);
    await this.sleep(1500);

    // Step 5: Find the rename input in li.selected
    console.log(`[APIHandler] 🔍 Looking for rename input in li.selected...`);

    // For folders: button.file-tree-entity-button > span.rename-input > input
    // Try multiple selectors to find the rename input
    let actualInput: HTMLInputElement | null = null;

    // Method 1: Direct input in file-tree-entity-button (most specific)
    actualInput = folderElement.querySelector('.file-tree-entity-button input') as HTMLInputElement;
    if (actualInput) {
      console.log(`[APIHandler] ✅ Found input in .file-tree-entity-button`);
    }

    // Method 2: Find span.rename-input, then get the input inside
    if (!actualInput) {
      const renameSpan = folderElement.querySelector('.file-tree-entity-button span.rename-input');
      if (renameSpan) {
        console.log(`[APIHandler] ✅ Found span.rename-input`);
        actualInput = renameSpan.querySelector('input') as HTMLInputElement;
      }
    }

    // Method 3: Try in entity-name
    if (!actualInput) {
      actualInput = folderElement.querySelector('.entity-name input') as HTMLInputElement;
      if (actualInput) {
        console.log(`[APIHandler] ✅ Found input in .entity-name`);
      }
    }

    // Method 4: Try any input in folder element
    if (!actualInput) {
      const allInputs = folderElement.querySelectorAll('input');
      if (allInputs.length > 0) {
        actualInput = allInputs[0] as HTMLInputElement;
        console.log(`[APIHandler] ✅ Using first input found in folder element`);
      }
    }

    if (!actualInput) {
      throw new Error('Could not find rename input for folder');
    }

    console.log(`[APIHandler] ✅ Found rename input element: ${actualInput.tagName}`);
    console.log(`[APIHandler] 🔍 Debug: input value="${actualInput.value}"`);

    // Step 6: Clear the input and type the new folder name
    console.log(`[APIHandler] ✏️ Typing new folder name: ${newFolderName}`);

    // Focus the input
    actualInput.focus();

    // Select all text (if there's content)
    actualInput.select();

    await this.sleep(100);

    // Clear and type new name
    actualInput.value = newFolderName;

    // Trigger input event to ensure value is registered
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true
    });
    actualInput.dispatchEvent(inputEvent);

    // Wait for input to be processed
    await this.sleep(500);

    // Step 7: Press Enter to confirm
    console.log(`[APIHandler] ⏎ Pressing Enter to confirm...`);

    // Simulate Enter key press
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });

    actualInput.dispatchEvent(enterEvent);

    // Also dispatch keyup for completeness
    const enterEventUp = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    });
    actualInput.dispatchEvent(enterEventUp);

    // Wait for the rename to complete
    console.log(`[APIHandler] ⏳ Waiting for rename to complete...`);
    await this.sleep(1000);

    console.log(`[APIHandler] ✅ Folder renamed successfully: ${oldPath} -> ${newFolderName}`);
  }

  /**
   * Process folder creation (called by the folder queue)
   */
  private async processFolderCreation(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    console.log(`[APIHandler] 📁➕ Processing folder creation: ${message.path}`);

    // Extract folder name from path
    const pathParts = message.path.split('/');
    const folderName = pathParts.pop() || message.path;
    const parentPath = pathParts.join('/');

    try {
      const result = await this.createFolderViaDOM(folderName, parentPath);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'create',
        path: message.path,
        success: true,
        folder_id: result.folderId,
        isDirectory: true,
        timestamp: message.timestamp
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
        timestamp: message.timestamp
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
        timestamp: message.timestamp
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ Rename folder failed:`, error);
      throw error;
    }
  }

  /**
   * Navigate to a specific folder in the file tree
   * This involves clicking through the folder hierarchy
   */
  private async navigateToFolder(folderPath: string): Promise<void> {
    console.log(`[APIHandler] 🔍 Navigating to folder: ${folderPath}`);

    const pathParts = folderPath.split('/').filter(p => p.length > 0);

    for (const folderName of pathParts) {
      console.log(`[APIHandler] 🔍 Looking for folder: ${folderName}`);

      // Try to find the folder with retry logic (in case DOM is still updating)
      let folderElement: Element | null = null;
      let found = false;

      // Retry up to 10 times with 500ms intervals (total 5 seconds)
      for (let attempt = 1; attempt <= 10; attempt++) {
        folderElement = await this.findFolderByName(folderName);

        if (folderElement) {
          found = true;
          console.log(`[APIHandler] ✅ Found folder on attempt ${attempt}: ${folderName}`);
          break;
        } else {
          console.log(`[APIHandler] ⏳ Folder not found on attempt ${attempt}/10, waiting 500ms...`);
          await this.sleep(500);
        }
      }

      if (!found || !folderElement) {
        throw new Error(`Could not find folder after 10 attempts: ${folderName}`);
      }

      // Check if folder is already expanded
      const isExpanded = folderElement.getAttribute('aria-expanded') === 'true';
      console.log(`[APIHandler] 🔍 Folder expansion state: ${isExpanded ? 'expanded' : 'collapsed'}`);

      // If not expanded, click the expand button to expand it
      if (!isExpanded) {
        console.log(`[APIHandler] 🔍 Folder is collapsed, expanding...`);
        const expandButton = folderElement.querySelector('.folder-expand-collapse-button') as HTMLElement;
        if (expandButton) {
          this.simulateClick(expandButton);
          await this.sleep(500); // Wait for expansion animation
          console.log(`[APIHandler] ✅ Folder expanded`);
        }
      }

      // Find and click the folder to navigate/select it
      let clickTarget: HTMLElement | null = null;

      // Method 1: Try to find file-tree-entity-button
      clickTarget = folderElement.querySelector('.file-tree-entity-button') as HTMLElement;

      // Method 2: Try to find .entity-name
      if (!clickTarget) {
        clickTarget = folderElement.querySelector('.entity-name') as HTMLElement;
      }

      // Method 3: Try to find button
      if (!clickTarget) {
        clickTarget = folderElement.querySelector('button') as HTMLElement;
      }

      // Method 4: Use the li element itself
      if (!clickTarget) {
        clickTarget = folderElement as HTMLElement;
      }

      if (!clickTarget) {
        throw new Error(`Could not find clickable element for folder: ${folderName}`);
      }

      console.log(`[APIHandler] ✅ Clicking folder: ${folderName}`);
      console.log(`[APIHandler]    Click target: ${clickTarget.tagName} (class: ${clickTarget.className})`);

      this.simulateClick(clickTarget);
      await this.sleep(800); // Wait for navigation to complete

      // After clicking, verify the folder is expanded (in case clicking expanded it)
      const isExpandedAfterClick = folderElement.getAttribute('aria-expanded') === 'true';
      if (!isExpandedAfterClick) {
        console.log(`[APIHandler] ⚠️ Folder still collapsed after click, trying to expand...`);
        const expandButton = folderElement.querySelector('.folder-expand-collapse-button') as HTMLElement;
        if (expandButton) {
          this.simulateClick(expandButton);
          await this.sleep(500); // Wait for expansion animation
          console.log(`[APIHandler] ✅ Folder expanded after second attempt`);
        }
      }
    }

    console.log(`[APIHandler] ✅ Navigated to folder: ${folderPath}`);
  }

  /**
   * Find a file in the file tree by name
   */
  private async findFileByName(fileName: string): Promise<Element | null> {
    console.log(`[APIHandler] 🔍 Searching for file: ${fileName}`);

    // Find all file name spans in the tree
    const nameSpans = document.querySelectorAll('#ide-redesign-file-tree .item-name span');

    console.log(`[APIHandler] 🔍 Found ${nameSpans.length} items with .item-name span`);

    for (const span of nameSpans) {
      const text = span.textContent?.trim();
      console.log(`[APIHandler] 🔍 Checking item: "${text}"`);

      if (text === fileName) {
        console.log(`[APIHandler] ✅ Found matching text: ${fileName}`);

        // Walk up the DOM tree to find the containing element
        let current = span;

        // Walk up: span -> div.item-name -> button -> div.entity-name -> li
        while (current && current.tagName !== 'LI') {
          current = current.parentElement;
          if (!current) break;

          console.log(`[APIHandler] 🔍 Walking up DOM: ${current.tagName} (class: ${current.className})`);
        }

        if (current && current.tagName === 'LI') {
          console.log(`[APIHandler] ✅ Found LI element for file: ${fileName}`);
          console.log(`[APIHandler]    LI classes: ${current.className}`);

          // Verify it's a file (not a folder) by checking that it does NOT have folder indicators
          const hasFolderCollapseButton = current.querySelector('.folder-expand-collapse-button');
          const hasChevron = current.querySelector('[class*="chevron"]');
          const hasFolderIcon = current.querySelector('[class*="folder"]');

          console.log(`[APIHandler]    File indicators:`);
          console.log(`[APIHandler]      - folder-collapse-button: ${!!hasFolderCollapseButton}`);
          console.log(`[APIHandler]      - chevron icon: ${!!hasChevron}`);
          console.log(`[APIHandler]      - folder icon: ${!!hasFolderIcon}`);

          // If it doesn't have any folder indicators, it's a file
          if (!hasFolderCollapseButton && !hasChevron && !hasFolderIcon) {
            console.log(`[APIHandler] ✅ Confirmed it's a file: ${fileName}`);
            return current;
          } else {
            console.log(`[APIHandler] ⚠️ Item has name "${fileName}" but appears to be a folder (has folder indicators)`);
          }
        }
      }
    }

    console.log(`[APIHandler] ⚠️ Could not find file: ${fileName}`);
    return null;
  }

  /**
   * Find a folder in the file tree by name
   */
  private async findFolderByName(folderName: string): Promise<Element | null> {
    console.log(`[APIHandler] 🔍 Searching for folder: ${folderName}`);

    // Find all folder name spans in the tree
    const nameSpans = document.querySelectorAll('#ide-redesign-file-tree .item-name span');

    console.log(`[APIHandler] 🔍 Found ${nameSpans.length} items with .item-name span`);

    for (const span of nameSpans) {
      const text = span.textContent?.trim();
      console.log(`[APIHandler] 🔍 Checking item: "${text}"`);

      if (text === folderName) {
        console.log(`[APIHandler] ✅ Found matching text: ${folderName}`);

        // Walk up the DOM tree to find the containing element
        let current = span;

        // Walk up: span -> div.item-name -> button -> div.entity-name -> li
        while (current && current.tagName !== 'LI') {
          current = current.parentElement;
          if (!current) break;

          console.log(`[APIHandler] 🔍 Walking up DOM: ${current.tagName} (class: ${current.className})`);
        }

        if (current && current.tagName === 'LI') {
          console.log(`[APIHandler] ✅ Found LI element for folder: ${folderName}`);
          console.log(`[APIHandler]    LI classes: ${current.className}`);

          // Verify it's a folder by checking for folder-related elements
          // Look for: folder-expand-collapse-button, chevron_right icon, or class containing "folder"
          const hasFolderCollapseButton = current.querySelector('.folder-expand-collapse-button');
          const hasChevron = current.querySelector('[class*="chevron"]');
          const hasFolderIcon = current.querySelector('[class*="folder"]');

          console.log(`[APIHandler]    Folder indicators:`);
          console.log(`[APIHandler]      - folder-collapse-button: ${!!hasFolderCollapseButton}`);
          console.log(`[APIHandler]      - chevron icon: ${!!hasChevron}`);
          console.log(`[APIHandler]      - folder icon: ${!!hasFolderIcon}`);

          // If it has any folder indicator, it's a folder
          if (hasFolderCollapseButton || hasChevron || hasFolderIcon) {
            console.log(`[APIHandler] ✅ Confirmed it's a folder: ${folderName}`);
            return current;
          } else {
            console.log(`[APIHandler] ⚠️ Item has name "${folderName}" but doesn't appear to be a folder (no folder indicators)`);
          }
        }
      }
    }

    console.log(`[APIHandler] ⚠️ Could not find folder: ${folderName}`);
    return null;
  }

  /**
   * Wait for a folder to appear in the DOM after creation
   * This polls the DOM looking for the folder with a timeout
   */
  private async waitForFolderToAppear(folderName: string, parentPath: string, maxWait: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 300; // Check every 300ms

    console.log(`[APIHandler] 🔍 Starting to wait for folder: ${folderName} (max wait: ${maxWait}ms)`);

    while (Date.now() - startTime < maxWait) {
      // Try to find the folder
      const folderElement = await this.findFolderByName(folderName);

      if (folderElement) {
        console.log(`[APIHandler] ✅ Folder appeared in DOM after ${Date.now() - startTime}ms: ${folderName}`);
        return true;
      }

      // Wait a bit before trying again
      await this.sleep(checkInterval);
      console.log(`[APIHandler] ⏳ Still waiting for folder: ${folderName} (${Date.now() - startTime}ms elapsed)`);
    }

    console.warn(`[APIHandler] ⚠️ Folder did not appear in DOM within ${maxWait}ms: ${folderName}`);
    return false;
  }

  /**
   * Wait for a file to appear in the DOM after creation
   * This polls the DOM looking for the file with a timeout
   */
  private async waitForFileToAppear(fileName: string, parentPath: string, maxWait: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 300; // Check every 300ms

    console.log(`[APIHandler] 🔍 Starting to wait for file: ${fileName} (max wait: ${maxWait}ms)`);

    while (Date.now() - startTime < maxWait) {
      // Try to find the file
      const fileElement = await this.findFileByName(fileName);

      if (fileElement) {
        console.log(`[APIHandler] ✅ File appeared in DOM after ${Date.now() - startTime}ms: ${fileName}`);
        return true;
      }

      // Wait a bit before trying again
      await this.sleep(checkInterval);
      console.log(`[APIHandler] ⏳ Still waiting for file: ${fileName} (${Date.now() - startTime}ms elapsed)`);
    }

    console.warn(`[APIHandler] ⚠️ File did not appear in DOM within ${maxWait}ms: ${fileName}`);
    return false;
  }

  /**
   * Click the blank area in the file tree to deselect any selected item
   * This ensures we're at the root level for creating folders
   */
  private async clickBlankArea(): Promise<void> {
    console.log(`[APIHandler] 🔍 Clicking blank area in file tree`);

    // Click on the ::after area of the file tree inner container
    // This is the selector provided by the user
    const blankArea = document.querySelector('#ide-redesign-file-tree > div > div.file-tree-inner > ul > div');

    if (blankArea) {
      this.simulateClick(blankArea as HTMLElement);
      await this.sleep(300);
      console.log(`[APIHandler] ✅ Clicked blank area`);
    } else {
      // Fallback: click on the file tree container
      const fileTree = document.querySelector('#ide-redesign-file-tree');
      if (fileTree) {
        this.simulateClick(fileTree as HTMLElement);
        await this.sleep(300);
        console.log(`[APIHandler] ✅ Clicked file tree container (fallback)`);
      }
    }
  }

  /**
   * Find a folder's ID by searching in the file tree
   * This is called after creating a folder to get its ID for mapping
   */
  private async findFolderId(folderName: string, parentPath: string): Promise<string> {
    console.log(`[APIHandler] 🔍 Looking up folder ID for: ${folderName}`);

    // Try to find the folder in the file tree
    const folderElement = await this.findFolderByName(folderName);

    if (folderElement) {
      // Try to get the folder ID from data-entity-id attribute
      const folderId = folderElement.getAttribute('data-entity-id');

      if (folderId) {
        console.log(`[APIHandler] ✅ Found folder ID: ${folderId}`);
        return folderId;
      }
    }

    // If we couldn't find the ID, generate a mock one for now
    // In a real implementation, we'd need to wait for the folder to appear in the DOM
    const mockFolderId = `folder-${Date.now()}`;
    console.log(`[APIHandler] ⚠️ Could not find folder ID, using mock: ${mockFolderId}`);
    return mockFolderId;
  }

  /**
   * Find a file's ID by searching in the file tree
   * This is called after creating a file to get its ID for mapping
   */
  private async findFileId(fileName: string, parentPath: string): Promise<string> {
    console.log(`[APIHandler] 🔍 Looking up file ID for: ${fileName}`);
    console.log(`[APIHandler]    Parent path: ${parentPath || '(root)'}`);

    // 🔧 NEW: First, check the global mapping (from Overleaf WebSocket)
    // The global mapping is updated when Overleaf creates a file, so it should have the correct ID
    const fullPath = parentPath ? `${parentPath}/${fileName}` : fileName;
    const globalMapping = (window as any).__overleaf_docIdToPath__;

    if (globalMapping) {
      // Method 1: Search by path in the mapping
      for (const [docId, docInfo] of globalMapping.entries()) {
        if (docInfo.path === fullPath) {
          console.log(`[APIHandler] ✅ Found file ID in global mapping (by path): ${docId}`);
          return docId;
        }
      }

      // Method 2: Search by filename only (in case parent path doesn't match exactly)
      for (const [docId, docInfo] of globalMapping.entries()) {
        const pathFileName = docInfo.path.split('/').pop();
        if (pathFileName === fileName) {
          console.log(`[APIHandler] ✅ Found file ID in global mapping (by filename): ${docId}`);
          console.log(`[APIHandler]    Path in mapping: ${docInfo.path}`);
          return docId;
        }
      }

      console.log(`[APIHandler] ⚠️ File not found in global mapping`);
    } else {
      console.log(`[APIHandler] ⚠️ Global mapping not available`);
    }

    // Fallback: Try to find the file in the DOM file tree
    console.log(`[APIHandler] 🔍 Searching in DOM file tree...`);
    const fileElement = await this.findFileByName(fileName);

    if (fileElement) {
      // Try to get the file ID from data-entity-id attribute
      const fileId = fileElement.getAttribute('data-entity-id');

      if (fileId) {
        console.log(`[APIHandler] ✅ Found file ID in DOM: ${fileId}`);
        return fileId;
      }
    }

    // If we couldn't find the ID, generate a mock one for now
    const mockFileId = `doc-${Date.now()}`;
    console.log(`[APIHandler] ⚠️ Could not find file ID, using mock: ${mockFileId}`);
    return mockFileId;
  }
}
