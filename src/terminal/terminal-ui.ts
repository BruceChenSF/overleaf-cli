import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebSocketClient } from './websocket-client';
import 'xterm/css/xterm.css';

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

let wsClient: WebSocketClient | null = null;
let currentLine = '';

async function init(): Promise<void> {
  console.log('[Terminal UI] Starting initialization...');

  const container = document.getElementById('terminal-container');
  if (!container) {
    console.error('[Terminal UI] Container not found!');
    throw new Error('Terminal container not found');
  }

  container.innerHTML = '';
  terminal.open(container);
  fitAddon.fit();
  console.log('[Terminal UI] Terminal opened');

  window.addEventListener('resize', () => {
    fitAddon.fit();
  });

  // Get project context
  const currentWindow = await chrome.windows.getCurrent();
  const windowId = currentWindow.id;
  const context = await chrome.storage.session.get(`window_${windowId}`);
  const projectContext = context[`window_${windowId}`];

  if (!projectContext) {
    terminal.writeln('\x1b[31mError: Project context not found\x1b[0m');
    terminal.writeln('Please close this window and open terminal from Overleaf again.');
    return;
  }

  // Show welcome message
  terminal.writeln('\x1b[1m\x1b[32mOverleaf CC Terminal\x1b[0m');
  terminal.writeln('Project ID: ' + projectContext.projectId);
  terminal.writeln('');

  const csrfToken = projectContext.csrfToken;

  if (!csrfToken) {
    terminal.writeln('\x1b[31mError: CSRF token not found\x1b[0m');
    terminal.writeln('Please close this window and open terminal from Overleaf again.');
    return;
  }

  // Connect to bridge server
  terminal.writeln('Connecting to bridge server...');
  wsClient = new WebSocketClient(terminal);

  try {
    await wsClient.connect(projectContext.projectId, csrfToken);
    terminal.writeln('\x1b[32mConnected!\x1b[0m');
    terminal.writeln('Files are being synchronized from Overleaf...');
    terminal.writeln('');
    terminal.writeln('Type commands or use Claude Code CLI.');
    terminal.writeln('');
    showPrompt();
  } catch (error) {
    terminal.writeln('\x1b[31mFailed to connect to bridge server\x1b[0m');
    terminal.writeln('');
    terminal.writeln('Please make sure the bridge server is running:');
    terminal.writeln('  1. Install: npm install -g @overleaf-cc/bridge');
    terminal.writeln('  2. Run: overleaf-cc-bridge');
    terminal.writeln('');
  }

  // Set up input handling
  terminal.onData((data) => {
    if (data === '\r') {
      terminal.writeln('');
      handleCommand(currentLine.trim());
      currentLine = '';
      showPrompt();
    } else if (data === '\u007F') {
      if (currentLine.length > 0) {
        currentLine = currentLine.slice(0, -1);
        terminal.write('\b \b');
      }
    } else if (data.length === 1) {
      currentLine += data;
      terminal.write(data);
    }
  });
}

function showPrompt(): void {
  terminal.write('\x1b[1m\x1b[36moverleaf\x1b[0m:\x1b[1m\x1b[34m~\x1b[0m$ ');
}

async function handleCommand(command: string): Promise<void> {
  if (!command) return;

  const [cmd, ...args] = command.split(' ');

  switch (cmd) {
    case 'clear':
      terminal.clear();
      break;

    case 'claude':
      if (wsClient) {
        terminal.writeln('Starting Claude Code...');
        wsClient.sendCommand('claude', args);
      }
      break;

    case 'npm':
    case 'node':
    case 'npx':
      if (wsClient) {
        wsClient.sendCommand(cmd, args);
      } else {
        terminal.writeln('\x1b[31mNot connected to bridge server\x1b[0m');
      }
      break;

    case 'help':
      terminal.writeln('Available commands:');
      terminal.writeln('  claude   - Run Claude Code CLI');
      terminal.writeln('  npm      - Run npm commands');
      terminal.writeln('  node     - Run Node.js');
      terminal.writeln('  npx      - Run npx packages');
      terminal.writeln('  clear    - Clear terminal');
      terminal.writeln('  help     - Show this help');
      break;

    default:
      terminal.writeln(`Command not found: ${cmd}`);
      terminal.writeln('Type "help" for available commands.');
  }
}

init().catch(err => {
  console.error('[Terminal UI] Init error:', err);
  terminal.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
});
