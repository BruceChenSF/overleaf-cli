/**
 * Terminal Drawer Component (Content Script)
 * 使用 iframe 加载独立的终端页面
 * 支持多种位置：左侧、右侧、底部
 * 支持拖拽调整大小
 */

import type { TerminalPosition, TerminalSettings } from '../shared/types';

let terminalDrawer: HTMLElement | null = null;
let isDrawerOpen = false;
let terminalInitialized = false;
let currentPosition: TerminalPosition = 'right'; // 默认右侧
let currentSize: number = 600; // 当前尺寸（宽度或高度）
let isResizing = false;
let resizeStartPos = 0;
let resizeStartSize = 0;

// 默认尺寸
const DEFAULT_SIZES: Record<TerminalPosition, number> = {
  left: 600,
  right: 600,
  bottom: 400
};

// 最小和最大尺寸
const SIZE_LIMITS = {
  minWidth: 300,
  maxWidth: 1200,
  minHeight: 200,
  maxHeight: 800
};

const STORAGE_KEY = 'terminal_settings';

/**
 * Load terminal settings from chrome.storage
 */
async function loadSettings(): Promise<{ position: TerminalPosition; size: number }> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const settings = result[STORAGE_KEY] as TerminalSettings | undefined;
        const position = settings?.position || 'right';
        const size = settings?.sizes?.[position] || DEFAULT_SIZES[position];
        resolve({ position, size });
      });
    } else {
      resolve({ position: 'right', size: DEFAULT_SIZES.right });
    }
  });
}

/**
 * Load saved size for a specific position
 */
async function loadSavedSizeForPosition(position: TerminalPosition): Promise<number> {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const settings = result[STORAGE_KEY] as TerminalSettings | undefined;
        const size = settings?.sizes?.[position] || DEFAULT_SIZES[position];
        resolve(size);
      });
    } else {
      resolve(DEFAULT_SIZES[position]);
    }
  });
}

/**
 * Save terminal settings to chrome.storage
 */
function saveSettings(): void {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const settings = result[STORAGE_KEY] as TerminalSettings | undefined;
      const sizes = settings?.sizes || { ...DEFAULT_SIZES };
      sizes[currentPosition] = currentSize;

      const newSettings: TerminalSettings = {
        position: currentPosition,
        sizes
      };

      chrome.storage.local.set({ [STORAGE_KEY]: newSettings }, () => {
        console.log('[TerminalDrawer] Settings saved:', newSettings);
      });
    });
  }
}

/**
 * Get position property and resize handle position
 */
function getPositionInfo() {
  switch (currentPosition) {
    case 'left':
      return {
        sizeProperty: 'width',
        positionProperty: 'left',
        closed: `-${currentSize}px`,
        open: '0',
        resizeHandle: {
          position: 'absolute',
          top: '0',
          right: '0',
          width: '4px',
          height: '100%',
          cursor: 'ew-resize'
        }
      };
    case 'right':
      return {
        sizeProperty: 'width',
        positionProperty: 'right',
        closed: `-${currentSize}px`,
        open: '0',
        resizeHandle: {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '4px',
          height: '100%',
          cursor: 'ew-resize'
        }
      };
    case 'bottom':
      return {
        sizeProperty: 'height',
        positionProperty: 'bottom',
        closed: `-${currentSize}px`,
        open: '0',
        resizeHandle: {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          height: '4px',
          cursor: 'ns-resize'
        }
      };
  }
}

/**
 * Update drawer position and size
 */
