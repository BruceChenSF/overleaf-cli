import { MirrorClient } from '../client';
import { EditMonitor } from './edit-monitor';
import { OverleafWebSocketClient } from './overleaf-sync';
import { OverleafAPIHandler } from './overleaf-api-handler';
import { toggleDrawer, autoStartTerminal, cleanup as cleanupTerminal } from './terminal-drawer';

// 🔔 立即输出日志，确认脚本已加载
console.log('[Mirror] ✅ Content script loaded!');
console.log('[Mirror] Current URL:', window.location.href);
console.log('[Mirror] Ready state:', document.readyState);

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

  // Wait for DOM to load before connecting WebSocket
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMirror);
  } else {
    // DOM already loaded, initialize immediately
    initializeMirror();
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

  // 如果第一次注入失败，等待DOM完全加载后重试
  console.log('[Mirror] ⏰ Scheduling button injection retries...');
  setTimeout(() => {
    console.log('[Mirror] ⏰ Retry 1: injecting Claude button...');
    injectClaudeButton();
  }, 1000);

  setTimeout(() => {
    console.log('[Mirror] ⏰ Retry 2: injecting Claude button...');
    injectClaudeButton();
  }, 3000);

  setTimeout(() => {
    console.log('[Mirror] ⏰ Retry 3: injecting Claude button...');
    injectClaudeButton();
  }, 5000);

  // 以下是 WebSocket 相关的初始化（可能失败）
  try {
    console.log('[Mirror] Initializing WebSocket connection...');

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

    // 🔧 NEW: Sync all folders first (before files)
    console.log('[Mirror] 📁 Syncing folder structure from Overleaf...');
    const syncedFolders = await overleafWsClient.syncAllFolders();
    console.log('[Mirror] ✅ Synced', syncedFolders.length, 'folders from Overleaf');

    // Send folder creation events to mirror server
    console.log('[Mirror] 📤 Sending folder creation events to mirror server...');

    for (const folderPath of syncedFolders) {
      const message = {
        type: 'directory_created' as const,
        project_id: projectId,
        path: folderPath,
        folder_id: '',  // Will be filled by server from docId mapping
        timestamp: Date.now()
      };

      mirrorClient!.send(message);
      console.log('[Mirror] ✅ Sent folder creation:', folderPath);
    }

    console.log('[Mirror] ✅ All folders sent to mirror server');

    // Sync all files
    const syncedFiles = await overleafWsClient.syncAllFiles();

    console.log('[Mirror] ✅ Synced', syncedFiles.length, 'files from Overleaf');

    // Send files to mirror server
    console.log('[Mirror] 📤 Sending files to mirror server...');

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
      console.log('[Mirror] ✅ Sent:', file.path, `(${file.type === 'file' ? (file.content as ArrayBuffer).byteLength : (file.content as string).length} bytes/chars)`);
    }

    console.log('[Mirror] ✅ Initial sync complete!');

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
        // File deleted - send deletion event to server
        if (mirrorClient && projectId) {
          mirrorClient.send({
            type: 'file_deleted' as const,
            project_id: projectId,
            file_id: change.docId,
            path: change.path,
            timestamp: Date.now()
          });
          console.log(`[Mirror] ✅ Sent file deletion event: ${change.path}`);
        }
      } else if (change.type === 'renamed') {
        // File renamed - send rename event to server
        if (mirrorClient && projectId && change.oldPath) {
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
  const wrapper = document.createElement('div');
  wrapper.className = 'dropdown';
  wrapper.id = 'mirror-claude-btn';
  wrapper.style.position = 'relative';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'toolbar-menu-bar-item-claude';
  button.className = 'ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued menu-bar-toggle dropdown-toggle btn btn-secondary';
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `
    <svg height="1em" style="flex:none;line-height:1;vertical-align: middle;" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg">
      <title>Claude</title>
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fill-rule="nonzero"></path>
    </svg>
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
