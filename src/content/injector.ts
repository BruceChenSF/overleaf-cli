import type { OpenTerminalMessage } from '../shared/types';
import { DropdownMenu } from './dropdown';
import { stateManager } from './state-manager';
import { injectNotificationStyles } from './styles';
import { SyncManager } from './sync-manager';
import type { ExtensionToBridgeMessage, BridgeToExtensionMessage } from '../shared/types';
import { OverleafWebSocketClient } from './overleaf-websocket';

// Global dropdown and sync manager instances
let dropdown: DropdownMenu | null = null;
let syncManager: SyncManager | null = null;
let bridgeWs: WebSocket | null = null;
let overleafWsClient: OverleafWebSocketClient | null = null;
const BRIDGE_PORT = 3456;

// Promise storage for pending requests
const pendingRequests = new Map<string, {
  resolve: (value: any) => void;
  reject: (error: any) => void;
}>();

function extractProjectId(): string | null {
  const match = window.location.href.match(/\/project\/([a-f0-9]+)/i);
  return match ? match[1] : null;
}

function extractCSRFToken(): string | null {
  const metaTag = document.querySelector('meta[name="ol-csrfToken"]') as HTMLMetaElement;
  return metaTag?.content || null;
}

function createTerminalButton(): HTMLElement {
  // Create a div wrapper similar to the File dropdown structure
  const wrapper = document.createElement('div');
  wrapper.className = 'toolbar-menu-bar-item';
  wrapper.id = 'overleaf-cc-terminal-btn';
  wrapper.style.position = 'relative'; // For dropdown positioning

  // Create the button
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'toolbar-menu-bar-item-terminal';
  button.className = 'ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued menu-bar-toggle btn btn-secondary';
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `
    <img src="https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude-color.svg"
         alt="Claude"
         width="16"
         height="16"
         style="vertical-align: middle;" />
  `;

  button.addEventListener('click', toggleDropdown);

  wrapper.appendChild(button);
  return wrapper;
}

async function openTerminal(): Promise<void> {
  const projectId = extractProjectId();
  const csrfToken = extractCSRFToken();

  if (!projectId) {
    alert('Could not identify Overleaf project. Please refresh the page.');
    return;
  }

  if (!csrfToken) {
    console.error('[Overleaf CC] CSRF token not found');
    alert('Could not extract CSRF token. Please refresh the page.');
    return;
  }

  const message: OpenTerminalMessage = {
    type: 'OPEN_TERMINAL',
    projectId,
    projectUrl: window.location.href,
    csrfToken
  };

  console.log('[Overleaf CC] Sending OPEN_TERMINAL message:', message);

  try {
    const response = await chrome.runtime.sendMessage(message);
    console.log('[Overleaf CC] Received response:', response);

    if (response?.error) {
      console.error('[Overleaf CC] Error response:', response.error);
      alert(`Error: ${response.error}`);
    } else {
      console.log('[Overleaf CC] Terminal window opened successfully');
    }
  } catch (err) {
    console.error('[Overleaf CC] Failed to send message:', err);
    alert(`Failed to open terminal: ${(err as Error).message}`);
  }
}

/**
 * Toggle dropdown visibility
 */
function toggleDropdown(): void {
  if (!dropdown) {
    console.warn('[Overleaf CC] Dropdown not initialized');
    return;
  }

  dropdown.toggle();

  // Update button aria-expanded attribute
  const button = document.getElementById('toolbar-menu-bar-item-terminal');
  if (button) {
    const isExpanded = dropdown.getElement().classList.contains('show');
    button.setAttribute('aria-expanded', isExpanded.toString());
  }
}

/**
 * Initialize dropdown menu
 */
function initDropdown(): void {
  const wrapper = document.getElementById('overleaf-cc-terminal-btn');
  if (!wrapper) {
    console.error('[Overleaf CC] Button wrapper not found for dropdown');
    return;
  }

  dropdown = new DropdownMenu({
    container: wrapper,
    onSync: manualSync,
    onTerminalChange: onTerminalChange,
    onSyncModeChange: onSyncModeChange
  });

  // Subscribe to state changes for real-time updates
  subscribeToStateChanges();

  // Inject dropdown styles
  injectDropdownStyles();

  // Initialize sync manager
  initSyncManager();

  console.log('[Overleaf CC] Dropdown initialized');
}

/**
 * Inject dropdown styles
 */
async function injectDropdownStyles(): Promise<void> {
  try {
    const response = await fetch(chrome.runtime.getURL('src/styles/dropdown.css'));
    const css = await response.text();
    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
  } catch (error) {
    console.error('[Overleaf CC] Failed to load dropdown styles:', error);
  }
}

/**
 * Manual sync callback
 */
async function manualSync(): Promise<void> {
  console.log('[Overleaf CC] Manual sync triggered');

  if (!syncManager) {
    console.error('[Overleaf CC] Sync manager not initialized');
    return;
  }

  try {
    // Sync from Overleaf to get latest state
    await syncManager.syncFromOverleaf();
  } catch (error) {
    console.error('[Overleaf CC] Manual sync failed:', error);
  }
}

/**
 * Connect to bridge WebSocket
 */
