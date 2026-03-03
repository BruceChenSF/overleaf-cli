// Message types for extension communication
export type ExtensionMessage =
  | OpenTerminalMessage
  | SyncFileMessage
  | FetchFilesMessage
  | TerminalReadyMessage;

export interface OpenTerminalMessage {
  type: 'OPEN_TERMINAL';
  projectId: string;
  projectUrl: string;
  csrfToken: string;
  domain: 'overleaf.com' | 'cn.overleaf.com';
}

export interface SyncFileMessage {
  type: 'SYNC_FILE';
  projectId: string;
  filepath: string;
  content: string;
}

export interface FetchFilesMessage {
  type: 'FETCH_FILES';
  projectId: string;
}

export interface TerminalReadyMessage {
  type: 'TERMINAL_READY';
  windowId: number;
}

// Overleaf API types
export interface OverleafDoc {
  _id: string;
  name: string;
  path: string;
}

export interface OverleafProject {
  _id: string;
  name: string;
}

// Sync state
export interface FileSyncState {
  filepath: string;
  docId: string;
  lastSyncedAt: number;
  localHash: string;
}
