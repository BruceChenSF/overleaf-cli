import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DropdownMenu } from '../../src/content/dropdown';

describe('DropdownMenu', () => {
  let dropdown: DropdownMenu;
  let container: HTMLElement;

  beforeEach(() => {
    // Create a container element for testing
    container = document.createElement('div');
    document.body.appendChild(container);

    dropdown = new DropdownMenu({
      container,
      onSync: vi.fn(),
      onTerminalChange: vi.fn(),
      onSyncModeChange: vi.fn()
    });
  });

  afterEach(() => {
    container.remove();
  });

  describe('initialization', () => {
    it('should create dropdown element', () => {
      const element = dropdown.getElement();
      expect(element).toBeTruthy();
      expect(element?.classList.contains('claude-dropdown')).toBe(true);
    });

    it('should be hidden by default', () => {
      const element = dropdown.getElement();
      expect(element?.classList.contains('show')).toBe(false);
    });

    it('should have all required sections', () => {
      const element = dropdown.getElement();
      expect(element?.querySelector('.connection-status')).toBeTruthy();
      expect(element?.querySelector('.sync-controls')).toBeTruthy();
      expect(element?.querySelector('.terminal-options')).toBeTruthy();
    });
  });

  describe('show/hide', () => {
    it('should show dropdown when show() is called', () => {
      dropdown.show();
      const element = dropdown.getElement();
      expect(element?.classList.contains('show')).toBe(true);
    });

    it('should hide dropdown when hide() is called', () => {
      dropdown.show();
      dropdown.hide();
      const element = dropdown.getElement();
      expect(element?.classList.contains('show')).toBe(false);
    });

    it('should toggle visibility', () => {
      expect(dropdown.getElement()?.classList.contains('show')).toBe(false);
      dropdown.toggle();
      expect(dropdown.getElement()?.classList.contains('show')).toBe(true);
      dropdown.toggle();
      expect(dropdown.getElement()?.classList.contains('show')).toBe(false);
    });
  });

  describe('connection status', () => {
    it('should display disconnected status initially', () => {
      const statusEl = dropdown.getElement()?.querySelector('.connection-status .status-text');
      expect(statusEl?.textContent).toContain('Not Connected');
    });

    it('should update to connected status', () => {
      dropdown.updateConnectionStatus('connected');
      const statusEl = dropdown.getElement()?.querySelector('.connection-status .status-text');
      expect(statusEl?.textContent).toContain('Connected');
    });

    it('should show error status', () => {
      dropdown.updateConnectionStatus('error', 'Connection failed');
      const statusEl = dropdown.getElement()?.querySelector('.connection-status .status-text');
      expect(statusEl?.textContent).toBe('Connection failed');
      // Also check that the dropdown has the error class
      expect(dropdown.getElement()?.classList.contains('status-error')).toBe(true);
    });
  });

  describe('sync mode', () => {
    it('should display auto mode initially', () => {
      const modeEl = dropdown.getElement()?.querySelector('.sync-mode .mode-text');
      expect(modeEl?.textContent).toContain('Auto');
    });

    it('should toggle to manual mode', () => {
      dropdown.setSyncMode('manual');
      const modeEl = dropdown.getElement()?.querySelector('.sync-mode .mode-text');
      expect(modeEl?.textContent).toContain('Manual');
    });

    it('should show manual sync button in manual mode', () => {
      dropdown.setSyncMode('manual');
      const syncBtn = dropdown.getElement()?.querySelector('.manual-sync-btn');
      expect(syncBtn?.getAttribute('hidden')).toBeNull();
    });

    it('should hide manual sync button in auto mode', () => {
      dropdown.setSyncMode('auto');
      const syncBtn = dropdown.getElement()?.querySelector('.manual-sync-btn');
      expect(syncBtn?.getAttribute('hidden')).toBeDefined();
    });

    it('should call onSyncModeChange when mode is toggled', () => {
      const onSyncModeChange = vi.fn();
      const newDropdown = new DropdownMenu({
        container,
        onSync: vi.fn(),
        onTerminalChange: vi.fn(),
        onSyncModeChange
      });

      const toggleBtn = newDropdown.getElement()?.querySelector('.sync-mode-toggle') as HTMLElement;
      toggleBtn?.click();

      expect(onSyncModeChange).toHaveBeenCalledWith('manual');
    });
  });

  describe('sync status', () => {
    it('should display idle status initially', () => {
      const statusEl = dropdown.getElement()?.querySelector('.sync-status');
      expect(statusEl?.textContent).toContain('Idle');
    });

    it('should update to syncing status', () => {
      dropdown.updateSyncStatus('syncing', 2);
      const statusEl = dropdown.getElement()?.querySelector('.sync-status');
      expect(statusEl?.textContent).toContain('Syncing');
      expect(statusEl?.textContent).toContain('2 files');
    });

    it('should update to synced status', () => {
      dropdown.updateSyncStatus('synced');
      const statusEl = dropdown.getElement()?.querySelector('.sync-status');
      expect(statusEl?.textContent).toContain('Synced');
    });

    it('should show conflict status', () => {
      dropdown.updateSyncStatus('conflict');
      const statusEl = dropdown.getElement()?.querySelector('.sync-status');
      expect(statusEl?.textContent).toContain('Conflict');
    });
  });

  describe('manual sync', () => {
    it('should call onSync when manual sync button is clicked', () => {
      const onSync = vi.fn();
      const newDropdown = new DropdownMenu({
        container,
        onSync,
        onTerminalChange: vi.fn(),
        onSyncModeChange: vi.fn()
      });

      newDropdown.setSyncMode('manual');
      const syncBtn = newDropdown.getElement()?.querySelector('.manual-sync-btn') as HTMLElement;
      syncBtn?.click();

      expect(onSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('terminal options', () => {
    it('should call onTerminalChange when terminal mode is selected', () => {
      const onTerminalChange = vi.fn();
      const newDropdown = new DropdownMenu({
        container,
        onSync: vi.fn(),
        onTerminalChange,
        onSyncModeChange: vi.fn()
      });

      const localBtn = newDropdown.getElement()?.querySelector('.terminal-btn[data-mode="local"]') as HTMLElement;
      localBtn?.click();

      expect(onTerminalChange).toHaveBeenCalledWith('local');
    });

    it('should highlight active terminal mode', () => {
      dropdown.setTerminalMode('in-page');
      const inPageBtn = dropdown.getElement()?.querySelector('.terminal-btn[data-mode="in-page"]');
      const localBtn = dropdown.getElement()?.querySelector('.terminal-btn[data-mode="local"]');

      expect(inPageBtn?.classList.contains('active')).toBe(true);
      expect(localBtn?.classList.contains('active')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove element from DOM when destroyed', () => {
      dropdown.destroy();
      expect(container.contains(dropdown.getElement())).toBe(false);
    });
  });
});
