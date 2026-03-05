import type { OpenTerminalMessage } from '../shared/types';
import { DropdownMenu } from './dropdown';
import { stateManager } from './state-manager';
import { injectNotificationStyles } from './styles';
import { SyncManager } from './sync-manager';

// Global dropdown and sync manager instances
let dropdown: DropdownMenu | null = null;
let syncManager: SyncManager | null = null;

function extractProjectId(): string | null {
  const match = window.location.href.match(/\/project\/([a-f0-9]+)/i);
  return match ? match[1] : null;
}

function extractCSRFToken(): string | null {
  const metaTag = document.querySelector('meta[name="ol-csrfToken"]') as HTMLMetaElement;
  return metaTag?.content || null;
}

function createTerminalButton(): HTMLElement {
  // Create a div wrapper similar to the File dropdown structure
  const wrapper = document.createElement('div');
  wrapper.className = 'toolbar-menu-bar-item';
  wrapper.id = 'overleaf-cc-terminal-btn';
  wrapper.style.position = 'relative'; // For dropdown positioning

  // Create the button
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'toolbar-menu-bar-item-terminal';
  button.className = 'ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued menu-bar-toggle btn btn-secondary';
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `
    <img src="https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude-color.svg"
         alt="Claude"
         width="16"
         height="16"
         style="vertical-align: middle;" />
  `;

  button.addEventListener('click', toggleDropdown);

  wrapper.appendChild(button);
  return wrapper;
}

