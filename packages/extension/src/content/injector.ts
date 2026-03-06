import { MirrorClient } from '../client';
import { EditMonitor } from './edit-monitor';

let mirrorClient: MirrorClient | null = null;
let editMonitor: EditMonitor | null = null;

// Extract project ID immediately (available at document_start)
function extractProjectId(): string | null {
  const urlMatch = window.location.pathname.match(/\/project\/([^/]+)/);
  return urlMatch ? urlMatch[1] : null;
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

    // 新增：启动编辑监测
    if (projectId) {
      editMonitor = new EditMonitor(projectId, mirrorClient);
      editMonitor.start();
    }

    console.log('[Mirror] Initialization complete');
  } catch (error) {
    console.error('[Mirror] Initialization failed:', error);
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
