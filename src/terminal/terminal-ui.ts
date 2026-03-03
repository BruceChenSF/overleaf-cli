import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebContainerBridge } from './web-container-bridge';

const terminal = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#ffffff',
    selection: '#264f78'
  }
});

const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);

async function init(): Promise<void> {
  const container = document.getElementById('terminal-container');
  if (!container) {
    throw new Error('Terminal container not found');
  }

  container.innerHTML = '';
  terminal.open(container);
  fitAddon.fit();

  // Handle window resize
  window.addEventListener('resize', () => {
    fitAddon.fit();
  });

  // Get project context from storage
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const windowId = tabs[0].windowId;

  const context = await chrome.storage.session.get(`window_${windowId}`);
  const projectContext = context[`window_${windowId}`];

  if (!projectContext) {
    terminal.writeln('\x1b[31mError: Project context not found\x1b[0m');
    terminal.writeln('Please close this window and open terminal from Overleaf again.');
    return;
  }

  // Initialize WebContainer
  const bridge = new WebContainerBridge(terminal, projectContext.projectId);
  await bridge.init();

  terminal.writeln('\x1b[32mWebContainer ready!\x1b[0m');
  terminal.writeln('Type commands or use Claude Code CLI.');
}

init().catch(err => {
  terminal.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
});