function updateDrawerPosition(): void {
  if (!terminalDrawer) return;

  const info = getPositionInfo();

  // Reset all position properties first
  terminalDrawer.style.left = 'auto';
  terminalDrawer.style.right = 'auto';
  terminalDrawer.style.bottom = 'auto';
  terminalDrawer.style.top = 'auto';
  terminalDrawer.style.maxWidth = 'none';
  terminalDrawer.style.maxHeight = 'none';

  // Update size
  if (info.sizeProperty === 'width') {
    terminalDrawer.style.width = `${currentSize}px`;
    terminalDrawer.style.maxWidth = `${SIZE_LIMITS.maxWidth}px`;
    terminalDrawer.style.height = '100vh';
    // For left/right positions, set top to 0
    terminalDrawer.style.top = '0';
  } else {
    terminalDrawer.style.width = '100vw';
    terminalDrawer.style.height = `${currentSize}px`;
    terminalDrawer.style.maxHeight = `${SIZE_LIMITS.maxHeight}px`;
    // For bottom position, set left to 0 and top to auto
    terminalDrawer.style.left = '0';
    terminalDrawer.style.top = 'auto';
  }

  // Update transition
  terminalDrawer.style.transition = `${info.positionProperty} 0.3s ease-in-out`;

  // Set position based on current state
  if (isDrawerOpen) {
    terminalDrawer.style[info.positionProperty as any] = info.open;
  } else {
    terminalDrawer.style[info.positionProperty as any] = info.closed;
  }

  // Update shadow based on position
  if (currentPosition === 'left') {
    terminalDrawer.style.boxShadow = '4px 0 16px rgba(0, 0, 0, 0.3)';
  } else if (currentPosition === 'right') {
    terminalDrawer.style.boxShadow = '-4px 0 16px rgba(0, 0, 0, 0.3)';
  } else {
    terminalDrawer.style.boxShadow = '0 -4px 16px rgba(0, 0, 0, 0.3)';
  }

  // Update resize handle position
  const resizeHandle = terminalDrawer.querySelector('.resize-handle') as HTMLElement;
  if (resizeHandle) {
    // Reset positioning
    resizeHandle.style.left = 'auto';
    resizeHandle.style.right = 'auto';
    resizeHandle.style.top = 'auto';
    resizeHandle.style.bottom = 'auto';

    // Set new positioning based on current position
    if (currentPosition === 'left') {
      resizeHandle.style.top = '0';
      resizeHandle.style.right = '0';
      resizeHandle.style.width = '7px';
      resizeHandle.style.height = '100%';
      resizeHandle.style.cursor = 'ew-resize';
    } else if (currentPosition === 'right') {
      resizeHandle.style.top = '0';
      resizeHandle.style.left = '0';
      resizeHandle.style.width = '7px';
      resizeHandle.style.height = '100%';
      resizeHandle.style.cursor = 'ew-resize';
    } else {
      resizeHandle.style.top = '0';
      resizeHandle.style.left = '0';
      resizeHandle.style.width = '100%';
      resizeHandle.style.height = '7px';
      resizeHandle.style.cursor = 'ns-resize';
    }
  }
}

/**
 * Create resize overlay (prevents iframe from capturing mouse events)
 */
