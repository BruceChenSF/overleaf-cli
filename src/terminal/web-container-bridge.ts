import { WebContainer } from '@webcontainer/api';
import type { Terminal } from 'xterm';

export class WebContainerBridge {
  private wc: WebContainer | null = null;
  private terminal: Terminal;
  private projectId: string;

  constructor(terminal: Terminal, projectId: string) {
    this.terminal = terminal;
    this.projectId = projectId;
  }

  async init(): Promise<void> {
    try {
      // Check cross-origin isolation
      console.log('[WebContainer] Checking cross-origin isolation...');
      console.log('[WebContainer] crossOriginIsolated:', crossOriginIsolated);
      console.log('[WebContainer] SharedArrayBuffer:', typeof SharedArrayBuffer);

      if (!crossOriginIsolated) {
        this.terminal.writeln('\x1b[33mWarning: Cross-origin isolation not enabled\x1b[0m');
        this.terminal.writeln('WebContainer requires cross-origin isolation to work.');
        this.terminal.writeln('');
        this.terminal.writeln('Required headers:');
        this.terminal.writeln('  Cross-Origin-Opener-Policy: same-origin');
        this.terminal.writeln('  Cross-Origin-Embedder-Policy: require-corp');
        this.terminal.writeln('');
        throw new Error('Cross-origin isolation not enabled. SharedArrayBuffer is not available.');
      }

      console.log('[WebContainer] Starting boot...');
      this.terminal.writeln('[1/4] Booting WebContainer...');

      // Add timeout
      const bootPromise = WebContainer.boot();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WebContainer boot timeout (30s)')), 30000)
      );

      this.wc = await Promise.race([bootPromise, timeoutPromise]) as WebContainer;

      console.log('[WebContainer] Boot complete!');
      this.terminal.writeln('[2/4] Setting up project files...');

      // TODO: Fetch project files from Overleaf (API integration disabled for now)
      // const files = await this.fetchProjectFiles();

      // Create empty project structure
      const files = {
        'README.md': {
          file: { contents: '# Overleaf Project\n\nProject files will be synced here once API integration is complete.' }
        }
      };

      // Mount files to workspace
      await this.wc.mount(files);

      console.log('[WebContainer] Files mounted');
      this.terminal.writeln('[3/4] Installing Claude Code CLI (this may take a minute)...');

      // Install claude-code
      const installProcess = await this.wc.spawn('npm', ['install', '-g', '@anthropic-ai/claude-code']);

      console.log('[WebContainer] Install process spawned, waiting for completion...');

      const exitCode = await installProcess.exit;
      console.log('[WebContainer] Install exit code:', exitCode);

      if (exitCode !== 0) {
        this.terminal.writeln('\x1b[33mWarning: Claude Code installation may have issues\x1b[0m');
      } else {
        this.terminal.writeln('\x1b[32mClaude Code installed!\x1b[0m');
      }

      console.log('[WebContainer] Starting shell...');
      this.terminal.writeln('[4/4] Starting shell...');

      // Start shell
      await this.startShell();

      console.log('[WebContainer] Init complete!');

    } catch (err) {
      console.error('[WebContainer] Init failed:', err);
      this.terminal.writeln(`\x1b[31mWebContainer init failed: ${(err as Error).message}\x1b[0m`);

      if ((err as Error).message.includes('timeout')) {
        this.terminal.writeln('\x1b[33mPossible reasons:\x1b[0m');
        this.terminal.writeln('- Network connection to Stackblitz failed');
        this.terminal.writeln('- WebContainer API is blocked in this environment');
        this.terminal.writeln('- Firewall or proxy preventing WASM download');
      }

      throw err;
    }
  }

  private async fetchProjectFiles(): Promise<Record<string, { file: { contents: string } }>> {
    const response = await chrome.runtime.sendMessage({
      type: 'FETCH_FILES',
      projectId: this.projectId
    });

    if (!response?.files) {
      throw new Error('Failed to fetch project files');
    }

    const files: Record<string, { file: { contents: string } }> = {};

    for (const doc of response.files) {
      const path = doc.path.startsWith('/') ? doc.path.slice(1) : doc.path;
      files[path] = {
        file: { contents: doc.content }
      };
    }

    return files;
  }

  private async startShell(): Promise<void> {
    if (!this.wc) return;

    // Use proper shell with pty
    const shellProcess = await this.wc.spawn('/bin/jsh', [], {
      terminal: {
        cols: 80,
        rows: 24
      }
    });

    // Pipe output to terminal
    const output = this.terminal as any;
    shellProcess.output.pipeTo(new WritableStream({
      write: (data) => {
        output.write(data);
      }
    }));

    // Set up interactive mode
    this.terminal.onData((data: string) => {
      shellProcess.stdin?.write(data);
    });
  }
}
