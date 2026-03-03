import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebContainerBridge } from './web-container-bridge';
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

  // Handle window resize
  window.addEventListener('resize', () => {
    fitAddon.fit();
  });

  // Get project context from storage
  console.log('[Terminal UI] Getting project context...');

  // Get current window
  const currentWindow = await chrome.windows.getCurrent();
  console.log('[Terminal UI] Current window:', currentWindow);
  const windowId = currentWindow.id;
  console.log('[Terminal UI] Window ID:', windowId);

  const context = await chrome.storage.session.get(`window_${windowId}`);
  console.log('[Terminal UI] Storage context:', context);
  const projectContext = context[`window_${windowId}`];

  if (!projectContext) {
    console.error('[Terminal UI] Project context not found!');
    terminal.writeln('\x1b[31mError: Project context not found\x1b[0m');
    terminal.writeln('Please close this window and open terminal from Overleaf again.');
    return;
  }

  console.log('[Terminal UI] Project context:', projectContext);

  // Show welcome message
  terminal.writeln('\x1b[1m\x1b[32mOverleaf CC Terminal\x1b[0m');
  terminal.writeln('Project ID: ' + projectContext.projectId);
  terminal.writeln('');

  // Try to initialize WebContainer
  console.log('[Terminal UI] Initializing WebContainer...');
  terminal.writeln('Initializing WebContainer...');

  const bridge = new WebContainerBridge(terminal, projectContext.projectId);

  try {
    await bridge.init();
    terminal.writeln('\x1b[32mWebContainer ready!\x1b[0m');
    terminal.writeln('Type commands or use Claude Code CLI.');
  } catch (err) {
    console.error('[Terminal UI] WebContainer failed:', err);
    terminal.writeln('\x1b[31mWebContainer initialization failed.\x1b[0m');
    terminal.writeln('');
    terminal.writeln('\x1b[33mFalling back to simple terminal mode.\x1b[0m');
    terminal.writeln('Note: File sync and Claude Code are not available in this mode.');
    terminal.writeln('');
    initSimpleMode(terminal);
  }
}

function initSimpleMode(terminal: Terminal): void {
  let currentLine = '';
  let prompt = '\x1b[1m\x1b[36moverleaf\x1b[0m:\x1b[1m\x1b[34m~\x1b[0m$ ';

  terminal.writeln('Simple terminal initialized. Type "help" for available commands.');
  terminal.write(prompt);

  terminal.onData((data) => {
    if (data === '\r') { // Enter
      terminal.writeln('');
      handleCommand(currentLine.trim(), terminal);
      currentLine = '';
      terminal.write(prompt);
    } else if (data === '\u007F') { // Backspace
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

function handleCommand(cmd: string, terminal: Terminal): void {
  const args = cmd.split(' ');
  const command = args[0].toLowerCase();

  switch (command) {
    case 'help':
      terminal.writeln('Available commands:');
      terminal.writeln('  help     - Show this help message');
      terminal.writeln('  clear    - Clear the terminal');
      terminal.writeln('  echo     - Echo arguments');
      terminal.writeln('  date     - Show current date/time');
      terminal.writeln('  version  - Show version info');
      break;
    case 'clear':
      terminal.clear();
      break;
    case 'echo':
      terminal.writeln(args.slice(1).join(' '));
      break;
    case 'date':
      terminal.writeln(new Date().toString());
      break;
    case 'version':
      terminal.writeln('Overleaf CC v0.1.0 (Simple Mode)');
      terminal.writeln('WebContainer: Not available');
      break;
    case '':
      break;
    default:
      terminal.writeln(`Command not found: ${command}`);
      terminal.writeln('Type "help" for available commands.');
  }
}

init().catch(err => {
  console.error('[Terminal UI] Init error:', err);
  terminal.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
});
