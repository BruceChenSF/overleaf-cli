const pty = require('node-pty');
import * as os from 'os';

/**
 * IPty interface from node-pty
 */
export interface IPty {
  pid: number;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (data: { exitCode: number; signal?: string }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

/**
 * PTY creation options
 */
export interface PtyOptions {
  /** Terminal columns (default: 80) */
  cols?: number;
  /** Terminal rows (default: 24) */
  rows?: number;
  /** Working directory (default: current directory) */
  cwd?: string;
  /** Environment variables (default: process.env) */
  env?: Record<string, string>;
  /** Shell executable (default: auto-detected) */
  shell?: string;
  /** Shell arguments */
  args?: string[];
}

/**
 * Manages PTY (pseudoterminal) process creation and operations
 */
export class PtyManager {
  /**
   * Create a new PTY process
   * @param options - PTY configuration options
   * @returns PTY process instance
   */
  createPty(options: PtyOptions = {}): IPty {
    const {
      cols = 80,
      rows = 24,
      cwd = process.cwd(),
      env = process.env,
      shell = this.getDefaultShell(),
      args = []
    } = options;

    console.log(`[PtyManager] Creating PTY process:`);
    console.log(`  Shell: ${shell}`);
    console.log(`  CWD: ${cwd}`);
    console.log(`  Dimensions: ${cols}x${rows}`);

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      env: {
        ...env,
        TERM: 'xterm-256color'
      }
    });

    console.log(`[PtyManager] PTY process created with PID: ${ptyProcess.pid}`);
    return ptyProcess as any;
  }

  /**
   * Resize PTY terminal dimensions
   * @param ptyProcess - PTY process instance
   * @param cols - Number of columns
   * @param rows - Number of rows
   */
  resizePty(ptyProcess: IPty, cols: number, rows: number): void {
    try {
      (ptyProcess as any).resize(cols, rows);
      console.log(`[PtyManager] Resized PTY ${ptyProcess.pid} to ${cols}x${rows}`);
    } catch (error) {
      console.error(`[PtyManager] Failed to resize PTY ${ptyProcess.pid}:`, error);
    }
  }

  /**
   * Get default shell for current platform
   * @returns Shell executable path
   */
  getDefaultShell(): string {
    const platform = os.platform();
    let shell: string;

    if (platform === 'win32') {
      shell = process.env.COMSPEC || 'cmd.exe';
      if (process.env.PSModulePath) {
        shell = 'powershell.exe';
      }
    } else {
      shell = process.env.SHELL || '/bin/bash';
    }

    console.log(`[PtyManager] Platform: ${platform}, Default shell: ${shell}`);
    return shell;
  }
}
