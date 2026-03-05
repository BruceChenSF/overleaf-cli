import type { SyncMode, SyncStatus, TerminalMode } from '../shared/types';

export interface DropdownMenuOptions {
  container: HTMLElement;
  onSync: () => void;
  onTerminalChange: (mode: TerminalMode) => void;
  onSyncModeChange: (mode: SyncMode) => void;
}

export class DropdownMenu {
  private element: HTMLElement;
  private container: HTMLElement;
  private options: DropdownMenuOptions;
  private currentSyncMode: SyncMode = 'auto';
  private currentTerminalMode: TerminalMode = 'local';

  constructor(options: DropdownMenuOptions) {
    this.container = options.container;
    this.options = options;
    this.element = this.createDropdown();
    this.container.appendChild(this.element);
    this.attachEventListeners();
  }

  /**
   * Create dropdown element with all sections
   */
  private createDropdown(): HTMLElement {
    const dropdown = document.createElement('div');
    dropdown.className = 'claude-dropdown';
    dropdown.innerHTML = `
      <div class="dropdown-section connection-status">
        <div class="status-header">
          <span class="status-icon"></span>
          <span class="status-text">Not Connected</span>
        </div>
        <div class="status-details hidden"></div>
      </div>

      <div class="dropdown-section sync-controls">
        <div class="sync-mode">
          <span class="mode-label">Sync Mode:</span>
          <span class="mode-text">Auto</span>
          <button class="sync-mode-toggle" aria-label="Toggle sync mode"></button>
        </div>
        <div class="sync-status">
          <span class="status-indicator"></span>
          <span class="status-text">Idle</span>
        </div>
        <button class="manual-sync-btn" hidden>Sync Now</button>
      </div>

      <div class="dropdown-section terminal-options">
        <div class="terminal-label">Terminal Mode:</div>
        <div class="terminal-buttons">
          <button class="terminal-btn active" data-mode="local">Local Window</button>
          <button class="terminal-btn" data-mode="in-page">In-Page</button>
        </div>
      </div>

      <div class="dropdown-section help-text">
        <p><strong>Tip:</strong> Auto mode syncs automatically when files change. Manual mode requires clicking "Sync Now".</p>
      </div>
    `;

    return dropdown;
  }

  /**
   * Attach event listeners
   */
  private attachEventListeners(): void {
    // Sync mode toggle
    const modeToggle = this.element.querySelector('.sync-mode-toggle') as HTMLElement;
    modeToggle?.addEventListener('click', () => {
      const newMode: SyncMode = this.currentSyncMode === 'auto' ? 'manual' : 'auto';
      this.setSyncMode(newMode);
      this.options.onSyncModeChange(newMode);
    });

    // Manual sync button
    const syncBtn = this.element.querySelector('.manual-sync-btn') as HTMLElement;
    syncBtn?.addEventListener('click', () => {
      this.options.onSync();
    });

    // Terminal mode buttons
    const terminalButtons = this.element.querySelectorAll('.terminal-btn');
    terminalButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).dataset.mode as TerminalMode;
        if (mode) {
          this.setTerminalMode(mode);
          this.options.onTerminalChange(mode);
        }
      });
    });
  }

  /**
   * Show dropdown
   */
  show(): void {
    this.element.classList.add('show');
  }

  /**
   * Hide dropdown
   */
  hide(): void {
    this.element.classList.remove('show');
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    this.element.classList.toggle('show');
  }

  /**
   * Get dropdown element
   */
  getElement(): HTMLElement {
    return this.element;
  }

  /**
   * Update connection status
   */
  updateConnectionStatus(
    status: 'connected' | 'disconnected' | 'error',
    message?: string
  ): void {
    const statusIcon = this.element.querySelector('.connection-status .status-icon') as HTMLElement;
    const statusText = this.element.querySelector('.connection-status .status-text') as HTMLElement;
    const statusDetails = this.element.querySelector('.connection-status .status-details') as HTMLElement;

    const statusMap = {
      connected: { icon: '✓', text: 'Connected' },
      disconnected: { icon: '○', text: 'Not Connected' },
      error: { icon: '✕', text: 'Error' }
    };

    const statusInfo = statusMap[status];
    statusIcon.textContent = statusInfo.icon;
    statusText.textContent = message || statusInfo.text;

    // Update styling based on status
    this.element.classList.remove('status-connected', 'status-disconnected', 'status-error');
    this.element.classList.add(`status-${status}`);

    // Show error details if provided
    if (status === 'error' && message) {
      statusDetails.textContent = message;
      statusDetails.classList.remove('hidden');
    } else {
      statusDetails.classList.add('hidden');
    }
  }

  /**
   * Set sync mode
   */
  setSyncMode(mode: SyncMode): void {
    this.currentSyncMode = mode;
    const modeText = this.element.querySelector('.sync-mode .mode-text') as HTMLElement;
    const syncBtn = this.element.querySelector('.manual-sync-btn') as HTMLElement;

    modeText.textContent = mode === 'auto' ? 'Auto' : 'Manual';

    // Show/hide manual sync button
    if (mode === 'manual') {
      syncBtn.removeAttribute('hidden');
    } else {
      syncBtn.setAttribute('hidden', '');
    }
  }

  /**
   * Update sync status
   */
  updateSyncStatus(status: SyncStatus, pendingChanges?: number): void {
    const statusIndicator = this.element.querySelector('.sync-status .status-indicator') as HTMLElement;
    const statusText = this.element.querySelector('.sync-status .status-text') as HTMLElement;

    const statusMap: Record<SyncStatus, { text: string; class: string }> = {
      idle: { text: 'Idle', class: 'status-idle' },
      syncing: { text: 'Syncing...', class: 'status-syncing' },
      synced: { text: 'Synced', class: 'status-synced' },
      pending: { text: 'Pending', class: 'status-pending' },
      conflict: { text: 'Conflict!', class: 'status-conflict' },
      error: { text: 'Error', class: 'status-error' }
    };

    const statusInfo = statusMap[status];
    statusText.textContent = pendingChanges !== undefined
      ? `${statusInfo.text} (${pendingChanges} files)`
      : statusInfo.text;

    // Update indicator class
    statusIndicator.className = 'status-indicator';
    statusIndicator.classList.add(statusInfo.class);
  }

  /**
   * Set terminal mode
   */
  setTerminalMode(mode: TerminalMode): void {
    this.currentTerminalMode = mode;

    // Update active button
    const buttons = this.element.querySelectorAll('.terminal-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }

  /**
   * Destroy dropdown and remove from DOM
   */
  destroy(): void {
    this.element.remove();
  }
}
