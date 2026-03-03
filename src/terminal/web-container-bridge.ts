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
      this.wc = await WebContainer.boot();

      // Fetch project files from Overleaf
      const files = await this.fetchProjectFiles();

      // Mount files to workspace
      await this.wc.mount(files);

      // Install claude-code
      this.terminal.writeln('Installing Claude Code CLI...');
      const installProcess = await this.wc.spawn('npm', ['install', '-g', '@anthropic-ai/claude-code']);

      const exitCode = await installProcess.exit;
      if (exitCode !== 0) {
        this.terminal.writeln('\x1b[33mWarning: Claude Code installation may have issues\x1b[0m');
      } else {
        this.terminal.writeln('\x1b[32mClaude Code installed!\x1b[0m');
      }

      // Start shell
      await this.startShell();

    } catch (err) {
      this.terminal.writeln(`\x1b[31mWebContainer init failed: ${(err as Error).message}\x1b[0m`);
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
