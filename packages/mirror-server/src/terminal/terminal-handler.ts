import { WebSocket } from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import { ProjectConfigStore } from '../config';
import { PtyManager, PtyOptions } from './pty-manager';
import { TerminalSession } from './terminal-session';
import type { ClientConnection } from '../client-connection';

/**
 * Terminal message types
 */
interface TerminalStartMessage {
  type: 'terminal_start';
  project_id: string;
  cols?: number;
  rows?: number;
  timestamp: number;
}

interface TerminalDataMessage {
  type: 'terminal_data';
  session_id: string;
  data: string;
  timestamp: number;
}

interface TerminalResizeMessage {
  type: 'terminal_resize';
  session_id: string;
  cols: number;
  rows: number;
  timestamp: number;
}

type TerminalMessage = TerminalStartMessage | TerminalDataMessage | TerminalResizeMessage;

/**
 * Manages terminal sessions and handles terminal-related requests
 * Integrates with ProjectConfigStore for working directory
 */
export class TerminalHandler {
  private sessions: Map<string, TerminalSession> = new Map();
  private connectionSessions: Map<ClientConnection, string> = new Map();
  private ptyManager: PtyManager;

  constructor(
    private configStore: ProjectConfigStore
  ) {
    this.ptyManager = new PtyManager();
    console.log('[TerminalHandler] Initialized');
  }

  /**
   * Handle terminal message from client
   * @param connection - Client connection
   * @param message - Terminal message
   */
  handleTerminalMessage(connection: ClientConnection, message: TerminalMessage): void {
    try {
      switch (message.type) {
        case 'terminal_start':
          this.handleTerminalStart(connection, message as TerminalStartMessage);
          break;

        case 'terminal_data':
          this.handleTerminalData(message as TerminalDataMessage);
          break;

        case 'terminal_resize':
          this.handleTerminalResize(message as TerminalResizeMessage);
          break;

        default:
          console.warn('[TerminalHandler] Unknown message type:', (message as any).type);
      }
    } catch (error) {
      console.error('[TerminalHandler] Error handling message:', error);
    }
  }

  /**
   * Handle terminal start request
   * @param connection - Client connection
   * @param message - Terminal start message
   */
  private handleTerminalStart(connection: ClientConnection, message: TerminalStartMessage): void {
    const { project_id, cols = 80, rows = 24 } = message;

    console.log(`[TerminalHandler] Terminal start request for project: ${project_id}`);

    // Get working directory from project config
    const workingDir = this.getProjectWorkingDir(project_id);

    // Check if connection already has a terminal session
    const existingSessionId = this.connectionSessions.get(connection);
    if (existingSessionId) {
      const existingSession = this.sessions.get(existingSessionId);
      if (existingSession && existingSession.isActive()) {
        console.warn(`[TerminalHandler] Connection already has active terminal session: ${existingSessionId}`);
        this.sendMessage(connection.getWebSocket(), {
          type: 'terminal_error',
          session_id: existingSessionId,
          error: 'Terminal session already active for this connection',
          timestamp: Date.now()
        });
        return;
      }
    }

    // Create new session ID
    const sessionId = this.generateSessionId();

    // Create terminal session
    const session = new TerminalSession(
      connection.getWebSocket(),
      project_id,
      sessionId,
      this.ptyManager
    );

    // Start terminal with working directory
    const options: PtyOptions = {
      cols,
      rows,
      cwd: workingDir
    };

    session.start(options);

    // Store session
    this.sessions.set(sessionId, session);
    this.connectionSessions.set(connection, sessionId);

    // Track session in connection for cleanup
    (connection as any).setTerminalSession(sessionId);

    console.log(`[TerminalHandler] Terminal session ${sessionId} started for project ${project_id}`);
  }

  /**
   * Handle terminal data (user input)
   * @param message - Terminal data message
   */
  private handleTerminalData(message: TerminalDataMessage): void {
    const { session_id, data } = message;

    const session = this.sessions.get(session_id);
    if (!session) {
      console.warn(`[TerminalHandler] Session not found: ${session_id}`);
      return;
    }

    if (!session.isActive()) {
      console.warn(`[TerminalHandler] Session ${session_id} is not active`);
      return;
    }

    // Write data to PTY
    session.write(data);
  }

  /**
   * Handle terminal resize request
   * @param message - Terminal resize message
   */
  private handleTerminalResize(message: TerminalResizeMessage): void {
    const { session_id, cols, rows } = message;

    const session = this.sessions.get(session_id);
    if (!session) {
      console.warn(`[TerminalHandler] Session not found: ${session_id}`);
      return;
    }

    if (!session.isActive()) {
      console.warn(`[TerminalHandler] Session ${session_id} is not active`);
      return;
    }

    // Resize terminal
    session.resize(cols, rows);
  }

  /**
   * Get working directory for project from ProjectConfigStore
   * @param projectId - Project identifier
   * @returns Working directory path
   */
  private getProjectWorkingDir(projectId: string): string {
    try {
      const config = this.configStore.getProjectConfig(projectId);
      const workingDir = config.localPath;

      // Verify directory exists
      if (!fs.existsSync(workingDir)) {
        console.warn(`[TerminalHandler] Working dir not found: ${workingDir}`);
        console.warn(`[TerminalHandler] Creating directory: ${workingDir}`);

        // Try to create directory
        try {
          fs.mkdirSync(workingDir, { recursive: true });
          console.log(`[TerminalHandler] Created working directory: ${workingDir}`);
        } catch (error) {
          console.error(`[TerminalHandler] Failed to create working directory:`, error);
          // Fallback to user home directory
          const fallbackDir = os.homedir();
          console.warn(`[TerminalHandler] Falling back to home directory: ${fallbackDir}`);
          return fallbackDir;
        }
      }

      console.log(`[TerminalHandler] Using working dir for project ${projectId}: ${workingDir}`);
      return workingDir;
    } catch (error) {
      console.error(`[TerminalHandler] Failed to get working dir for project ${projectId}:`, error);
      // Fallback to current directory
      const fallbackDir = process.cwd();
      console.warn(`[TerminalHandler] Falling back to current directory: ${fallbackDir}`);
      return fallbackDir;
    }
  }

  /**
   * Generate unique session ID
   * @returns Session identifier
   */
  private generateSessionId(): string {
    return `terminal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Send message to client
   * @param ws - WebSocket connection
   * @param message - Message object
   */
  private sendMessage(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('[TerminalHandler] Failed to send message:', error);
      }
    }
  }

  /**
   * Cleanup terminal sessions for a connection
   * @param connection - Client connection to cleanup
   */
  cleanupConnection(connection: ClientConnection): void {
    const sessionId = this.connectionSessions.get(connection);
    if (!sessionId) {
      console.log('[TerminalHandler] No terminal session to cleanup for connection');
      return;
    }

    console.log(`[TerminalHandler] Cleaning up terminal session: ${sessionId}`);

    const session = this.sessions.get(sessionId);
    if (session) {
      session.destroy();
      this.sessions.delete(sessionId);
    }

    this.connectionSessions.delete(connection);

    // Clear session tracking in connection
    if ((connection as any).clearTerminalSession) {
      (connection as any).clearTerminalSession();
    }
  }

  /**
   * Destroy all terminal sessions (for shutdown)
   */
  destroyAll(): void {
    console.log('[TerminalHandler] Destroying all terminal sessions');

    this.sessions.forEach((session, sessionId) => {
      console.log(`[TerminalHandler] Destroying session: ${sessionId}`);
      session.destroy();
    });

    this.sessions.clear();
    this.connectionSessions.clear();
  }
}