async function connectToBridge(): Promise<void> {
  try {
    console.log(`[Overleaf CC] Connecting to bridge at ws://localhost:${BRIDGE_PORT}`);
    bridgeWs = new WebSocket(`ws://localhost:${BRIDGE_PORT}`);

    await new Promise<void>((resolve, reject) => {
      if (!bridgeWs) return reject(new Error('WebSocket not initialized'));

      bridgeWs.onopen = () => {
        console.log('[Overleaf CC] ✓ Connected to bridge, sending auth...');

        // Send auth message
        const projectId = extractProjectId();
        const csrfToken = extractCSRFToken();

        if (!projectId || !csrfToken) {
          console.error('[Overleaf CC] Missing projectId or csrfToken');
          dropdown?.updateConnectionStatus('error', 'Missing authentication data');
          reject(new Error('Missing authentication data'));
          return;
        }

        const authMessage = {
          type: 'auth',
          data: { projectId, csrfToken }
        };

        console.log('[Overleaf CC] Sending auth message:', JSON.stringify(authMessage));
        bridgeWs!.send(JSON.stringify(authMessage));

        // Wait for auth response before resolving
        const authTimeout = setTimeout(() => {
          reject(new Error('Auth timeout'));
        }, 5000);

        // Set up one-time listener for auth response
        const originalOnMessage = bridgeWs!.onmessage;
        bridgeWs!.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);

            // Check if this is auth response
            if (message.type === 'response' && message.data?.success) {
              console.log('[Overleaf CC] ✓ Auth successful');
              dropdown?.updateConnectionStatus('connected');
              clearTimeout(authTimeout);

              // Restore original message handler
              bridgeWs!.onmessage = originalOnMessage;

              // Process this message with original handler
              if (originalOnMessage) {
                originalOnMessage(event);
              }

              // Start Overleaf change watcher (non-blocking)
              startOverleafWatcher().catch(err => {
                console.error('[Overleaf CC] Failed to start watcher:', err);
              });

              resolve();
            } else if (message.type === 'response' && !message.data?.success) {
              console.error('[Overleaf CC] Auth failed:', message.data?.error);
              dropdown?.updateConnectionStatus('error', message.data?.error || 'Auth failed');
              clearTimeout(authTimeout);
              reject(new Error(message.data?.error || 'Auth failed'));
            } else {
              // Not an auth response, use original handler
              if (originalOnMessage) {
                originalOnMessage(event);
              }
            }
          } catch (error) {
            console.error('[Overleaf CC] Failed to parse auth response:', error);
          }
        };
      };

      bridgeWs.onerror = (error) => {
        console.error('[Overleaf CC] Bridge connection error:', error);
        dropdown?.updateConnectionStatus('error', 'Failed to connect to bridge');
        reject(error);
      };

      bridgeWs.onclose = () => {
        console.log('[Overleaf CC] Bridge connection closed');
        dropdown?.updateConnectionStatus('disconnected');
      };

      bridgeWs.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          // console.log('[Overleaf CC] Received from bridge:', message.type);
          handleBridgeMessage(message);
        } catch (error) {
          console.error('[Overleaf CC] Failed to parse bridge message:', error);
        }
      };

      // Timeout after 10 seconds (increased from 5)
      setTimeout(() => reject(new Error('Bridge connection timeout')), 10000);
    });
  } catch (error) {
    console.error('[Overleaf CC] Failed to connect to bridge:', error);
    dropdown?.updateConnectionStatus('error', (error as Error).message);
  }
}

/**
 * Handle message from bridge
 */
function handleBridgeMessage(message: any): void {
  // Log raw message for debugging (commented out to reduce noise)
  // console.log('[Overleaf CC] Raw message from bridge:', JSON.stringify(message));

  // Handle EXTENSION_MESSAGE - forward to file-reader
  if (message.type === 'EXTENSION_MESSAGE') {
    // console.log('[Overleaf CC] Received EXTENSION_MESSAGE, forwarding to file-reader');
    handleExtensionMessage(message);
    return;
  }

  // Handle messages with requestId (including response type)
  if (message.requestId) {
    // console.log('[Overleaf CC] Handling message with requestId:', message.requestId, 'type:', message.type);
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
      // console.log('[Overleaf CC] Found pending request for requestId:', message.requestId);
      pendingRequests.delete(message.requestId);

      // For response type, check for errors
      if (message.type === 'response' && (message.data?.success === false || message.data?.error)) {
        pending.reject(new Error(message.data?.error || 'Request failed'));
      } else {
        // For all other message types (ALL_FILES, FILE_CONTENT, etc.), resolve with the whole message
        pending.resolve(message);
      }
    } else {
      console.warn('[Overleaf CC] No pending request found for requestId:', message.requestId);
    }
    return;
  }

  // Log if response type but no requestId (auth response, etc)
  if (message.type === 'response' && !message.requestId) {
    console.log('[Overleaf CC] Received response without requestId (likely auth)');
  }

  // Handle other message types without requestId (events, notifications)
  switch (message.type) {
    case 'FILE_CONTENT':
    case 'FILE_STATUS':
    case 'ALL_FILES':
    case 'FILE_CHANGED':
      console.log('[Overleaf CC] Forwarding to sync manager:', message.type);
      // Forward to sync manager
      syncManager?.emit(`bridge:${message.type}`, message);
      break;

    case 'TASK_COMPLETE':
      syncManager?.handleTaskCompletion(message);
      break;

    case 'CONFLICT_DETECTED':
      console.warn('[Overleaf CC] Conflict detected:', message.payload);
      if (dropdown) {
        dropdown.updateSyncStatus('conflict');
      }
      break;

    case 'ERROR':
      console.error('[Overleaf CC] Bridge error:', message.payload);
      break;

    default:
      console.log('[Overleaf CC] Unknown message type:', (message as any).type, 'Full message:', JSON.stringify(message));
  }
}

/**
 * Handle EXTENSION_MESSAGE from bridge - handle file reading requests directly
 */
