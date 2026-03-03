import type { OpenTerminalMessage } from '../shared/types';

function extractProjectId(): string | null {
  const match = window.location.href.match(/\/project\/([a-f0-9]+)/i);
  return match ? match[1] : null;
}

function createTerminalButton(): HTMLElement {
  const button = document.createElement('button');
  button.id = 'overleaf-cc-terminal-btn';
  button.className = 'btn-btn-default';
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 3v10h16V3H0zm15 9H1V4h14v8zM3 6l3 2-3 2V6zm4 4h5v1H7v-1z"/>
    </svg>
    <span>Terminal</span>
  `;
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    cursor: pointer;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: white;
    font-size: 14px;
  `;

  button.addEventListener('click', openTerminal);

  return button;
}

async function openTerminal(): Promise<void> {
  const projectId = extractProjectId();

  if (!projectId) {
    alert('Could not identify Overleaf project. Please refresh the page.');
    return;
  }

  const message: OpenTerminalMessage = {
    type: 'OPEN_TERMINAL',
    projectId,
    projectUrl: window.location.href
  };

  try {
    const response = await chrome.runtime.sendMessage(message);

    if (response?.error) {
      alert(`Error: ${response.error}`);
    }
  } catch (err) {
    alert(`Failed to open terminal: ${(err as Error).message}`);
  }
}

function injectButton(): void {
  console.log('[Overleaf CC] Attempting to inject button...');
  console.log('[Overleaf CC] Current URL:', window.location.href);
  console.log('[Overleaf CC] Project ID:', extractProjectId());

  // Find the toolbar nav
  const toolbar = document.querySelector('.ide-redesign-toolbar nav');

  if (!toolbar) {
    console.log('[Overleaf CC] Toolbar not found (.ide-redesign-toolbar nav)');
    console.log('[Overleaf CC] Available toolbars:', document.querySelectorAll('[class*="toolbar"]'));

    // Try alternative selectors
    const altToolbar = document.querySelector('nav');
    const allNavs = document.querySelectorAll('nav');

    console.log('[Overleaf CC] Found <nav> elements:', allNavs.length);

    if (allNavs.length > 0) {
      allNavs.forEach((nav, i) => {
        console.log(`[Overleaf CC] Nav ${i}:`, nav.className, nav.id);
      });
    }

    return;
  }

  console.log('[Overleaf CC] Toolbar found!', toolbar);

  // Check if button already exists
  if (document.getElementById('overleaf-cc-terminal-btn')) {
    console.log('[Overleaf CC] Button already exists');
    return;
  }

  // Insert button
  const button = createTerminalButton();
  toolbar.appendChild(button);
  console.log('[Overleaf CC] ✓ Terminal button injected successfully!');
}

function init(): void {
  console.log('[Overleaf CC] Content script loaded');
  console.log('[Overleaf CC] Page ready state:', document.readyState);

  // Wait for page to load
  if (document.readyState === 'loading') {
    console.log('[Overleaf CC] Waiting for DOMContentLoaded...');
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[Overleaf CC] DOMContentLoaded fired');
      setTimeout(injectButton, 1000);
    });
  } else {
    console.log('[Overleaf CC] Page already loaded, scheduling injection...');
    setTimeout(injectButton, 1000);
  }

  // Also try after a longer delay
  setTimeout(injectButton, 3000);
  setTimeout(injectButton, 5000);
}

init();
