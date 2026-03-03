import type { ExtensionMessage, OpenTerminalMessage } from '../shared/types';

let terminalWindowId: number | null = null;

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

    default:
      throw new Error(`Unknown message type: ${(message as any).type}`);
  }
}

async function openTerminal(message: OpenTerminalMessage): Promise<{ windowId: number }> {
  console.log('[Service Worker] OPEN_TERMINAL request received');

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
      projectUrl: message.projectUrl,
      csrfToken: message.csrfToken
    }
  });

  console.log('[Service Worker] Terminal window created:', window.id);

  return { windowId: window.id ?? 0 };
}