function createResizeOverlay(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'resize-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: transparent;
    z-index: 1000000;
    display: none;
    cursor: ${currentPosition === 'bottom' ? 'ns-resize' : 'ew-resize'};
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Handle resize start
 */
function handleResizeStart(e: MouseEvent): void {
  e.preventDefault();
  isResizing = true;
  resizeStartPos = currentPosition === 'bottom' ? e.clientY : e.clientX;
  resizeStartSize = currentSize;

  document.addEventListener('mousemove', handleResizeMove);
  document.addEventListener('mouseup', handleResizeEnd);

  // Disable transition during resize
  if (terminalDrawer) {
    terminalDrawer.style.transition = 'none';
  }

  // Show overlay to prevent iframe from capturing mouse events
  let overlay = document.getElementById('resize-overlay');
  if (!overlay) {
    overlay = createResizeOverlay();
  }
  overlay.style.display = 'block';

  console.log('[TerminalDrawer] Resize started');
}

/**
 * Handle resize move
 */
function handleResizeMove(e: MouseEvent): void {
  if (!isResizing) return;

  const info = getPositionInfo();
  let delta: number;

  if (currentPosition === 'bottom') {
    delta = resizeStartPos - e.clientY;
  } else if (currentPosition === 'left') {
    delta = e.clientX - resizeStartPos;
  } else {
    delta = resizeStartPos - e.clientX;
  }

  let newSize = resizeStartSize + delta;

  // Apply size limits
  if (info.sizeProperty === 'width') {
    newSize = Math.max(SIZE_LIMITS.minWidth, Math.min(SIZE_LIMITS.maxWidth, newSize));
  } else {
    newSize = Math.max(SIZE_LIMITS.minHeight, Math.min(SIZE_LIMITS.maxHeight, newSize));
  }

  currentSize = newSize;

  // Update drawer size immediately
  if (terminalDrawer) {
    if (info.sizeProperty === 'width') {
      terminalDrawer.style.width = `${currentSize}px`;
      terminalDrawer.style.maxWidth = `${SIZE_LIMITS.maxWidth}px`;
    } else {
      terminalDrawer.style.height = `${currentSize}px`;
      terminalDrawer.style.maxHeight = `${SIZE_LIMITS.maxHeight}px`;
    }

    // Update position if drawer is open
    if (isDrawerOpen) {
      terminalDrawer.style[info.positionProperty as any] = info.open;
    } else {
      terminalDrawer.style[info.positionProperty as any] = info.closed;
    }
  }
}

/**
 * Handle resize end
 */
function handleResizeEnd(): void {
  if (!isResizing) return;

  isResizing = false;
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', handleResizeEnd);

  // Re-enable transition
  if (terminalDrawer) {
    const info = getPositionInfo();
    terminalDrawer.style.transition = `${info.positionProperty} 0.3s ease-in-out`;
  }

  // Hide overlay
  const overlay = document.getElementById('resize-overlay');
  if (overlay) {
    overlay.style.display = 'none';
  }

  // Save settings
  saveSettings();

  console.log('[TerminalDrawer] Resize ended, size:', currentSize);
}

/**
 * Create position dropdown menu
 */
function createPositionDropdown(): HTMLElement {
  const dropdown = document.createElement('div');
  dropdown.className = 'position-dropdown';
  dropdown.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    background: #3d3d3d;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 4px 0;
    min-width: 120px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 1000000;
    display: none;
  `;

  const positions: Array<{ value: TerminalPosition; label: string }> = [
    { value: 'left', label: '左侧' },
    { value: 'bottom', label: '下方' },
    { value: 'right', label: '右侧' }
  ];

  positions.forEach(({ value, label }) => {
    const item = document.createElement('div');
    item.className = 'position-dropdown-item';
    item.textContent = label;
    item.style.cssText = `
      padding: 8px 16px;
      cursor: pointer;
      color: #ddd;
      font-size: 13px;
      transition: background 0.2s;
      ${currentPosition === value ? 'background: #555;' : ''}
    `;

    item.addEventListener('mouseenter', () => {
      item.style.background = '#555';
    });

    item.addEventListener('mouseleave', () => {
      if (currentPosition !== value) {
        item.style.background = 'transparent';
      }
    });

    item.addEventListener('click', async () => {
      // Save current size before switching
      saveSettings();

      // Switch to new position
      currentPosition = value;

      // Load saved size for new position or use default
      const savedSize = await loadSavedSizeForPosition(value);
      currentSize = savedSize;

      updateDrawerPosition();
      dropdown.style.display = 'none';

      console.log('[TerminalDrawer] Position changed to:', value, 'size:', currentSize);
    });

    dropdown.appendChild(item);
  });

  return dropdown;
}

/**
 * Create drawer container with iframe
 */
function createDrawer(): HTMLElement {
  const drawer = document.createElement('div');
  drawer.id = 'mirror-terminal-drawer';

  const info = getPositionInfo();

  // Apply base styles with initial closed position
  drawer.style.cssText = `
    position: fixed;
    background: #1a1a1a;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    ${info.sizeProperty === 'width' ? `width: ${currentSize}px; max-width: ${SIZE_LIMITS.maxWidth}px; height: 100vh;` : `width: 100vw; height: ${currentSize}px; max-height: ${SIZE_LIMITS.maxHeight}px;`}
    ${info.sizeProperty === 'width' ? `top: 0;` : `top: auto; left: 0;`}
    ${info.positionProperty}: ${info.closed};
  `;

  // Create resize handle with correct positioning
  const resizeHandleAttrs = currentPosition === 'left'
    ? 'top: 0; right: 0; width: 7px; height: 100%;'
    : currentPosition === 'right'
    ? 'top: 0; left: 0; width: 7px; height: 100%;'
    : 'top: 0; left: 0; width: 100%; height: 7px;';

  drawer.innerHTML = `
    <div class="resize-handle" style="
      position: absolute;
      ${resizeHandleAttrs}
      cursor: ${info.resizeHandle.cursor};
      background: #495365;
      transition: background 0.2s;
      z-index: 10;
    "></div>
    <div class="drawer-header" style="
      background: #2d2d2d;
      padding: 12px 16px;
      border-bottom: 1px solid #404040;
      border-top: ${currentPosition === 'bottom' ? '1px solid #404040' : 'none'};
      border-left: ${currentPosition === 'bottom' ? '1px solid #404040' : 'none'};
      border-right: ${currentPosition === 'bottom' ? '1px solid #404040' : 'none'};
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      user-select: none;
    ">
      <span style="
        color: #fff;
        font-size: 14px;
        font-weight: 500;
      ">Terminal</span>
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="position-settings-btn" style="
          background: transparent;
          border: none;
          color: #999;
          font-size: 16px;
          cursor: pointer;
          padding: 4px 8px;
          line-height: 1;
          border-radius: 4px;
          transition: all 0.2s;
        " title="设置位置">⚙</button>
        <button id="close-terminal-btn" style="
          background: transparent;
          border: none;
          color: #999;
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
          line-height: 1;
          border-radius: 4px;
          transition: all 0.2s;
        ">×</button>
      </div>
    </div>
    <div class="drawer-body" style="
      flex: 1;
      overflow: hidden;
      background: #000;
      position: relative;
      min-height: 0;
    ">
      <iframe
        id="terminal-iframe"
        src="${chrome.runtime.getURL('public/terminal.html')}"
        style="
          width: 100%;
          height: 100%;
          border: none;
          display: block;
        "
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      ></iframe>
    </div>
  `;

  // Add event handlers after drawer is created
  setTimeout(() => {
    // Setup resize handle
    const resizeHandle = drawer.querySelector('.resize-handle');
    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', handleResizeStart);
      resizeHandle.addEventListener('mouseenter', () => {
        if (!isResizing) {
          (resizeHandle as HTMLElement).style.background = '#3b82f6';
        }
      });
      resizeHandle.addEventListener('mouseleave', () => {
        if (!isResizing) {
          (resizeHandle as HTMLElement).style.background = '#495365';
        }
      });
    }

    // Add close button handler
    const closeBtn = drawer.querySelector('#close-terminal-btn');
    closeBtn?.addEventListener('click', hideDrawer);

    // Add hover effect for close button
    closeBtn?.addEventListener('mouseenter', () => {
      (closeBtn as HTMLElement).style.background = 'rgba(255, 255, 255, 0.1)';
      (closeBtn as HTMLElement).style.color = '#fff';
    });

    closeBtn?.addEventListener('mouseleave', () => {
      (closeBtn as HTMLElement).style.background = 'transparent';
      (closeBtn as HTMLElement).style.color = '#999';
    });

    // Add position settings button handler
    const positionBtn = drawer.querySelector('#position-settings-btn');
    if (positionBtn) {
      const dropdown = createPositionDropdown();

      // Add hover effect for position button
      positionBtn.addEventListener('mouseenter', () => {
        (positionBtn as HTMLElement).style.background = 'rgba(255, 255, 255, 0.1)';
        (positionBtn as HTMLElement).style.color = '#fff';
      });

      positionBtn.addEventListener('mouseleave', () => {
        if (dropdown.style.display !== 'block') {
          (positionBtn as HTMLElement).style.background = 'transparent';
          (positionBtn as HTMLElement).style.color = '#999';
        }
      });

      positionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = dropdown.style.display === 'block';
        dropdown.style.display = isVisible ? 'none' : 'block';
      });

      // Add dropdown to the button's parent
      const buttonContainer = positionBtn.parentElement;
      if (buttonContainer) {
        buttonContainer.style.position = 'relative';
        buttonContainer.appendChild(dropdown);
      }

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!positionBtn.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
          dropdown.style.display = 'none';
        }
      });
    }
  }, 0);

  return drawer;
}

/**
 * Show drawer
 */
export async function showDrawer(): Promise<void> {
  // Load settings on first show
  if (!terminalDrawer) {
    console.log('[TerminalDrawer] Creating drawer with iframe...');
    const settings = await loadSettings();
    currentPosition = settings.position;
    currentSize = settings.size;
    console.log('[TerminalDrawer] Loaded settings:', { position: currentPosition, size: currentSize });
    terminalDrawer = createDrawer();
    document.body.appendChild(terminalDrawer);
  }

  isDrawerOpen = true;
  updateDrawerPosition();

  console.log('[TerminalDrawer] Drawer opened at position:', currentPosition, 'size:', currentSize);
}

/**
 * Hide drawer
 */
export function hideDrawer(): void {
  if (terminalDrawer) {
    isDrawerOpen = false;
    updateDrawerPosition();
    console.log('[TerminalDrawer] Drawer closed');
  }
}

/**
 * Toggle drawer
 */
export async function toggleDrawer(): Promise<void> {
  if (isDrawerOpen) {
    hideDrawer();
  } else {
    await showDrawer();
  }
}

/**
 * Auto-start terminal (no-op for iframe version)
 * 终端在 iframe 中自动初始化
 */
export async function autoStartTerminal(): Promise<void> {
  console.log('[TerminalDrawer] Auto-start not needed for iframe version');
  console.log('[TerminalDrawer] Terminal will initialize when drawer is opened');
}

/**
 * Cleanup
 */
export function cleanup(): void {
  // Remove resize event listeners
  if (isResizing) {
    document.removeEventListener('mousemove', handleResizeMove);
    document.removeEventListener('mouseup', handleResizeEnd);
  }

  // Remove overlay
  const overlay = document.getElementById('resize-overlay');
  if (overlay) {
    overlay.remove();
  }

  if (terminalDrawer) {
    terminalDrawer.remove();
    terminalDrawer = null;
  }

  isDrawerOpen = false;
  terminalInitialized = false;
  isResizing = false;

  console.log('[TerminalDrawer] Cleaned up');
}
