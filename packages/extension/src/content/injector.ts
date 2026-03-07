import { MirrorClient } from '../client';
import { EditMonitor } from './edit-monitor';
import { OverleafWebSocketClient } from './overleaf-sync';

let mirrorClient: MirrorClient | null = null;
let editMonitor: EditMonitor | null = null;

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

    // 🔧 新增：拦截文档获取请求
    interceptDocRequests();

    // 🔧 新增：请求初始同步
    requestInitialSync();

    // 启动编辑监测
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
 * 拦截 blob 请求，提取 blob hash 映射
 */
function interceptDocRequests(): void {
  console.log('[Mirror] 🔍 Setting up blob request interception...');

  // 劫持 fetch
  const originalFetch = window.fetch;
  window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // 🔧 检查是否是 blob 请求（文档内容获取）
    if (url.includes('/project/') && url.includes('/blob/')) {
      console.log('[Mirror] 📥 Detected blob fetch:', url);

      // 从 URL 中提取 blob hash
      // 格式: /project/{projectId}/blob/{blobHash}
      const match = url.match(/\/project\/[^/]+\/blob\/([a-f0-9]+)/);
      if (match) {
        const blobHash = match[1];
        console.log('[Mirror] 📋 Found blob hash:', blobHash);

        // 🔧 需要从编辑器状态中获取当前文件名
        const currentFile = getCurrentFileName();
        if (currentFile) {
          console.log('[Mirror] 📄 Current file:', currentFile);

          // 发送映射关系到服务器
          if (mirrorClient && projectId) {
            mirrorClient.send({
              type: 'blob_mapping' as const,
              project_id: projectId,
              blob_hash: blobHash,
              filename: currentFile,
              url: url
            });
            console.log('[Mirror] ✅ Sent blob mapping to server:', currentFile, '->', blobHash);
          }
        }
      }
    }

    // 调用原始 fetch
    return originalFetch.call(this, input, init);
  };

  console.log('[Mirror] ✅ Blob request interception set up');
}

/**
 * 获取当前编辑的文件名
 */
function getCurrentFileName(): string | null {
  try {
    // 方法 1: 从 URL 路径提取
    const urlPath = window.location.pathname;
    const pathMatch = urlPath.match(/\/project\/[^/]+\/doc\/(.+)$/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }

    // 方法 2: 从编辑器状态获取
    if ((window as any).editor?.documentManager) {
      const currentDoc = (window as any).editor.documentManager.getCurrentDoc();
      if (currentDoc?.name) {
        return currentDoc.name;
      }
    }

    return null;
  } catch (error) {
    console.error('[Mirror] ❌ Error getting current file name:', error);
    return null;
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
    const wsClient = new OverleafWebSocketClient(
      projectId,
      auth,
      csrfToken
    );

    await wsClient.connect();
    console.log('[Mirror] ✅ Connected to Overleaf WebSocket');

    // Sync all files
    const syncedFiles = await wsClient.syncAllFiles();

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
          ? btoa(String.fromCharCode(...(new Uint8Array(file.content as ArrayBuffer))))
          : file.content,
        timestamp: Date.now()
      };

      mirrorClient!.send(message);
      console.log('[Mirror] ✅ Sent:', file.path, `(${file.type === 'file' ? (file.content as ArrayBuffer).byteLength : (file.content as string).length} bytes/chars)`);
    }

    console.log('[Mirror] ✅ Initial sync complete!');

    // Disconnect from Overleaf WebSocket
    wsClient.disconnect();
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
  if (mirrorClient) {
    mirrorClient.disconnect();
  }
});
