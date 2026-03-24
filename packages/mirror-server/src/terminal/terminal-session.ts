import { WebSocket } from 'ws';
import { PtyManager, PtyOptions, IPty } from './pty-manager';

/**
 * Terminal session state
 */
enum SessionState {
  IDLE = 'idle',
  RUNNING = 'running',
  CLOSED = 'closed'
}

/**
 * Manages a single terminal session lifecycle
 * Handles bidirectional data flow between PTY and WebSocket
 */
export class TerminalSession {
  private ptyProcess?: IPty;
  private state: SessionState = SessionState.IDLE;
  private sessionId: string;

  constructor(
    private ws: WebSocket,
    private projectId: string,
    sessionId: string,
    private ptyManager: PtyManager
  ) {
    this.sessionId = sessionId;
    console.log(`[TerminalSession] Session ${sessionId} created for project ${projectId}`);
  }

  /**
   * Start terminal session with PTY process
   * @param options - PTY creation options
   */
  start(options: PtyOptions): void {
    if (this.state !== SessionState.IDLE) {
      throw new Error(`Session ${this.sessionId} is not in IDLE state`);
    }

    try {
      // Create PTY process
      this.ptyProcess = this.ptyManager.createPty(options);
      this.state = SessionState.RUNNING;

      // Set up PTY data handler → WebSocket
      (this.ptyProcess as any).onData((data: string) => {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.sendMessage({
            type: 'terminal_data',
            session_id: this.sessionId,
            data: data,
            timestamp: Date.now()
          });
        }
      });

      // Set up PTY exit handler → WebSocket
      (this.ptyProcess as any).onExit(({ exitCode, signal }: { exitCode: number; signal?: string }) => {
        console.log(`[TerminalSession] PTY ${this.ptyProcess?.pid} exited: code=${exitCode}, signal=${signal}`);

        if (this.ws.readyState === WebSocket.OPEN) {
          this.sendMessage({
            type: 'terminal_exit',
            session_id: this.sessionId,
            exit_code: exitCode || 0,
            signal: signal || undefined,
            timestamp: Date.now()
          });
        }

        this.state = SessionState.CLOSED;
      });

      // Send ready message to client
      this.sendMessage({
        type: 'terminal_ready',
        session_id: this.sessionId,
        pid: this.ptyProcess.pid,
        cwd: options.cwd || process.cwd(),
        timestamp: Date.now()
      });

      console.log(`[TerminalSession] Session ${this.sessionId} started with PID ${this.ptyProcess.pid}`);
    } catch (error) {
      console.error(`[TerminalSession] Failed to start session ${this.sessionId}:`, error);

      // Send error message to client
      this.sendMessage({
        type: 'terminal_error',
        session_id: this.sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });

      this.state = SessionState.CLOSED;
      throw error;
    }
  }

  /**
   * Write data to PTY (user input)
   * @param data - Input data to write to PTY
   */
  write(data: string): void {
    if (this.state !== SessionState.RUNNING || !this.ptyProcess) {
      console.warn(`[TerminalSession] Cannot write to session ${this.sessionId}: not running`);
      return;
    }

    try {
      (this.ptyProcess as any).write(data);
    } catch (error) {
      console.error(`[TerminalSession] Failed to write to PTY ${this.ptyProcess.pid}:`, error);
    }
  }

  /**
   * Resize terminal dimensions
   * @param cols - Number of columns
   * @param rows - Number of rows
   */
  resize(cols: number, rows: number): void {
    if (this.state !== SessionState.RUNNING || !this.ptyProcess) {
      console.warn(`[TerminalSession] Cannot resize session ${this.sessionId}: not running`);
      return;
    }

    try {
      this.ptyManager.resizePty(this.ptyProcess, cols, rows);
    } catch (error) {
      console.error(`[TerminalSession] Failed to resize PTY ${this.ptyProcess.pid}:`, error);
    }
  }

  /**
   * Destroy terminal session and cleanup PTY process
   */
  destroy(): void {
    if (this.state === SessionState.CLOSED) {
      console.log(`[TerminalSession] Session ${this.sessionId} already closed`);
      return;
    }

    console.log(`[TerminalSession] Destroying session ${this.sessionId}`);

    if (this.ptyProcess) {
      try {
        (this.ptyProcess as any).kill();
        console.log(`[TerminalSession] PTY ${this.ptyProcess.pid} killed`);
      } catch (error) {
        console.error(`[TerminalSession] Failed to kill PTY:`, error);
      }
    }

    this.state = SessionState.CLOSED;
  }

  /**
   * Check if session is active
   * @returns true if session is running
   */
  isActive(): boolean {
    return this.state === SessionState.RUNNING;
  }

  /**
   * Get session ID
   * @returns Session identifier
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get project ID
   * @returns Project identifier
   */
  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Send message to WebSocket client
   * @param message - Message object to send
   */
  private sendMessage(message: any): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
      } catch (error) {
        console.error(`[TerminalSession] Failed to send message to client:`, error);
      }
    } else {
      console.warn(`[TerminalSession] WebSocket not ready, cannot send message`);
    }
  }
}
