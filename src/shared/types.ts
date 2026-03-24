// Message types for extension communication
export type ExtensionMessage = OpenTerminalMessage | TerminalReadyMessage | GetCookiesMessage;

export interface OpenTerminalMessage {
  type: 'OPEN_TERMINAL';
  projectId: string;
  projectUrl: string;
  csrfToken: string;
}

export interface TerminalReadyMessage {
  type: 'TERMINAL_READY';
  windowId: number;
}

export interface GetCookiesMessage {
  type: 'GET_COOKIES';
  domain: string;
}

export interface CookiesResponse {
  overleaf_session2?: string;
  GCLB?: string;
}

/**
 * Diff Patch structure for partial sync
 */
export interface DiffPatch {
  type: 'diff';
  checksum: string;
  timestamp: number;
  baseChecksum?: string;
  changes: DiffChange[];
}

export interface DiffChange {
  type: 'INSERT' | 'DELETE' | 'EQUAL';
  text: string;
  position: number;
}

/**
 * Sync status types
 */
export type SyncMode = 'auto' | 'manual';
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'pending' | 'conflict' | 'error';

/**
 * File information with metadata
 */
export interface FileInfoExtended {
  id: string;
  name: string;
  path: string;
  type?: string;
  checksum?: string;
  modifiedTime?: number;
}

/**
 * Conflict information
 */
export interface ConflictInfo {
  type: 'conflict';
  path: string;
  editorChecksum: string;
  localChecksum: string;
  lastSyncedChecksum: string;
  editorContent?: string;
  localContent?: string;
}

/**
 * Change record from Git
 */
export interface ChangeRecord {
  hash: string;
  date: string;
  message: string;
  filePath: string;
  source: 'overleaf' | 'claude';
}

/**
 * Application state
 */
export interface AppState {
  connection: {
    bridge: 'connected' | 'disconnected' | 'error';
    websocket: 'connected' | 'disconnected';
    lastError: string | null;
  };
  sync: {
    mode: SyncMode;
    status: SyncStatus;
    pendingChanges: number;
    lastSyncTime: number | null;
    currentFile: string | null;
  };
  terminal: {
    mode: 'local' | 'in-page';
    sidebarVisible: boolean;
    popupWindowId: number | null;
  };
  preferences: {
    syncMode: SyncMode;
    terminalMode: 'local' | 'in-page';
    autoSyncInterval: number;
  };
}

/**
 * WebSocket messages
 */
export type ExtensionToBridgeMessage =
  | { type: 'GET_FILE_CONTENT'; payload: { path: string } }
  | { type: 'SET_FILE_CONTENT'; payload: { path: string; content: string; source: 'overleaf' | 'claude' } }
  | { type: 'APPLY_DIFF'; payload: { path: string; diff: DiffPatch; source: string } }
  | { type: 'GET_FILE_STATUS'; payload: { path: string } }
  | { type: 'GET_ALL_FILES'; payload?: never }
  | { type: 'GET_HISTORY'; payload: { path: string; limit?: number } }
  | { type: 'PING'; payload?: never };

export type BridgeToExtensionMessage =
  | { type: 'FILE_CONTENT'; payload: { path: string; content: string; checksum: string } }
  | { type: 'FILE_STATUS'; payload: { path: string; checksum: string; modifiedTime: number } }
  | { type: 'ALL_FILES'; payload: FileInfoExtended[] }
  | { type: 'FILE_CHANGED'; payload: { path: string; checksum: string } }
  | { type: 'TASK_COMPLETE'; payload: { taskId: string; modifiedFiles: string[] } }
  | { type: 'CONFLICT_DETECTED'; payload: ConflictInfo }
  | { type: 'HISTORY'; payload: ChangeRecord[] }
  | { type: 'PONG'; payload?: never }
  | { type: 'ERROR'; payload: { message: string; code?: string } };

/**
 * Error handling types
 */
export interface ErrorRecord {
  id: string;
  message: string;
  stack?: string;
  context: ErrorContext;
  timestamp: number;
}

export interface ErrorContext {
  category: 'connection' | 'sync' | 'file' | 'unknown';
  operation: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details?: Record<string, unknown>;
}

/**
 * Notification types
 */
export interface Notification {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
  actions?: NotificationAction[];
}

export interface NotificationAction {
  label: string;
  action: () => void;
}