async function handleExtensionMessage(message: any): Promise<void> {
  try {
    const { messageId, data } = message;

    if (!data || !data.message) {
      console.error('[Overleaf CC] Invalid EXTENSION_MESSAGE:', message);
      return;
    }

    console.log('[Overleaf CC] Handling EXTENSION_MESSAGE:', data.message.type);

    let response: any;

    // Handle message directly instead of forwarding to file-reader
    switch (data.message.type) {
      case 'GET_ALL_FILES':
        response = await handleGetAllFiles();
        break;

      case 'SYNC_ALL_FILES':
        response = await handleSyncAllFiles();
        break;

      case 'GET_FILE_CONTENT':
        const filePath = (data.message.payload as any)?.path;
        response = await handleGetFileContent(filePath);
        break;

      case 'SET_FILE_CONTENT':
        const setContentPayload = data.message.payload as any;
        response = await handleSetFileContent(setContentPayload?.path, setContentPayload?.content);
        break;

      default:
        console.error('[Overleaf CC] Unknown message type:', data.message.type);
        response = { success: false, error: `Unknown message type: ${data.message.type}` };
    }

    console.log('[Overleaf CC] Sending response to bridge:', JSON.stringify(response).substring(0, 200));

    // Send response back to bridge
    if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
      const responseMessage = {
        type: 'EXTENSION_MESSAGE',
        messageId,
        data: response
      };

      bridgeWs.send(JSON.stringify(responseMessage));
    } else {
      console.error('[Overleaf CC] Bridge WebSocket not connected');
    }
  } catch (error) {
    console.error('[Overleaf CC] Error handling EXTENSION_MESSAGE:', error);

    // Send error response back to bridge
    if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
      const errorMessage = {
        type: 'EXTENSION_MESSAGE',
        messageId: message.messageId,
        data: {
          success: false,
          error: (error as Error).message
        }
      };

      bridgeWs.send(JSON.stringify(errorMessage));
    }
  }
}

/**
 * Sync all files from Overleaf using WebSocket API
 */
