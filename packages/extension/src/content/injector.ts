import { MirrorClient } from '../client';
import { EditMonitor } from './edit-monitor';
import { OverleafWebSocketClient } from './overleaf-sync';

let mirrorClient: MirrorClient | null = null;
let editMonitor: EditMonitor | null = null;
let overleafWsClient: OverleafWebSocketClient | null = null;

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
  try {
    console.log('[Mirror] Initializing WebSocket connection...');

    mirrorClient = new MirrorClient();
    await mirrorClient.connect();

    console.log('[Mirror] ✅ Connected to Mirror Server');

    // 🔧 新增：立即获取并发送 cookies
    await sendCookiesToServer();

    // 🔧 新增：请求初始同步并监听文件变化
    await requestInitialSync();

    // 启动编辑监测（仅在初始同步完成后）
    if (projectId) {
      editMonitor = new EditMonitor(projectId, mirrorClient);
      editMonitor.start();
    }

    console.log('[Mirror] ✅ Initialization complete');
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

    // Create and connect WebSocket client
    overleafWsClient = new OverleafWebSocketClient(
      projectId,
      auth,
      csrfToken
    );

    await overleafWsClient.connect();
    console.log('[Mirror] ✅ Connected to Overleaf WebSocket');

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
        content: file.type === 'file'
          ? arrayBufferToBase64(file.content as ArrayBuffer)
          : file.content,
        timestamp: Date.now()
      };

      mirrorClient!.send(message);
      console.log('[Mirror] ✅ Sent:', file.path, `(${file.type === 'file' ? (file.content as ArrayBuffer).byteLength : (file.content as string).length} bytes/chars)`);
    }

    console.log('[Mirror] ✅ Initial sync complete!');

    // 🔧 Register callback for file operation events (keep connection alive)
    overleafWsClient.onChange(async (change) => {
      console.log(`[Mirror] 📢 File operation detected: ${change.type} - ${change.path}`);

      if (change.type === 'created') {
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
                content: docInfo.type === 'file' ? arrayBufferToBase64(content as ArrayBuffer) : content as string,
                timestamp: Date.now()
              });

              console.log(`[Mirror] ✅ Synced new file to mirror server: ${change.path}`);
            }
          } catch (error) {
            console.error(`[Mirror] ❌ Failed to sync new file ${change.path}:`, error);
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
});