async function openTerminal(): Promise<void> {
  const projectId = extractProjectId();
  const csrfToken = extractCSRFToken();

  if (!projectId) {
    alert('Could not identify Overleaf project. Please refresh the page.');
    return;
  }

  if (!csrfToken) {
    console.error('[Overleaf CC] CSRF token not found');
    alert('Could not extract CSRF token. Please refresh the page.');
    return;
  }

  const message: OpenTerminalMessage = {
    type: 'OPEN_TERMINAL',
    projectId,
    projectUrl: window.location.href,
    csrfToken
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

/**
 * Toggle dropdown visibility
 */
function toggleDropdown(): void {
  if (!dropdown) {
    console.warn('[Overleaf CC] Dropdown not initialized');
    return;
  }

  dropdown.toggle();

  // Update button aria-expanded attribute
  const button = document.getElementById('toolbar-menu-bar-item-terminal');
  if (button) {
    const isExpanded = dropdown.getElement().classList.contains('show');
    button.setAttribute('aria-expanded', isExpanded.toString());
  }
}

/**
 * Initialize dropdown menu
 */
function initDropdown(): void {
  const wrapper = document.getElementById('overleaf-cc-terminal-btn');
  if (!wrapper) {
    console.error('[Overleaf CC] Button wrapper not found for dropdown');
    return;
  }

  dropdown = new DropdownMenu({
    container: wrapper,
    onSync: manualSync,
    onTerminalChange: onTerminalChange,
    onSyncModeChange: onSyncModeChange
  });

  // Subscribe to state changes for real-time updates
  subscribeToStateChanges();

  // Inject dropdown styles
  injectDropdownStyles();

  // Initialize sync manager
  initSyncManager();

  console.log('[Overleaf CC] Dropdown initialized');
}

/**
 * Inject dropdown styles
 */
async function injectDropdownStyles(): Promise<void> {
  try {
    const response = await fetch(chrome.runtime.getURL('src/styles/dropdown.css'));
    const css = await response.text();
    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    document.head.appendChild(styleElement);
  } catch (error) {
    console.error('[Overleaf CC] Failed to load dropdown styles:', error);
  }
}

/**
 * Manual sync callback
 */
async function manualSync(): Promise<void> {
  console.log('[Overleaf CC] Manual sync triggered');

  if (!syncManager) {
    console.error('[Overleaf CC] Sync manager not initialized');
    return;
  }

  try {
    // Sync from Overleaf to get latest state
    await syncManager.syncFromOverleaf();
  } catch (error) {
    console.error('[Overleaf CC] Manual sync failed:', error);
  }
}

/**
 * Create bridge client wrapper
 */
function createBridgeClient() {
  return {
    isConnected: () => {
      // TODO: Check actual WebSocket connection status
      // For now, return true if we're on an Overleaf project page
      return !!extractProjectId();
    },

    sendMessage: async (message: any) => {
      // Send message to background service worker which forwards to bridge
      const response = await chrome.runtime.sendMessage({
        type: 'BRIDGE_MESSAGE',
        payload: message
      });

      if (response?.error) {
        throw new Error(response.error);
      }

      return response;
    }
  };
}

/**
 * Initialize sync manager
 */
function initSyncManager(): void {
  const bridge = createBridgeClient();
  syncManager = new SyncManager(bridge);

  // Set up event listeners
  syncManager.on('sync:started', () => {
    console.log('[Overleaf CC] Sync started');
  });

  syncManager.on('sync:completed', (result: any) => {
    console.log('[Overleaf CC] Sync completed:', result);
    // Update dropdown
    dropdown?.updateSyncStatus('synced');
  });

  syncManager.on('conflict:detected', (conflict: any) => {
    console.warn('[Overleaf CC] Conflict detected:', conflict.path);
    // Show notification
    chrome.runtime.sendMessage({
      type: 'SHOW_NOTIFICATION',
      payload: {
        type: 'warning',
        title: 'Sync Conflict',
        message: `Conflict detected in ${conflict.path}`
      }
    });
  });

  syncManager.on('connection:changed', (status: string) => {
    console.log('[Overleaf CC] Connection status:', status);
    dropdown?.updateConnectionStatus(status as 'connected' | 'disconnected' | 'error');

    // Start polling if connected and in auto mode
    if (status === 'connected' && stateManager.getState().sync.mode === 'auto') {
      syncManager?.startPolling();
    }
  });

  syncManager.on('files:received', (files: any[]) => {
    console.log('[Overleaf CC] Files received from bridge:', files.length);
    // TODO: Update Overleaf editor with received files
  });

  // Start polling if in auto mode
  if (stateManager.getState().sync.mode === 'auto') {
    syncManager.startPolling();
  }

  console.log('[Overleaf CC] Sync manager initialized');
}

/**
 * Terminal mode change callback
 */
function onTerminalChange(mode: 'local' | 'in-page'): void {
  console.log('[Overleaf CC] Terminal mode changed to:', mode);
  // Update state
  stateManager.setState({
    terminal: {
      ...stateManager.getState().terminal,
      mode
    }
  });

  // For now, always open local terminal
  // TODO: Implement in-page terminal in future work
  if (mode === 'local') {
    openTerminal();
  } else {
    console.log('[Overleaf CC] In-page terminal not yet implemented');
  }
}

/**
 * Sync mode change callback
 */
function onSyncModeChange(mode: 'auto' | 'manual'): void {
  console.log('[Overleaf CC] Sync mode changed to:', mode);

  // Update state
  stateManager.setState({
    sync: {
      ...stateManager.getState().sync,
      mode
    }
  });

  // Update sync manager mode
  if (syncManager) {
    syncManager.setMode(mode);
  }
}

/**
 * Subscribe to state changes and update dropdown
 */
function subscribeToStateChanges(): void {
  if (!dropdown) return;

  // Update connection status
  stateManager.subscribe('connection.bridge', (status) => {
    dropdown!.updateConnectionStatus(
      status === 'connected' ? 'connected' :
      status === 'error' ? 'error' : 'disconnected',
      status === 'error' ? stateManager.getState().connection.lastError || undefined : undefined
    );
  });

  // Update sync status
  stateManager.subscribe('sync.status', (status) => {
    dropdown!.updateSyncStatus(status, stateManager.getState().sync.pendingChanges || undefined);
  });

  // Update sync mode display
  stateManager.subscribe('sync.mode', (mode) => {
    dropdown!.setSyncMode(mode);
  });

  // Update terminal mode display
  stateManager.subscribe('terminal.mode', (mode) => {
    dropdown!.setTerminalMode(mode);
  });
}

function injectButton(): void {
  console.log('[Overleaf CC] Attempting to inject button...');

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

  // Initialize dropdown after button is injected
  setTimeout(initDropdown, 100);
}

function init(): void {
  console.log('[Overleaf CC] Content script loaded');

  // Load state from storage
  stateManager.load().then(() => {
    console.log('[Overleaf CC] State loaded:', stateManager.getState());
  });

  // Inject notification styles
  injectNotificationStyles();

  // Set up message listener for bridge messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TASK_COMPLETE') {
      console.log('[Overleaf CC] Received TASK_COMPLETE:', message);
      syncManager?.handleTaskCompletion(message);
    }
    return true;
  });

  // Wait for page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(injectButton, 1000);
    });
  } else {
    setTimeout(injectButton, 1000);
  }

  // Also try after a longer delay
  setTimeout(injectButton, 3000);
  setTimeout(injectButton, 5000);
}

init();