async function handleSyncAllFiles(): Promise<{ success: boolean; data?: any[]; error?: string }> {
  console.log('[Overleaf CC] Starting full file sync via WebSocket...');

  try {
    const projectId = extractProjectId();
    const csrfToken = extractCSRFToken();

    console.log('[Overleaf CC] Project ID:', projectId);
    console.log('[Overleaf CC] CSRF Token:', csrfToken ? 'Found' : 'Not found');

    if (!projectId || !csrfToken) {
      return { success: false, error: 'Missing projectId or csrfToken' };
    }

    // Get cookies from service worker (which has access to chrome.cookies API)
    console.log('[Overleaf CC] Requesting cookies from service worker...');
    const cookieResponse = await chrome.runtime.sendMessage({
      type: 'GET_COOKIES',
      domain: window.location.hostname
    }) as { overleaf_session2?: string; GCLB?: string };

    console.log('[Overleaf CC] Received cookie response:', {
      overleaf_session2: cookieResponse.overleaf_session2 ? `${cookieResponse.overleaf_session2.substring(0, 10)}...` : undefined,
      GCLB: cookieResponse.GCLB
    });

    if (!cookieResponse.overleaf_session2) {
      console.error('[Overleaf CC] No overleaf_session2 cookie received from service worker');
      return { success: false, error: 'Missing overleaf_session2 cookie' };
    }

    const auth = {
      cookieOverleafSession2: cookieResponse.overleaf_session2,
      cookieGCLB: cookieResponse.GCLB || '',
    };

    console.log('[Overleaf CC] Got cookies, connecting to Overleaf WebSocket...');

    // Connect to Overleaf WebSocket
    const wsClient = new OverleafWebSocketClient();
    await wsClient.connect(projectId, auth, csrfToken);

    console.log('[Overleaf CC] Connected, waiting for project structure...');

    // Wait for joinProjectResponse to be processed
    await wsClient.waitForProjectJoin();

    console.log('[Overleaf CC] Project structure received, getting all IDs...');

    // Get all document and file IDs from WebSocket project structure
    const allIds = wsClient.getAllDocIds();
    console.log(`[Overleaf CC] Found ${allIds.length} items (documents + files) in project`);

    // Fetch content for each item
    const syncedFiles: any[] = [];
    for (const id of allIds) {
      try {
        const info = wsClient.getDocInfo(id);
        if (!info) {
          console.warn(`[Overleaf CC] No info found for ${id}, skipping`);
          continue;
        }

        console.log(`[Overleaf CC] Syncing ${info.path} (id: ${id}, type: ${info.type})...`);

        if (info.type === 'doc') {
          // Handle document (text file)
          const lines = await wsClient.joinDoc(id);
          await wsClient.leaveDoc(id);

          syncedFiles.push({
            id: id,
            name: info.name,
            path: info.path,
            content: lines.join('\n'),
            lines: lines
          });

          console.log(`[Overleaf CC] ✓ Synced ${info.path} (${lines.length} lines)`);
        } else if (info.type === 'file') {
          // Handle file (binary file like image, PDF, etc.)
          const blob = await wsClient.downloadFile(id, projectId);

          // Convert blob to base64
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));

          syncedFiles.push({
            id: id,
            name: info.name,
            path: info.path,
            content: base64,
            encoding: 'base64',
            mimeType: blob.type
          });

          console.log(`[Overleaf CC] ✓ Synced ${info.path} (${blob.size} bytes, ${blob.type})`);
        }
      } catch (error) {
        console.error(`[Overleaf CC] ✗ Failed to sync ${id}:`, error);
        // Continue with other files
      }
    }

    wsClient.disconnect();

    console.log(`[Overleaf CC] Successfully synced ${syncedFiles.length}/${allIds.length} files`);
    return { success: true, data: syncedFiles };
  } catch (error) {
    console.error('[Overleaf CC] Sync failed:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get all files from Overleaf
 */
async function handleGetAllFiles(): Promise<{ success: boolean; data?: any[]; error?: string }> {
  try {
    // Get files from Overleaf DOM
    const files: any[] = [];
    const windowWithEditor = window as any;

    console.log('[Overleaf CC] Attempting to get file list from Overleaf...');

    // Method 1: Try ee._.document.entities
    try {
      if (windowWithEditor.ee?._?.document?.entities) {
        const entities = windowWithEditor.ee._.document.entities;
        console.log('[Overleaf CC] Found ee._.document.entities:', Array.isArray(entities) ? entities.length : 'not array');
        if (Array.isArray(entities)) {
          for (const entity of entities) {
            if (entity._id && entity.name && entity.type === 'doc') {
              files.push({
                id: entity._id,
                name: entity.name,
                path: entity.path || `/${entity.name}`,
                type: 'doc'
              });
            }
          }
          if (files.length > 0) {
            console.log(`[Overleaf CC] Found ${files.length} files from ee._.document.entities`);
            return { success: true, data: files };
          }
        }
      } else {
        console.log('[Overleaf CC] ee._.document.entities not found');
      }
    } catch (err) {
      console.error('[Overleaf CC] Error accessing ee._.document.entities:', err);
    }

    // Method 2: Try __initData
    if (files.length === 0) {
      try {
        const initData = windowWithEditor.__initData;
        if (initData?.project?.rootFolder?.fileRefs) {
          const fileRefs = initData.project.rootFolder.fileRefs;
          console.log('[Overleaf CC] Found __initData.project.rootFolder.fileRefs:', Array.isArray(fileRefs) ? fileRefs.length : 'not array');
          if (Array.isArray(fileRefs)) {
            for (const ref of fileRefs) {
              if (ref._id && ref.name) {
                files.push({
                  id: ref._id,
                  name: ref.name,
                  path: `/${ref.name}`,
                  type: 'doc'
                });
              }
            }
            if (files.length > 0) {
              console.log(`[Overleaf CC] Found ${files.length} files from __initData`);
              return { success: true, data: files };
            }
          }
        } else {
          console.log('[Overleaf CC] __initData.project.rootFolder.fileRefs not found');
        }
      } catch (err) {
        console.error('[Overleaf CC] Error accessing __initData:', err);
      }
    }

    // Method 3: Parse file tree DOM (most reliable)
    if (files.length === 0) {
      console.log('[Overleaf CC] Trying to parse file tree DOM...');
      const fileTreeFiles = parseFileTreeDOM();
      if (fileTreeFiles.length > 0) {
        console.log(`[Overleaf CC] Found ${fileTreeFiles.length} files from DOM`);
        return { success: true, data: fileTreeFiles };
      }
    }

    // Method 4: Fallback to current document
    console.log('[Overleaf CC] No files found from tree, falling back to current document');
    const currentDoc = getCurrentDocumentInfo();
    if (currentDoc) {
      files.push({
        id: currentDoc.id || 'main',
        name: currentDoc.name || 'main.tex',
        path: currentDoc.path || '/main.tex',
        type: 'doc'
      });
      console.log(`[Overleaf CC] Using current document as fallback: ${currentDoc.name}`);
      return { success: true, data: files };
    }

    console.log('[Overleaf CC] Could not find any files');
    return { success: true, data: [] };
  } catch (error) {
    console.error('[Overleaf CC] Error getting all files:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Parse file tree from DOM
 */
function parseFileTreeDOM(): any[] {
  const files: any[] = [];

  try {
    // Try to find file tree elements
    const fileTreeSelectors = [
      '#ide-redesign-file-tree [data-file-id]',
      '.file-tree-inner [data-file-id]',
      '[data-test-selector="file-tree-item"]',
      '#ide-redesign-file-tree .file-tree-list li'
    ];

    for (const selector of fileTreeSelectors) {
      const elements = document.querySelectorAll(selector);
      console.log(`[Overleaf CC] Trying selector "${selector}": found ${elements.length} elements`);

      if (elements.length > 0) {
        for (const el of elements) {
          const fileId = el.getAttribute('data-file-id');

          // Try multiple ways to get filename
          let fileName = el.getAttribute('data-filename');

          if (!fileName) {
            const nameEl = el.querySelector('.name, .filename, .entity-name, [data-test-selector="file-name"]');
            if (nameEl) {
              fileName = nameEl.textContent?.trim();
            }
          }

          // Filter out non-file items (buttons, icons, etc.)
          if (fileId && fileName &&
              fileName.length > 0 &&
              fileName.length < 100 &&
              !fileName.includes('expand_more') &&
              !fileName.includes('chevron') &&
              !fileName.includes('more_vert') &&
              !fileName.includes('menu') &&
              (fileName.endsWith('.tex') ||
               fileName.endsWith('.bib') ||
               fileName.endsWith('.sty') ||
               fileName.endsWith('.cls') ||
               fileName.endsWith('.pdf') ||
               fileName.endsWith('.png') ||
               fileName.endsWith('.jpg') ||
               fileName.includes('.') ||
               fileName === 'main.tex')) {

            files.push({
              id: fileId,
              name: fileName,
              path: `/${fileName}`,
              type: 'doc'
            });

            console.log(`[Overleaf CC] Parsed file: ${fileName} (id: ${fileId})`);
          }
        }

        if (files.length > 0) {
          console.log(`[Overleaf CC] Parsed ${files.length} files from DOM using selector "${selector}"`);
          break;
        }
      }
    }
  } catch (err) {
    console.error('[Overleaf CC] Error parsing file tree DOM:', err);
  }

  return files;
}

/**
 * Get current document info
 */
function getCurrentDocumentInfo(): { id?: string; name?: string; path?: string } | null {
  // Try to get doc info from URL first
  const match = window.location.pathname.match(/\/project\/[^/]+\/(?:doc|folder)\/([^/]+)/);
  if (match) {
    const docId = match[1];
    const docName = (document.querySelector('.document-title') as any)?.textContent ||
                   document.title.split(' - ')[0] ||
                   'main.tex';
    return {
      id: docId,
      name: docName,
      path: `/${docName}`
    };
  }

  // Try to get filename from breadcrumbs (most reliable method)
  const breadcrumbsContainer = document.querySelector('#ol-cm-toolbar-wrapper > div.ol-cm-breadcrumbs');
  if (breadcrumbsContainer) {
    const breadcrumbItems = breadcrumbsContainer.querySelectorAll('div');
    const pathParts: string[] = [];

    // Collect all div text content (folders and filename)
    for (const item of breadcrumbItems) {
      const text = item.textContent?.trim();
      if (text) {
        pathParts.push(text);
      }
    }

    if (pathParts.length > 0) {
      // Last item is the filename, preceding items are folders
      const fileName = pathParts[pathParts.length - 1];
      const filePath = pathParts.join('/');

      console.log(`🔍 [Overleaf CC] Extracted from breadcrumbs - fileName: ${fileName}, path: ${filePath}`);

      return {
        id: undefined,
        name: fileName,
        path: `/${filePath}`
      };
    }
  }

  // Try to use Overleaf WebSocket client to get the real filename
  if (overleafWsClient) {
    // Try to find the currently open file by checking which doc is being edited
    // We can use the editor content to match against files
    const allDocs = overleafWsClient.getAllDocIds();

    // Get current content from editor
    const currentContent = getCurrentDocumentContent();

    if (currentContent) {
      // Try to match content with one of the docs
      // For now, just get the first doc (this is a simplification)
      // TODO: Find a better way to determine which file is currently open
      const firstDocId = allDocs[0];
      if (firstDocId) {
        const docInfo = overleafWsClient.getDocInfo(firstDocId);
        if (docInfo) {
          console.log(`🔍 [Overleaf CC] Using Overleaf WS client - name: ${docInfo.name}, path: ${docInfo.path}`);
          return {
            id: docInfo.id,
            name: docInfo.name,
            path: docInfo.path
          };
        }
      }
    }
  }

  // Fallback: try to get doc info from DOM
  // Check if we can find the document name in the editor
  const docTitleElement = document.querySelector('.document-title') as HTMLElement;
  const docName = docTitleElement?.textContent ||
                  document.querySelector('.name')?.textContent ||
                  document.title.split(' - ')[0];

  if (docName) {
    // Try to find docId from data attributes or other sources
    const editorPanel = document.querySelector('#ide-redesign-panel-source-editor');
    const docId = editorPanel?.getAttribute('data-doc-id') ||
                  undefined;

    console.log(`🔍 [Overleaf CC] Using fallback document detection - name: ${docName}, id: ${docId || 'not found'}`);

    return {
      id: docId,
      name: docName,
      path: `/${docName}`
    };
  }

  console.warn('⚠️  [Overleaf CC] Cannot determine current document');
  return null;
}

/**
 * Get file content from Overleaf editor
 */
async function handleGetFileContent(path?: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const currentDoc = getCurrentDocumentInfo();

    if (!currentDoc) {
      return { success: false, error: 'Could not identify current document' };
    }

    // Check if requested file matches current document
    if (path && path !== `/${currentDoc.name}` && path !== currentDoc.path) {
      console.log(`[Overleaf CC] Requested file ${path} is not current document (${currentDoc.name}), skipping`);
      // Return special error to tell Bridge to skip this file
      return { success: false, error: 'FILE_NOT_OPEN', skip: true };
    }

    const content = getCurrentDocumentContent();

    if (content === null) {
      return { success: false, error: 'Could not read document content' };
    }

    console.log(`[Overleaf CC] Successfully read content for ${currentDoc.name} (${content.length} chars)`);

    return {
      success: true,
      data: {
        content,
        path: currentDoc.path || `/${currentDoc.name}`
      }
    };
  } catch (error) {
    console.error('[Overleaf CC] Error getting file content:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get current document content from editor
 */
function getCurrentDocumentContent(): string | null {
  const windowWithEditor = window as any;

  // Try different ways to access editor content
  if (windowWithEditor.editor?.getDocValue) {
    try {
      return windowWithEditor.editor.getDocValue();
    } catch (err) {
      console.error('[Overleaf CC] Error using editor.getDocValue:', err);
    }
  }

  if (windowWithEditor.editor?.getValue) {
    try {
      return windowWithEditor.editor.getValue();
    } catch (err) {
      console.error('[Overleaf CC] Error using editor.getValue:', err);
    }
  }

  // Try CodeMirror (old version)
  const codeMirrorElement = document.querySelector('.CodeMirror');
  if (codeMirrorElement && (window as any).CodeMirror) {
    try {
      const cm = (window as any).CodeMirror.fromTextArea(codeMirrorElement);
      if (cm.getValue) {
        return cm.getValue();
      }
    } catch (err) {
      console.error('[Overleaf CC] Error using CodeMirror:', err);
    }
  }

  // Try CodeMirror 6 (new Overleaf editor)
  const cmContent = document.querySelector('#ide-redesign-panel-source-editor .cm-content');
  if (cmContent) {
    try {
      // Extract text from all lines
      const lines = cmContent.querySelectorAll('.cm-line');
      const content = Array.from(lines)
        .map(line => line.textContent || '')
        .join('\n');

      console.log(`🔍 [Overleaf CC] Extracted content from CodeMirror 6: ${content.length} chars, ${lines.length} lines`);
      return content;
    } catch (err) {
      console.error('[Overleaf CC] Error using CodeMirror 6:', err);
    }
  }

  console.error('[Overleaf CC] Could not extract document content');
  return null;
}

/**
 * Set file content in Overleaf editor
 */
async function handleSetFileContent(path: string | undefined, content: string): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const windowWithEditor = window as any;
    let success = false;

    if (windowWithEditor.editor?.setDocValue) {
      try {
        windowWithEditor.editor.setDocValue(content);
        success = true;
      } catch (err) {
        console.error('[Overleaf CC] Error using editor.setDocValue:', err);
      }
    }

    if (!success && windowWithEditor.editor?.setValue) {
      try {
        windowWithEditor.editor.setValue(content);
        success = true;
      } catch (err) {
        console.error('[Overleaf CC] Error using editor.setValue:', err);
      }
    }

    if (!success) {
      return { success: false, error: 'Could not set document content' };
    }

    return {
      success: true,
      data: { path: path || '/main.tex' }
    };
  } catch (error) {
    console.error('[Overleaf CC] Error setting file content:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Create bridge client wrapper
 */
function createBridgeClient() {
  return {
    isConnected: () => {
      return bridgeWs?.readyState === WebSocket.OPEN;
    },

    sendMessage: async (message: any) => {
      if (!bridgeWs || bridgeWs.readyState !== WebSocket.OPEN) {
        throw new Error('Bridge WebSocket not connected');
      }

      const requestId = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      return new Promise((resolve, reject) => {
        // Store pending promise
        pendingRequests.set(requestId, { resolve, reject });
        // console.log('[Overleaf CC] Stored pending request:', requestId, 'Total pending:', pendingRequests.size);

        // Set up timeout
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            console.warn('[Overleaf CC] Request timeout:', requestId);
            pendingRequests.delete(requestId);
            reject(new Error('Bridge request timeout'));
          }
        }, 5000);

        // Send message with requestId
        const messageWithId = {
          ...message,
          requestId
        };

        // console.log('[Overleaf CC] Sending message to bridge:', JSON.stringify(messageWithId));
        bridgeWs.send(JSON.stringify(messageWithId));
      });
    }
  };
}

/**
 * Initialize sync manager
 */
async function initSyncManager(): Promise<void> {
  const bridge = createBridgeClient();

  // Connect to bridge first
  await connectToBridge();
  syncManager = new SyncManager(bridge);

  // Set up event listeners
  syncManager.on('sync:started', () => {
    console.log('[Overleaf CC] Sync started');
  });

  syncManager.on('sync:completed', (result: any) => {
    console.log('[Overleaf CC] Sync completed:', result);
    // Update dropdown
    dropdown?.updateSyncStatus('synced');
  });

  syncManager.on('conflict:detected', (conflict: any) => {
    console.warn('[Overleaf CC] Conflict detected:', conflict.path);
    // Show notification
    chrome.runtime.sendMessage({
      type: 'SHOW_NOTIFICATION',
      payload: {
        type: 'warning',
        title: 'Sync Conflict',
        message: `Conflict detected in ${conflict.path}`
      }
    });
  });

  syncManager.on('connection:changed', (status: string) => {
    console.log('[Overleaf CC] Connection status:', status);
    dropdown?.updateConnectionStatus(status as 'connected' | 'disconnected' | 'error');

    // Start polling if connected and in auto mode
    if (status === 'connected' && stateManager.getState().sync.mode === 'auto') {
      syncManager?.startPolling();
    }
  });

  syncManager.on('files:received', (files: any[]) => {
    // console.log('[Overleaf CC] Files received from bridge:', files.length);
    // TODO: Update Overleaf editor with received files
  });

  // Start polling if in auto mode
  if (stateManager.getState().sync.mode === 'auto') {
    syncManager.startPolling();
  }

  console.log('[Overleaf CC] Sync manager initialized');
}

/**
 * Terminal mode change callback
 */
function onTerminalChange(mode: 'local' | 'in-page'): void {
  console.log('[Overleaf CC] Terminal mode changed to:', mode);
  // Update state
  stateManager.setState({
    terminal: {
      ...stateManager.getState().terminal,
      mode
    }
  });

  // For now, always open local terminal
  // TODO: Implement in-page terminal in future work
  if (mode === 'local') {
    openTerminal();
  } else {
    console.log('[Overleaf CC] In-page terminal not yet implemented');
  }
}

/**
 * Sync mode change callback
 */
function onSyncModeChange(mode: 'auto' | 'manual'): void {
  console.log('[Overleaf CC] Sync mode changed to:', mode);

  // Update state
  stateManager.setState({
    sync: {
      ...stateManager.getState().sync,
      mode
    }
  });

  // Update sync manager mode
  if (syncManager) {
    syncManager.setMode(mode);
  }
}

/**
 * Subscribe to state changes and update dropdown
 */
function subscribeToStateChanges(): void {
  if (!dropdown) return;

  // Update connection status
  stateManager.subscribe('connection.bridge', (status) => {
    dropdown!.updateConnectionStatus(
      status === 'connected' ? 'connected' :
      status === 'error' ? 'error' : 'disconnected',
      status === 'error' ? stateManager.getState().connection.lastError || undefined : undefined
    );
  });

  // Update sync status
  stateManager.subscribe('sync.status', (status) => {
    dropdown!.updateSyncStatus(status, stateManager.getState().sync.pendingChanges || undefined);
  });

  // Update sync mode display
  stateManager.subscribe('sync.mode', (mode) => {
    dropdown!.setSyncMode(mode);
  });

  // Update terminal mode display
  stateManager.subscribe('terminal.mode', (mode) => {
    dropdown!.setTerminalMode(mode);
  });
}

function injectButton(): void {
  console.log('[Overleaf CC] Attempting to inject button...');

  // Find the menu bar using the exact selector
  const menuBar = document.querySelector('#ide-root > div.ide-redesign-main > nav > div.ide-redesign-toolbar-menu > div.ide-redesign-toolbar-menu-bar');

  if (!menuBar) {
    console.log('[Overleaf CC] Menu bar not found, trying alternative selector...');
    // Try alternative approach
    const altMenuBar = document.querySelector('.ide-redesign-toolbar-menu-bar');
    if (!altMenuBar) {
      console.log('[Overleaf CC] Still cannot find menu bar');
      return;
    }
    console.log('[Overleaf CC] Using alternative menu bar selector');
    injectIntoMenuBar(altMenuBar);
    return;
  }

  console.log('[Overleaf CC] Menu bar found!', menuBar);
  injectIntoMenuBar(menuBar);
}

function injectIntoMenuBar(menuBar: Element): void {
  // Check if button already exists
  if (document.getElementById('overleaf-cc-terminal-btn')) {
    console.log('[Overleaf CC] Button already exists');
    return;
  }

  // Find the Help button to use as reference
  const helpButton = menuBar.querySelector('#toolbar-menu-bar-item-help');

  // Create the terminal button
  const terminalButton = createTerminalButton();

  if (helpButton && helpButton.parentElement) {
    // Insert after the Help button
    helpButton.parentElement.parentNode?.insertBefore(
      terminalButton,
      helpButton.parentElement.nextSibling
    );
    console.log('[Overleaf CC] ? Terminal button injected after Help button!');
  } else {
    // Fallback: append to menu bar
    menuBar.appendChild(terminalButton);
    console.log('[Overleaf CC] ? Terminal button injected into menu bar!');
  }

  // Initialize dropdown after button is injected
  setTimeout(initDropdown, 100);
}

function init(): void {
  console.log('[Overleaf CC] Content script loaded');

  // Load state from storage
  stateManager.load().then(() => {
    console.log('[Overleaf CC] State loaded:', stateManager.getState());
  });

  // Inject notification styles
  injectNotificationStyles();

  // Set up message listener for bridge messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TASK_COMPLETE') {
      console.log('[Overleaf CC] Received TASK_COMPLETE:', message);
      syncManager?.handleTaskCompletion(message);
    }
    return true;
  });

  // Wait for page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(injectButton, 1000);
      setTimeout(setupFileTreeWatcher, 2000);
    });
  } else {
    setTimeout(injectButton, 1000);
    setTimeout(setupFileTreeWatcher, 2000);
  }

  // Also try after a longer delay
  setTimeout(injectButton, 3000);
  setTimeout(injectButton, 5000);
}

