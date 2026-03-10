/**
 * Terminal Drawer Component (Content Script)
 * 使用 iframe 加载独立的终端页面
 */

let terminalDrawer: HTMLElement | null = null;
let isDrawerOpen = false;
let terminalInitialized = false;

/**
 * Create drawer container with iframe
 */
function createDrawer(): HTMLElement {
  const drawer = document.createElement('div');
  drawer.id = 'mirror-terminal-drawer';
  drawer.style.cssText = `
    position: fixed;
    top: 0;
    right: -600px;
    width: 600px;
    height: 100vh;
    background: #1a1a1a;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
    z-index: 999999;
    transition: right 0.3s ease-in-out;
    display: flex;
    flex-direction: column;
  `;

  drawer.innerHTML = `
    <div class="drawer-header" style="
      background: #2d2d2d;
      padding: 12px 16px;
      border-bottom: 1px solid #404040;
      display: flex;
      justify-content: space-between;
      align-items: center;
    ">
      <span style="
        color: #fff;
        font-size: 14px;
        font-weight: 500;
      ">Claude Terminal</span>
      <button id="close-terminal-btn" style="
        background: transparent;
        border: none;
        color: #999;
        font-size: 20px;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
      ">×</button>
    </div>
    <div class="drawer-body" style="
      flex: 1;
      overflow: hidden;
      background: #000;
    ">
      <iframe
        id="terminal-iframe"
        src="${chrome.runtime.getURL('public/terminal.html')}"
        style="
          width: 100%;
          height: 100%;
          border: none;
        "
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      ></iframe>
    </div>
  `;

  // Add close button handler
  setTimeout(() => {
    const closeBtn = drawer.querySelector('#close-terminal-btn');
    closeBtn?.addEventListener('click', hideDrawer);
  }, 0);

  return drawer;
}

/**
 * Show drawer
 */
export async function showDrawer(): Promise<void> {
  if (!terminalDrawer) {
    console.log('[TerminalDrawer] Creating drawer with iframe...');
    terminalDrawer = createDrawer();
    document.body.appendChild(terminalDrawer);
  }

  isDrawerOpen = true;
  terminalDrawer.style.right = '0';

  console.log('[TerminalDrawer] Drawer opened');
}

/**
 * Hide drawer
 */
export function hideDrawer(): void {
  if (terminalDrawer) {
    terminalDrawer.style.right = '-600px';
    isDrawerOpen = false;
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
  if (terminalDrawer) {
    terminalDrawer.remove();
    terminalDrawer = null;
  }

  isDrawerOpen = false;
  terminalInitialized = false;

  console.log('[TerminalDrawer] Cleaned up');
}
