import { MirrorClient } from '../client';
import { EditMonitor } from './edit-monitor';
import { OverleafWebSocketClient } from './overleaf-sync';
import { OverleafAPIHandler } from './overleaf-api-handler';
import { toggleDrawer, autoStartTerminal, cleanup as cleanupTerminal } from './terminal-drawer';

// 🔔 立即输出日志，确认脚本已加载
console.log('[Mirror] ✅ Content script loaded!');
console.log('[Mirror] Current URL:', window.location.href);
console.log('[Mirror] Ready state:', document.readyState);

/**
 * Inject animation and style CSS
 */
function injectStatusStyles(): void {
  // Check if already injected
  if (document.getElementById('mirror-status-styles')) return;

  const style = document.createElement('style');
  style.id = 'mirror-status-styles';
  style.textContent = `
    @keyframes mirror-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .mirror-status-icon {
      display: inline-block;
      width: 20px;
      height: 20px;
      vertical-align: middle;
      margin-right: 4px;
    }
    .mirror-status-icon.spinning {
      animation: mirror-spin 1s linear infinite;
    }
    .mirror-status-icon svg {
      width: 100%;
      height: 100%;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Loading state types
 */
type LoadingState =
  | 'connecting'
  | 'folders'
  | 'files'
  | 'ready'
  | 'error';

interface LoadingStatus {
  state: LoadingState;
  text: string;
}

/**
 * Get SVG icon path
 */
function getIconPath(state: LoadingState): string {
  const paths: Record<LoadingState, string> = {
    connecting: 'M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z',
    folders: 'M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z',
    files: 'M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z',
    ready: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
    error: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z'
  };

  return paths[state];
}

function getIconColor(state: LoadingState): string {
  const colors: Record<LoadingState, string> = {
    connecting: '#f59e0b',
    folders: '#f59e0b',
    files: '#f59e0b',
    ready: '#098842',
    error: '#d73a49'
  };
  return colors[state];
}

/**
 * Update loading status in UI
 */
function updateLoadingStatus(state: LoadingState, customText?: string): void {
  const claudeButton = document.getElementById('toolbar-menu-bar-item-claude');
  if (!claudeButton) return;

  const statusMap: Record<LoadingState, { text: string; spinning: boolean }> = {
    connecting: { text: 'Connecting...', spinning: true },
    folders: { text: 'Syncing folders...', spinning: true },
    files: { text: 'Syncing files...', spinning: true },
    ready: { text: 'Ready', spinning: false },
    error: { text: 'Error', spinning: false }
  };

  const status = statusMap[state];
  const displayText = customText || status.text;
  const color = getIconColor(state);
  const animationStyle = status.spinning ? 'animation: mirror-spin 1s linear infinite;' : '';

  // Set button disabled state (only clickable when ready)
  if (state === 'ready') {
    claudeButton.disabled = false;
    claudeButton.removeAttribute('aria-disabled');
    // Remove inline background-color to allow hover effects
    claudeButton.style.backgroundColor = '';
  } else {
    claudeButton.disabled = true;
    claudeButton.setAttribute('aria-disabled', 'true');
    // Keep transparent background for disabled state
    claudeButton.style.backgroundColor = 'transparent';
  }

  // Build button HTML with status icon + text only
  claudeButton.innerHTML = `
    <svg height="1em" style="flex:none;line-height:1;vertical-align: middle;${animationStyle}" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
      <title>${displayText}</title>
      <path d="${getIconPath(state)}" fill="${color}" fill-rule="nonzero"></path>
    </svg>
    <span style="vertical-align: middle;">${displayText}</span>
  `;

  // If ready, schedule transition to "Terminal" text after 1 second
  if (state === 'ready') {
    setTimeout(() => {
      const button = document.getElementById('toolbar-menu-bar-item-claude');
      if (button) {
        button.innerHTML = '<span style="vertical-align: middle;">Terminal</span>';
        // Remove background-color to allow hover effects
        button.style.backgroundColor = '';
      }
    }, 1000);
  }

  console.log(`[Mirror] Status: ${state} - ${displayText}`);
}

let mirrorClient: MirrorClient | null = null;
let editMonitor: EditMonitor | null = null;
let overleafWsClient: OverleafWebSocketClient | null = null;
let apiHandler: OverleafAPIHandler | null = null;

// Extract project ID immediately (available at document_start)
function extractProjectId(): string | null {
  const urlMatch = window.location.pathname.match(/\/project\/([^/]+)/);
  return urlMatch ? urlMatch[1] : null;
}

/**
 * Extract CSRF token from HTML meta tag
 * Overleaf embeds the CSRF token in a meta tag with name "ol-csrfToken"
 */
function extractCSRFToken(): string | null {
  const metaTag = document.querySelector('meta[name="ol-csrfToken"]') as HTMLMetaElement;
  return metaTag?.content || null;
}

/**
 * Check if Overleaf loading screen is still present
 */
function isLoadingScreenPresent(): boolean {
  const loadingScreen = document.querySelector('.loading-screen');
  return loadingScreen !== null && (loadingScreen as HTMLElement).offsetParent !== null;
}

/**
 * Wait for loading screen to disappear before initializing
 */
function waitForLoadingScreen(callback: () => void): void {
  if (!isLoadingScreenPresent()) {
    // No loading screen, proceed immediately
    console.log('[Mirror] ✓ No loading screen detected, proceeding with initialization');
    callback();
    return;
  }

  console.log('[Mirror] ⏳ Loading screen detected, waiting for it to disappear...');

  // Use MutationObserver to watch for loading screen removal
  const observer = new MutationObserver((mutations) => {
    if (!isLoadingScreenPresent()) {
      console.log('[Mirror] ✓ Loading screen disappeared, proceeding with initialization');
      observer.disconnect();
      callback();
    }
  });

  // Start observing the ide-root container
  const ideRoot = document.getElementById('ide-root');
  if (ideRoot) {
    observer.observe(ideRoot, {
      childList: true,
      subtree: true
    });
  } else {
    // Fallback: if ide-root not found, wait a bit and try again
    console.log('[Mirror] ⚠️ ide-root not found, retrying in 500ms...');
    setTimeout(() => waitForLoadingScreen(callback), 500);
  }

  // Fallback timeout: if loading screen doesn't disappear after 30 seconds, proceed anyway
  setTimeout(() => {
    if (isLoadingScreenPresent()) {
      console.warn('[Mirror] ⚠️ Loading screen timeout (30s), proceeding with initialization anyway');
      observer.disconnect();
      callback();
    }
  }, 30000);
}

const projectId = extractProjectId();
if (!projectId) {
  console.log('[Mirror] Not a project page, skipping');
} else {
  console.log('[Mirror] Project ID:', projectId);

  // Send project ID to background script (for webRequest interceptor)
  try {
    chrome.runtime.sendMessage({
      type: 'SET_PROJECT_ID',
      projectId: projectId
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Mirror] Failed to send project ID to background:', chrome.runtime.lastError.message);
      } else {
        console.log('[Mirror] Project ID sent to background script');
      }
    });
  } catch (error) {
    console.error('[Mirror] Error sending message to background:', error);
  }

  // Wait for DOM to load and loading screen to disappear
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      waitForLoadingScreen(initializeMirror);
    });
  } else {
    // DOM already loaded, check for loading screen
    waitForLoadingScreen(initializeMirror);
  }
}

async function initializeMirror(): Promise<void> {
  console.log('[Mirror] 🚀 initializeMirror() called!');

  // 🔧 自动启动终端（在后台初始化并连接，不显示抽屉）
  console.log('[Mirror] 🖥️ Auto-starting terminal...');
  autoStartTerminal().catch(err => {
    console.warn('[Mirror] Terminal auto-start failed (non-critical):', err);
  });

  // 🔧 注入 Claude 按钮到工具栏（独立于 WebSocket 连接）
  console.log('[Mirror] 🎯 About to call injectClaudeButton()...');
  injectClaudeButton();

  // 🔧 创建初始状态显示
  updateLoadingStatus('connecting');

  // 如果第一次注入失败，等待DOM完全加载后重试
  console.log('[Mirror] ⏰ Scheduling button injection retries...');
  setTimeout(() => {
    console.log('[Mirror] ⏰ Retry 1: injecting Claude button...');
    injectClaudeButton();
    updateLoadingStatus('connecting');
  }, 1000);

  setTimeout(() => {
    console.log('[Mirror] ⏰ Retry 2: injecting Claude button...');
    injectClaudeButton();
    updateLoadingStatus('connecting');
  }, 3000);

  setTimeout(() => {
    console.log('[Mirror] ⏰ Retry 3: injecting Claude button...');
    injectClaudeButton();
    updateLoadingStatus('connecting');
  }, 5000);

  // 以下是 WebSocket 相关的初始化（可能失败）
  try {
    console.log('[Mirror] Initializing WebSocket connection...');

    // Update status to connecting
    updateLoadingStatus('connecting');

    mirrorClient = new MirrorClient();
    await mirrorClient.connect();

    console.log('[Mirror] ✅ Connected to Mirror Server');

    // 🔧 新增：立即获取并发送 cookies
    await sendCookiesToServer();

    // 🔧 新增：告诉服务器开始初始同步（这会触发 enableFileSync 检查）
    console.log('[Mirror] 🔄 Telling server to start initial sync...');
    mirrorClient.send({
      type: 'sync' as const,
      project_id: projectId,
      operation: 'initial_sync',
      timestamp: Date.now()
    });
    console.log('[Mirror] ✅ Initial sync message sent to server');

    // 🔧 新增：请求初始同步并监听文件变化
    await requestInitialSync();

    // 启动编辑监测（仅在初始同步完成后）
    if (projectId) {
      editMonitor = new EditMonitor(projectId, mirrorClient);
      editMonitor.start();
    }

    // Create API Handler
    apiHandler = new OverleafAPIHandler(mirrorClient, projectId, overleafWsClient);

    // Register message handler
    mirrorClient.onMessage((message: any) => {
      if (message.type === 'sync_to_overleaf') {
        console.log('[Mirror] Received sync_to_overleaf request:', message);
        apiHandler.handleSyncRequest(message).catch((error) => {
          console.error('[Mirror] ❌ Error handling sync request:', error);
        });
      }
    });

    console.log('[Mirror] ✅ Overleaf API Handler registered');
    console.log('[Mirror] ✅ Initialization complete (including Overleaf sync)');
  } catch (error) {
    console.error('[Mirror] ❌ Initialization failed:', error);
    updateLoadingStatus('error');
  }
}

/**
 * 获取并发送 cookies 到 Mirror Server
 */
async function sendCookiesToServer(): Promise<void> {
  if (!projectId) return;

  console.log('[Mirror] 🍪 Sending cookies to Mirror Server...');

  try {
    const cookies = await getCookies();
    const csrfToken = extractCSRFToken();

    console.log('[Mirror] 🍪 CSRF Token:', csrfToken ? `${csrfToken.substring(0, 20)}...` : '(not found)');

    const message = {
      type: 'mirror' as const,
      project_id: projectId,
      cookies: cookies,
      csrf_token: csrfToken,
      timestamp: Date.now()
    };

    mirrorClient!.send(message);
    console.log('[Mirror] ✅ Cookies sent to Mirror Server:', Object.keys(cookies).length, 'cookies');
  } catch (error) {
    console.error('[Mirror] ❌ Failed to send cookies:', error);
  }
}

/**
 * 将 ArrayBuffer 转换为 Base64（避免堆栈溢出）
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;

  // 分块处理，避免堆栈溢出
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

/**
 * 请求初始同步（使用浏览器扩展直接执行同步）
 */
async function requestInitialSync(): Promise<void> {
  if (!projectId) return;

  console.log('[Mirror] 🔄 Starting initial sync...');

  try {
    // Get cookies
    const cookies = await getCookies();
    const csrfToken = extractCSRFToken();

    if (!csrfToken) {
      console.error('[Mirror] ❌ No CSRF token found');
      updateLoadingStatus('error');
      return;
    }

    console.log('[Mirror] ✅ CSRF Token:', csrfToken.substring(0, 20) + '...');

    // Create auth object
    const auth = {
      cookieOverleafSession2: cookies['overleaf_session2'] || '',
      cookieGCLB: cookies['GCLB']
    };

    console.log('[Mirror] 🔌 Connecting to Overleaf WebSocket...');

    // 🔧 Auto-detect domain from current page to avoid CORS issues
    const currentDomain = window.location.hostname;
    console.log('[Mirror] 🌐 Detected domain:', currentDomain);

    // Create and connect WebSocket client with auto-detected domain
    overleafWsClient = new OverleafWebSocketClient(
      projectId,
      auth,
      csrfToken,
      currentDomain
    );

    await overleafWsClient.connect();
    console.log('[Mirror] ✅ Connected to Overleaf WebSocket');

    // 🔥 Expose docIdToPath mapping globally for EditorUpdater to use
    (window as any).__overleaf_docIdToPath__ = overleafWsClient.getDocIdToPathMap();
    console.log('[Mirror] ✅ Exposed docIdToPath mapping to global');

    // 🔧 Sync all folders first (before files)
    console.log('[Mirror] 📁 Syncing folder structure from Overleaf...');
    updateLoadingStatus('folders');

    const syncedFolders = await overleafWsClient.syncAllFolders();
    console.log('[Mirror] ✅ Synced', syncedFolders.length, 'folders from Overleaf');

    // Update status with folder count
    updateLoadingStatus('folders', `Syncing ${syncedFolders.length} folders...`);

    // Send folder creation events to mirror server
    console.log('[Mirror] 📤 Sending folder creation events to mirror server...');

    let folderCount = 0;
    for (const folderPath of syncedFolders) {
      const message = {
        type: 'directory_created' as const,
        project_id: projectId,
        path: folderPath,
        folder_id: '',  // Will be filled by server from docId mapping
        timestamp: Date.now()
      };

      mirrorClient!.send(message);
      folderCount++;

      // Update status every 10 folders
      if (folderCount % 10 === 0) {
        updateLoadingStatus('folders', `Syncing folders (${folderCount}/${syncedFolders.length})...`);
      }

      console.log('[Mirror] ✅ Sent folder creation:', folderPath);
    }

    console.log('[Mirror] ✅ All folders sent to mirror server');

    // Sync all files
    console.log('[Mirror] 📄 Syncing files from Overleaf...');
    updateLoadingStatus('files');

    const syncedFiles = await overleafWsClient.syncAllFiles();
    console.log('[Mirror] ✅ Synced', syncedFiles.length, 'files from Overleaf');

    // Update status with file count
    updateLoadingStatus('files', `Syncing ${syncedFiles.length} files...`);

    // Send files to mirror server
    console.log('[Mirror] 📤 Sending files to mirror server...');

    let fileCount = 0;
    for (const file of syncedFiles) {
      const message = {
        type: 'file_sync' as const,
        project_id: projectId,
        path: file.path,
        content_type: file.type,
        doc_id: file.docId,  // 🔧 Include docId for mapping
        content: file.type === 'file'
          ? arrayBufferToBase64(file.content as ArrayBuffer)
          : file.content,
        timestamp: Date.now()
      };

      mirrorClient!.send(message);
      fileCount++;

      // Update status every 5 files
      if (fileCount % 5 === 0) {
        updateLoadingStatus('files', `Syncing files (${fileCount}/${syncedFiles.length})...`);
      }

      console.log('[Mirror] ✅ Sent:', file.path, `(${file.type === 'file' ? (file.content as ArrayBuffer).byteLength : (file.content as string).length} bytes/chars)`);
    }

    console.log('[Mirror] ✅ Initial sync complete!');

    // Update status to ready
    updateLoadingStatus('ready');

    // 🔧 NEW: Send initial_sync_complete message to server
    console.log('[Mirror] 📤 Sending initial_sync_complete message to server...');
    mirrorClient!.send({
      type: 'initial_sync_complete' as const,
      project_id: projectId,
      timestamp: Date.now()
    });
    console.log('[Mirror] ✅ Initial sync complete message sent');

    // 🔧 Register callback for file operation events (keep connection alive)
    overleafWsClient.onChange(async (change) => {
      console.log(`[Mirror] 📢 File operation detected: ${change.type} - ${change.path}${change.isDirectory ? ' (📁 DIRECTORY)' : ''}`);

      if (change.type === 'created') {
        // Check if this is a directory creation
        const isDirectory = change.isDirectory || false;

        if (isDirectory) {
          // 🔔 NEW: Directory created - log and send message to server
          console.log(`[Mirror] 📁 [PLACEHOLDER] Directory creation detected in Overleaf`);
          console.log(`[Mirror]    Path: ${change.path}`);
          console.log(`[Mirror]    Folder ID: ${change.docId}`);
          console.log(`[Mirror] ⚠️ [TODO] Directory creation not yet implemented`);

          if (mirrorClient && projectId) {
            // Send directory creation event to mirror server
            mirrorClient.send({
              type: 'directory_created' as const,
              project_id: projectId,
              path: change.path,
              folder_id: change.docId,
              timestamp: Date.now()
            });
            console.log(`[Mirror] 📤 Sent directory creation event to server: ${change.path}`);
          }
        } else {
          // New file created - fetch content and send to server
          if (mirrorClient && projectId) {
            try {
              const docInfo = overleafWsClient!.getDocInfo(change.docId);
              if (docInfo) {
                let content: string | ArrayBuffer;

                if (docInfo.type === 'doc') {
                  // Fetch document content
                  const lines = await overleafWsClient!.joinDoc(change.docId);
                  await overleafWsClient!.leaveDoc(change.docId);
                  content = lines.join('\n');
                  console.log(`[Mirror] ✅ Fetched content for ${change.path} (${content.length} chars)`);
                } else {
                  // For binary files, download via blob
                  content = await overleafWsClient!.downloadFile(change.docId);
                  console.log(`[Mirror] ✅ Downloaded ${change.path} (${(content as ArrayBuffer).byteLength} bytes)`);
                }

                // Send file creation event to mirror server
                mirrorClient.send({
                  type: 'file_created' as const,
                  project_id: projectId,
                  file_name: change.path,
                  file_id: change.docId,
                  timestamp: Date.now()
                });

                // Send file content
                mirrorClient.send({
                  type: 'file_sync' as const,
                  project_id: projectId,
                  path: change.path,
                  content_type: docInfo.type,
                  doc_id: change.docId,  // 🔧 Include docId
                  content: docInfo.type === 'file' ? arrayBufferToBase64(content as ArrayBuffer) : content as string,
                  timestamp: Date.now()
                });

                console.log(`[Mirror] ✅ Synced new file to mirror server: ${change.path}`);
              }
            } catch (error) {
              console.error(`[Mirror] ❌ Failed to sync new file ${change.path}:`, error);
            }
          }
        }
      } else if (change.type === 'deleted') {
        // File or folder deleted - send deletion event to server
        if (mirrorClient && projectId) {
          const isDirectory = change.isDirectory || false;

          if (isDirectory) {
            // Directory deleted
            console.log(`[Mirror] 📁 Directory deletion detected: ${change.path}`);
            mirrorClient.send({
              type: 'directory_deleted' as const,
              project_id: projectId,
              path: change.path,
              folder_id: change.docId,
              timestamp: Date.now()
            });
            console.log(`[Mirror] ✅ Sent directory deletion event: ${change.path}`);
          } else {
            // File deleted
            mirrorClient.send({
              type: 'file_deleted' as const,
              project_id: projectId,
              file_id: change.docId,
              path: change.path,
              timestamp: Date.now()
            });
            console.log(`[Mirror] ✅ Sent file deletion event: ${change.path}`);
          }
        }
      } else if (change.type === 'renamed') {
        // File or folder renamed - send rename event to server
        if (mirrorClient && projectId && change.oldPath) {
          const isDirectory = change.isDirectory || false;

          if (isDirectory) {
            // Directory renamed
            console.log(`[Mirror] 📁 Directory rename detected: ${change.oldPath} -> ${change.path}`);
            mirrorClient.send({
              type: 'directory_renamed' as const,
              project_id: projectId,
              old_path: change.oldPath,
              new_path: change.path,
              folder_id: change.docId,
              timestamp: Date.now()
            });
            console.log(`[Mirror] ✅ Sent directory rename event: ${change.oldPath} -> ${change.path}`);
          } else {
            // File renamed
            mirrorClient.send({
              type: 'file_renamed' as const,
              project_id: projectId,
              old_name: change.oldPath,
              new_name: change.path,
              file_id: change.docId,
              timestamp: Date.now()
            });
            console.log(`[Mirror] ✅ Sent file rename event: ${change.oldPath} -> ${change.path}`);
          }
        }
      }
    });

    console.log('[Mirror] ✅ File operation monitoring enabled');
  } catch (error) {
    console.error('[Mirror] ❌ Initial sync failed:', error);
  }
}

/**
 * 获取当前页面的所有 cookies
 */
async function getCookies(): Promise<{ [key: string]: string }> {
  console.log('[Mirror] 🔑 Getting cookies for:', window.location.href);

  try {
    // 使用 Chrome Extension API 获取 cookies
    const cookies = await new Promise<chrome.cookies.Cookie[]>((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'GET_COOKIES',
        url: window.location.href
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response?.cookies || []);
        }
      });
    });

    // 转换为 key-value 格式
    const cookieMap: { [key: string]: string } = {};
    for (const cookie of cookies) {
      if (cookie.name && cookie.value) {
        cookieMap[cookie.name] = cookie.value;
      }
    }

    console.log('[Mirror] 🍪 Got cookies:', Object.keys(cookieMap));
    return cookieMap;
  } catch (error) {
    console.error('[Mirror] ❌ Failed to get cookies:', error);
    return {};
  }
}

/**
 * Create Claude button with SVG icon
 */
function createClaudeButton(): HTMLElement {
  // Inject styles if not already injected
  injectStatusStyles();

  const wrapper = document.createElement('div');
  wrapper.className = 'dropdown';
  wrapper.id = 'mirror-claude-btn';
  wrapper.style.position = 'relative';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'toolbar-menu-bar-item-claude';
  button.className = 'ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued menu-bar-toggle dropdown-toggle btn btn-secondary';
  button.disabled = true; // Initially disabled
  button.setAttribute('aria-disabled', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.style.cssText = `
    background-color: transparent;
    color: rgb(244, 245, 246);
    opacity: 1;
  `;

  button.addEventListener('click', () => {
    console.log('[Mirror] Claude button clicked!');
    toggleDrawer();
  });

  wrapper.appendChild(button);
  return wrapper;
}

/**
 * Inject Claude button into toolbar
 */
function injectClaudeButton(): void {
  console.log('[Mirror] Attempting to inject Claude button...');

  // Try to find the menu bar
  const menuBar = document.querySelector('#ide-root > div.ide-redesign-main > nav > div.ide-redesign-toolbar-menu > div.ide-redesign-toolbar-menu-bar');

  if (!menuBar) {
    console.log('[Mirror] Menu bar not found, trying alternative selector...');
    const altMenuBar = document.querySelector('.ide-redesign-toolbar-menu-bar');
    if (!altMenuBar) {
      console.log('[Mirror] Menu bar not found, will retry later...');
      return;
    }
    console.log('[Mirror] Found menu bar using alternative selector');
    injectIntoMenuBar(altMenuBar);
    return;
  }

  console.log('[Mirror] Found menu bar!');
  injectIntoMenuBar(menuBar);
}

/**
 * Inject button into menu bar element
 */
function injectIntoMenuBar(menuBar: Element): void {
  // Check if button already exists
  if (document.getElementById('mirror-claude-btn')) {
    console.log('[Mirror] Claude button already exists');
    return;
  }

  // Debug: Log menu bar children
  console.log('[Mirror] Menu bar children count:', menuBar.children.length);
  Array.from(menuBar.children).forEach((child, i) => {
    console.log(`[Mirror] Child ${i}:`, child.className, child.id);
  });

  // Find the Help button
  const helpButton = menuBar.querySelector('#toolbar-menu-bar-item-help');
  console.log('[Mirror] Help button found:', !!helpButton);

  // Create the Claude button
  const claudeButton = createClaudeButton();

  if (helpButton && helpButton.parentElement) {
    // Insert after the Help button's parent div
    const helpParent = helpButton.parentElement;
    menuBar.insertBefore(claudeButton, helpParent.nextSibling);
    console.log('[Mirror] ✓ Claude button injected after Help button!');
  } else {
    // Fallback: append to menu bar
    menuBar.appendChild(claudeButton);
    console.log('[Mirror] ✓ Claude button appended to menu bar!');
  }
}

window.addEventListener('beforeunload', () => {
  if (editMonitor) {
    editMonitor.stop();
  }
  if (overleafWsClient) {
    overleafWsClient.disconnect();
  }
  if (mirrorClient) {
    mirrorClient.disconnect();
  }
  if (apiHandler) {
    apiHandler = null;
  }

  // Cleanup terminal drawer
  cleanupTerminal();
});