/**
 * Set up file tree watcher to detect file changes
 */
function setupFileTreeWatcher(): void {
  console.log('[Overleaf CC] Setting up file tree watcher...');

  // Track last known file count to detect actual changes
  let lastFileCount = -1;
  let lastFileList: string[] = [];

  // Helper function to count files and get their paths
  const getFileList = (): string[] => {
    const fileElements = document.querySelectorAll('[data-file-id]');
    return Array.from(fileElements).map(el => {
      const nameEl = el.querySelector('.name');
      return nameEl?.textContent || '';
    }).filter(Boolean);
  };

  // Helper function to check if file list actually changed
  const hasFileListChanged = (): boolean => {
    const currentFiles = getFileList();
    const currentCount = currentFiles.length;

    // Check if count changed
    if (currentCount !== lastFileCount) {
      lastFileCount = currentCount;
      lastFileList = currentFiles;
      return true;
    }

    // Check if file names changed (detect renames, additions, deletions)
    const filesChanged = currentFiles.length !== lastFileList.length ||
                        currentFiles.some(f => !lastFileList.includes(f));

    if (filesChanged) {
      lastFileList = currentFiles;
      return true;
    }

    return false;
  };

  // Try to find the file tree container
  const fileTreeSelectors = [
    '#ide-redesign-file-tree',
    '.file-tree-inner',
    '[data-test-selector="file-tree"]'
  ];

  for (const selector of fileTreeSelectors) {
    const fileTree = document.querySelector(selector);
    if (fileTree) {
      console.log(`[Overleaf CC] Found file tree with selector: ${selector}`);

      // Set up MutationObserver
      const observer = new MutationObserver((mutations) => {
        // Filter mutations to only relevant ones
        const hasRelevantChanges = mutations.some(mutation => {
          // Skip class changes on existing elements (usually folder expand/collapse)
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            return false;
          }

          // Skip style changes (usually animation-related)
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            return false;
          }

          // Only check for added/removed nodes
          if (mutation.type === 'childList') {
            const affectedNodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];

            return affectedNodes.some(node => {
              if (node instanceof HTMLElement) {
                // Only care about file items, not folder containers
                return node.matches('[data-file-id]') ||
                       node.querySelector('[data-file-id]');
              }
              return false;
            });
          }

          return false;
        });

        if (hasRelevantChanges) {
          console.log('[Overleaf CC] File tree mutation detected, checking if files actually changed...');

          // Debounce: wait for changes to settle
          clearTimeout((window as any).fileTreeChangeTimeout);
          (window as any).fileTreeChangeTimeout = setTimeout(() => {
            // Verify actual file list changed (not just folder expansion)
            if (hasFileListChanged()) {
              console.log('[Overleaf CC] File list actually changed, triggering sync...');

              if (syncManager && stateManager.getState().sync.mode === 'auto') {
                console.log('[Overleaf CC] Triggering auto-sync after file tree change');
                syncManager.syncFromOverleaf();
              }
            } else {
              console.log('[Overleaf CC] File list unchanged (likely folder expand/collapse), skipping sync');
            }
          }, 1000);
        }
      });

      // Start observing
      observer.observe(fileTree, {
        childList: true,
        subtree: true
      });

      // Initialize file count
      lastFileCount = getFileList().length;
      lastFileList = getFileList();
      console.log(`[Overleaf CC] Initial file count: ${lastFileCount}`);

      console.log('[Overleaf CC] File tree watcher active');
      return;
    }
  }

  console.log('[Overleaf CC] File tree not found, will retry later...');
  // Retry after a delay
  setTimeout(setupFileTreeWatcher, 5000);
}

