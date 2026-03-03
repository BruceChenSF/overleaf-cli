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
  // Find the toolbar nav
  const toolbar = document.querySelector('.ide-redesign-toolbar nav');

  if (!toolbar) {
    console.log('Overleaf toolbar not found, retrying...');
    return;
  }

  // Check if button already exists
  if (document.getElementById('overleaf-cc-terminal-btn')) {
    return;
  }

  // Insert button
  const button = createTerminalButton();
  toolbar.appendChild(button);
  console.log('Terminal button injected');
}

function init(): void {
  // Wait for page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(injectButton, 1000);
    });
  } else {
    setTimeout(injectButton, 1000);
  }
}

init();
