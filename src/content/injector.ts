import type { OpenTerminalMessage } from '../shared/types';

function extractProjectId(): string | null {
  const match = window.location.href.match(/\/project\/([a-f0-9]+)/i);
  return match ? match[1] : null;
}

function createTerminalButton(): HTMLElement {
  // Create a div wrapper similar to the File dropdown structure
  const wrapper = document.createElement('div');
  wrapper.className = 'toolbar-menu-bar-item';
  wrapper.id = 'overleaf-cc-terminal-btn';

  // Create the button
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'toolbar-menu-bar-item-terminal';
  button.className = 'ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued menu-bar-toggle btn btn-secondary';
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = 'Terminal';

  button.addEventListener('click', openTerminal);

  wrapper.appendChild(button);
  return wrapper;
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

  console.log('[Overleaf CC] Sending OPEN_TERMINAL message:', message);

  try {
    const response = await chrome.runtime.sendMessage(message);
    console.log('[Overleaf CC] Received response:', response);

    if (response?.error) {
      console.error('[Overleaf CC] Error response:', response.error);
      alert(`Error: ${response.error}`);
    } else {
      console.log('[Overleaf CC] Terminal window opened successfully');
    }
  } catch (err) {
    console.error('[Overleaf CC] Failed to send message:', err);
    alert(`Failed to open terminal: ${(err as Error).message}`);
  }
}

function injectButton(): void {
  console.log('[Overleaf CC] Attempting to inject button...');
  console.log('[Overleaf CC] Current URL:', window.location.href);
  console.log('[Overleaf CC] Project ID:', extractProjectId());

  // Find the menu bar using the exact selector
  const menuBar = document.querySelector('#ide-root > div.ide-redesign-main > nav > div.ide-redesign-toolbar-menu > div.ide-redesign-toolbar-menu-bar');

  if (!menuBar) {
    console.log('[Overleaf CC] Menu bar not found, trying alternative selector...');
    // Try alternative approach
    const altMenuBar = document.querySelector('.ide-redesign-toolbar-menu-bar');
    if (!altMenuBar) {
      console.log('[Overleaf CC] Still cannot find menu bar');
      return;
    }
    console.log('[Overleaf CC] Using alternative menu bar selector');
    injectIntoMenuBar(altMenuBar);
    return;
  }

  console.log('[Overleaf CC] Menu bar found!', menuBar);
  injectIntoMenuBar(menuBar);
}

function injectIntoMenuBar(menuBar: Element): void {
  // Check if button already exists
  if (document.getElementById('overleaf-cc-terminal-btn')) {
    console.log('[Overleaf CC] Button already exists');
    return;
  }

  // Find the Help button to use as reference
  const helpButton = menuBar.querySelector('#toolbar-menu-bar-item-help');

  // Create the terminal button
  const terminalButton = createTerminalButton();

  if (helpButton && helpButton.parentElement) {
    // Insert after the Help button
    helpButton.parentElement.parentNode?.insertBefore(
      terminalButton,
      helpButton.parentElement.nextSibling
    );
    console.log('[Overleaf CC] ✓ Terminal button injected after Help button!');
  } else {
    // Fallback: append to menu bar
    menuBar.appendChild(terminalButton);
    console.log('[Overleaf CC] ✓ Terminal button injected into menu bar!');
  }
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
