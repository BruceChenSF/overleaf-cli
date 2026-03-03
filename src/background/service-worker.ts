import { overleafAPI } from './overleaf-api';
import type { ExtensionMessage, OpenTerminalMessage, SyncFileMessage } from '../shared/types';

let terminalWindowId: number | null = null;

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // Keep message channel open for async response
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
  // Validate session first
  try {
    await overleafAPI['getSessionCookie']();
  } catch (err) {
    throw new Error('Please login to Overleaf first');
  }

  // Close existing terminal if open
  if (terminalWindowId !== null) {
    try {
      await chrome.windows.remove(terminalWindowId);
    } catch {
      // Window might already be closed
    }
  }

  // Create new terminal window
  const window = await chrome.windows.create({
    url: chrome.runtime.getURL('terminal/index.html'),
    type: 'popup',
    width: 900,
    height: 600,
    focused: true
  });

  terminalWindowId = window.id ?? null;

  // Store project context for the window
  await chrome.storage.session.set({
    [`window_${window.id}`]: {
      projectId: message.projectId,
      projectUrl: message.projectUrl
    }
  });

  return { windowId: window.id ?? 0 };
}

async function syncFile(message: SyncFileMessage): Promise<void> {
  // TODO: Implement file sync with doc ID lookup
  console.log('Syncing file:', message.filepath);
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