/**
 * Start Overleaf WebSocket watcher for real-time change detection
 */
async function startOverleafWatcher(): Promise<void> {
  console.log('🔍 [Overleaf CC] Starting Overleaf change watcher...');

  try {
    const projectId = extractProjectId();
    const csrfToken = extractCSRFToken();

    if (!projectId || !csrfToken) {
      console.warn('⚠️  [Overleaf CC] Cannot start watcher: missing projectId or csrfToken');
      return;
    }

    // Get cookies
    const cookieResponse = await chrome.runtime.sendMessage({
      type: 'GET_COOKIES',
      domain: window.location.hostname
    }) as { overleaf_session2?: string; GCLB?: string };

    if (!cookieResponse.overleaf_session2) {
      console.warn('⚠️  [Overleaf CC] Cannot start watcher: missing cookies');
      return;
    }

    const auth = {
      cookieOverleafSession2: cookieResponse.overleaf_session2,
      cookieGCLB: cookieResponse.GCLB || '',
    };

    // Create WebSocket client
    overleafWsClient = new OverleafWebSocketClient();
    await overleafWsClient.connect(projectId, auth, csrfToken);
    await overleafWsClient.waitForProjectJoin();

    // Register change handler
    overleafWsClient.onChange(async (change) => {
      console.log(`📢 [Overleaf CC] Change detected: ${change.type} - ${change.path}`);

      if (change.type === 'deleted') {
        // File deleted in Overleaf
        console.log(`🗑️  [Overleaf CC] File deleted in Overleaf: ${change.path}`);

        if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
          bridgeWs.send(JSON.stringify({
            type: 'FILE_DELETED',
            data: {
              path: change.path,
              docId: change.docId
            }
          }));
          console.log(`✓ [Overleaf CC] Sent deletion notification to bridge: ${change.path}`);
        } else {
          console.warn(`⚠️  [Overleaf CC] Cannot sync deletion - bridge not connected`);
        }
        return;
      }

      // For modified and created files, fetch content from Overleaf
      let content: string | undefined;
      if (change.type === 'modified' || change.type === 'created') {
        if (change.docId) {
          try {
            const docInfo = overleafWsClient!.getDocInfo(change.docId);
            if (docInfo && docInfo.type === 'doc') {
              // Fetch document content via joinDoc
              const lines = await overleafWsClient!.joinDoc(change.docId);
              content = lines.join('\n');
              await overleafWsClient!.leaveDoc(change.docId);
              console.log(`✓ [Overleaf CC] Fetched content for ${change.path} (${content.length} chars)`);
            } else if (docInfo && docInfo.type === 'file') {
              // For binary files, we'd need to download and convert to base64
              // For now, skip binary files in change detection
              console.log(`⚠️  [Overleaf CC] Binary file change detected: ${change.path} (not supported yet)`);
              return;
            }
          } catch (error) {
            console.error(`❌ [Overleaf CC] Failed to fetch content for ${change.path}:`, error);
            return;
          }
        }
      }

      // Send change notification to bridge
      if (bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
        bridgeWs.send(JSON.stringify({
          type: 'FILE_CHANGED',
          data: {
            changeType: change.type,
            path: change.path,
            docId: change.docId,
            content
          }
        }));

        // More specific log message based on change type
        const actionMap = {
          'created': 'Synced file creation to bridge',
          'modified': 'Synced editor change to bridge',
          'deleted': 'Synced file deletion to bridge'
        };
        const action = actionMap[change.type] || 'Synced change to bridge';
        console.log(`✓ [Overleaf CC] ${action}: ${change.path}`);
      } else {
        console.warn('⚠️  [Overleaf CC] Bridge not connected, cannot notify of change');
      }
    });

    console.log('✅ [Overleaf CC] Overleaf change watcher active');

    // Also watch for local editor changes (when user types in Overleaf editor)
    startEditorWatcher();
  } catch (error) {
    console.error('❌ [Overleaf CC] Failed to start Overleaf watcher:', error);
    // Retry after delay
    setTimeout(startOverleafWatcher, 10000);
  }
}

