import type { ExtensionMessage, OpenTerminalMessage, GetCookiesMessage, CookiesResponse } from '../shared/types';

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

    case 'GET_COOKIES':
      return await getCookies(message);

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

async function getCookies(message: GetCookiesMessage): Promise<CookiesResponse> {
  console.log('[Service Worker] GET_COOKIES request for domain:', message.domain);

  // Try multiple domain formats to find cookies
  const domainVariants = [
    message.domain,
    `.${message.domain}`,  // Add leading dot for subdomain wildcard
  ];

  // Extract base domain for Overleaf
  const baseDomainMatch = message.domain.match(/overleaf\.com$/);
  if (baseDomainMatch) {
    domainVariants.push('.overleaf.com', 'overleaf.com');
  }

  console.log('[Service Worker] Trying domain variants:', domainVariants);

  let allCookies: chrome.cookies.Cookie[] = [];
  for (const domain of domainVariants) {
    const cookies = await chrome.cookies.getAll({ domain });
    console.log(`[Service Worker] Domain ${domain}: found ${cookies.length} cookies`);
    allCookies = allCookies.concat(cookies);
  }

  // Remove duplicates
  const uniqueCookies = Array.from(
    new Map(allCookies.map(c => [c.name + c.domain, c])).values()
  );

  console.log('[Service Worker] All unique cookies:', uniqueCookies.map(c => `${c.name} (domain: ${c.domain})`));

  const response: CookiesResponse = {
    overleaf_session2: uniqueCookies.find(c => c.name === 'overleaf_session2')?.value,
    GCLB: uniqueCookies.find(c => c.name === 'GCLB')?.value,
  };

  console.log('[Service Worker] Returning cookies:', {
    overleaf_session2: response.overleaf_session2 ? `${response.overleaf_session2.substring(0, 10)}...` : undefined,
    GCLB: response.GCLB
  });

  return response;
}
