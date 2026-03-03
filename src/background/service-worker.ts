import { overleafAPI } from './overleaf-api';
import { SyncManager } from './sync-manager';
import type { ExtensionMessage, OpenTerminalMessage, SyncFileMessage } from '../shared/types';

let terminalWindowId: number | null = null;
const syncManagers = new Map<string, SyncManager>();

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message: ExtensionMessage): Promise<any> {
  switch (message.type) {
    case 'OPEN_TERMINAL':
      return await openTerminal(message);

    case 'SYNC_FILE':
      return await syncFile(message);

    case 'FETCH_FILES':
      return await fetchProjectFiles(message.projectId);

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

async function openTerminal(message: OpenTerminalMessage): Promise<{ windowId: number }> {
  console.log('[Service Worker] OPEN_TERMINAL request received:', message);

  // Skip API validation for now and just open terminal
  console.log('[Service Worker] Opening terminal (API integration disabled for now)');

  if (terminalWindowId !== null) {
    try {
      await chrome.windows.remove(terminalWindowId);
    } catch {
      // Window might already be closed
    }
  }

  const window = await chrome.windows.create({
    url: chrome.runtime.getURL('src/terminal/index.html'),
    type: 'popup',
    width: 900,
    height: 600,
    focused: true
  });

  terminalWindowId = window.id ?? null;

  await chrome.storage.session.set({
    [`window_${window.id}`]: {
      projectId: message.projectId,
      projectUrl: message.projectUrl
    }
  });

  console.log('[Service Worker] Terminal window created:', window.id);

  return { windowId: window.id ?? 0 };
}

async function syncFile(message: SyncFileMessage): Promise<void> {
  const syncManager = syncManagers.get(message.projectId);

  if (!syncManager) {
    console.warn(`No sync manager for project ${message.projectId}`);
    return;
  }

  await syncManager.syncFile(message.filepath, message.content);
}

async function fetchProjectFiles(projectId: string): Promise<any> {
  const docs = await overleafAPI.getAllDocs(projectId);

  const files = await Promise.all(
    docs.map(async (doc) => ({
      ...doc,
      content: await overleafAPI.getDocContent(projectId, doc._id)
    }))
  );

  return { files };
}