/**
 * Watch for changes in the Overleaf editor
 * This detects when the user types in the editor by listening to edit events
 */
let editorChangeTimeout: NodeJS.Timeout | undefined;
let editorWatcherAttempts = 0;
let lastSyncedContent: string | undefined; // Track last synced content to avoid duplicate syncs

function startEditorWatcher(): void {
  editorWatcherAttempts++;

  // Limit retries
  if (editorWatcherAttempts > 10) {
    console.warn('⚠️  [Overleaf CC] Editor watcher max retries reached, giving up');
    return;
  }

  // Try to find the CodeMirror editor container
  const editorContainer = document.querySelector('#ide-redesign-panel-source-editor');

  if (editorContainer) {
    console.log('[Overleaf CC] Found CodeMirror editor container, setting up event listeners...');

    // Listen for actual edit events (typing, paste, etc.)
    const editEvents = ['input', 'keydown', 'paste', 'cut', 'drop'];

    editEvents.forEach(eventType => {
      editorContainer.addEventListener(eventType, () => {
        console.log(`🔍 [Overleaf CC] Edit event detected: ${eventType}`);

        // Debounce changes - only notify after user stops typing for 1 second
        if (editorChangeTimeout) {
          clearTimeout(editorChangeTimeout);
        }

        editorChangeTimeout = setTimeout(() => {
          console.log(`🔍 [Overleaf CC] Debounce timeout fired, checking current document...`);

          const currentDoc = getCurrentDocumentInfo();
          console.log(`🔍 [Overleaf CC] Current doc info:`, currentDoc);

          if (currentDoc) {
            console.log(`📝 [Overleaf CC] Editor change detected: ${currentDoc.path}`);

            // Fetch current content and send to bridge
            const content = getCurrentDocumentContent();
            console.log(`🔍 [Overleaf CC] Fetched content length: ${content?.length || 0}`);
            console.log(`🔍 [Overleaf CC] Bridge WS state: ${bridgeWs?.readyState}`);

            // Check if content actually changed (avoid duplicate syncs)
            if (content === lastSyncedContent) {
              console.log(`⏭️  [Overleaf CC] Content unchanged, skipping sync`);
              return;
            }

            // Check if content is not null/undefined (empty string is valid for new files)
            if (content !== null && content !== undefined && bridgeWs && bridgeWs.readyState === WebSocket.OPEN) {
              bridgeWs.send(JSON.stringify({
                type: 'FILE_CHANGED',
                data: {
                  changeType: 'modified',
                  path: currentDoc.path,
                  docId: currentDoc.id,
                  content
                }
              }));
              console.log(`✓ [Overleaf CC] Synced editor change to bridge: ${currentDoc.path}`);
              lastSyncedContent = content;
            } else {
              console.warn(`⚠️  [Overleaf CC] Cannot sync - content: ${content !== null && content !== undefined}, bridge: ${!!bridgeWs}, readyState: ${bridgeWs?.readyState}`);
            }
          } else {
            console.warn(`⚠️  [Overleaf CC] No current document info`);
          }
        }, 1000);
      }, { capture: true }); // Use capture phase to catch events before they're handled
    });

    console.log('✅ [Overleaf CC] Editor watcher active (event listeners)');
  } else {
    console.warn(`⚠️  [Overleaf CC] Editor container not found (attempt ${editorWatcherAttempts}/10), will retry...`);
    // Retry after delay
    setTimeout(startEditorWatcher, 2000);
  }
}

/**
 * Handle file change from bridge (local modification)
 */
function handleLocalFileChange(data: { path: string; changeType: string }): void {
  console.log(`📝 [Overleaf CC] Local file changed: ${data.changeType} - ${data.path}`);
  console.log(`💡 [Overleaf CC] Note: Local → Overleaf sync not yet implemented`);
}


init();
