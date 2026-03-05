/**
 * Inject CSS styles into page
 */
export function injectStyles(css: string): void {
  const styleElement = document.createElement('style');
  styleElement.textContent = css;
  document.head.appendChild(styleElement);
}

/**
 * Load and inject notification styles
 */
export async function injectNotificationStyles(): Promise<void> {
  try {
    const response = await fetch(chrome.runtime.getURL('src/styles/notifications.css'));
    const css = await response.text();
    injectStyles(css);
  } catch (error) {
    console.error('[Styles] Failed to load notification styles:', error);
  }
}
