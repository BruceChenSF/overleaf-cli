/**
 * Shared types for Overleaf Mirror system
 */

import { EditEventMessage } from './shared-types';

// WebSocket message types
export type WSMessage =
  | MirrorRequestMessage
  | SyncCommandMessage
  | AckMessage
  | EditEventMessage
  | BlobMappingMessage
  | FileSyncMessage
  | FileCreatedMessage
  | FileDeletedMessage
  | FileRenamedMessage
  | InitialSyncCompleteMessage
  | DirectoryCreatedMessage
  | DirectoryRenamedMessage
  | DirectoryDeletedMessage
  | ExistingFoldersMessage
  | SyncToOverleafMessage
  | SyncToOverleafResponse
  | TerminalStartMessage
  | TerminalDataMessage
  | TerminalResizeMessage
  | TerminalReadyMessage
  | TerminalExitMessage
  | TerminalErrorMessage;

export interface FileCreatedMessage {
  type: 'file_created';
  project_id: string;
  file_name: string;
  file_id: string;
  timestamp: number;
}

export interface DirectoryCreatedMessage {
  type: 'directory_created';
  project_id: string;
  path: string;
  folder_id: string;
  timestamp: number;
}

export interface DirectoryRenamedMessage {
  type: 'directory_renamed';
  project_id: string;
  old_path: string;
  new_path: string;
  folder_id: string;
  timestamp: number;
}

export interface DirectoryDeletedMessage {
  type: 'directory_deleted';
  project_id: string;
  path: string;
  folder_id: string;
  timestamp: number;
}

export interface ExistingFoldersMessage {
  type: 'existing_folders';
  project_id: string;
  folders: string[];  // List of folder paths that already exist
  timestamp: number;
}

export interface FileDeletedMessage {
  type: 'file_deleted';
  project_id: string;
  file_id: string;
  path: string;
  timestamp: number;
}

export interface FileRenamedMessage {
  type: 'file_renamed';
  project_id: string;
  old_name: string;
  new_name: string;
  file_id: string;
  timestamp: number;
}

export interface InitialSyncCompleteMessage {
  type: 'initial_sync_complete';
  project_id: string;
  timestamp: number;
}

export interface BlobMappingMessage {
  type: 'blob_mapping';
  project_id: string;
  blob_hash: string;
  filename: string;
  url: string;
}

export interface FileSyncMessage {
  type: 'file_sync';
  project_id: string;
  path: string;
  content_type: 'doc' | 'file';
  content: string; // Base64 encoded for files, plain text for docs
  doc_id?: string; // Optional doc_id for mapping path to docId
  timestamp: number;
}

export interface MirrorRequestMessage {
  type: 'mirror';
  project_id: string;
  api_endpoint: string;
  method: string;
  data: unknown;
}

export interface SyncCommandMessage {
  type: 'sync';
  project_id: string;
  operation: 'create' | 'update' | 'delete' | 'rename' | 'initial_sync';
  path?: string;
  content?: string;
  new_path?: string;
}

export interface AckMessage {
  type: 'ack';
  request_id: string;
  success: boolean;
  error?: string;
}

// File system types
export interface FileMetadata {
  path: string;
  version: string;
  lastModified: number;
  size: number;
  isBinary: boolean;
}

export interface ProjectState {
  projectId: string;
  lastSync: number;
  localVersion: Record<string, string>;
  remoteVersion: Record<string, string>;
  pendingSync: PendingSyncTask[];
}

export interface PendingSyncTask {
  operation: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  new_path?: string;
  content?: string;
  attempts: number;
  lastAttempt: number;
  error?: string;
}

// Overleaf API types
export interface OverleafDocument {
  _id: string;
  name: string;
  folder: string | null;
  created: string;
  updated: string;
}

export interface OverleafDocumentContent extends OverleafDocument {
  content: string;
  version: number;
}

export interface OverleafFolder {
  _id: string;
  name: string;
  parentFolderId: string | null;
}

export interface OverleafFileListResponse {
  docs: OverleafDocument[];
}

// File extension filter types
export interface FileFilterConfig {
  syncableExtensions: Set<string>;
  maxFileSize: number;
}

// Error types
export interface MirrorError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

export enum ErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SERVER_ERROR = 'SERVER_ERROR'
}

// Server configuration types
export interface ServerConfig {
  port: number;
  host: string;
  projectDir: string;
  maxConnections: number;
  enableLogging: boolean;
}

// Client connection types
export interface ClientInfo {
  id: string;
  projectId: string;
  connectedAt: number;
  lastMessageAt: number;
}

// File operations types
export interface FileOperation {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  new_path?: string;
  content?: string;
  timestamp: number;
  source: 'overleaf' | 'local';
}

// Sync status types
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'pending' | 'conflict' | 'error';

export interface SyncResult {
  success: boolean;
  path: string;
  message?: string;
  error?: MirrorError;
  checksum?: string;
}

// API request/response types
export interface APIRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface APIResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

// Event types
export interface ServerEvent {
  type: 'client_connected' | 'client_disconnected' | 'mirror_request' | 'sync_command' | 'error';
  timestamp: number;
  data: unknown;
}

// Logger types
export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
}

// Version types
export interface VersionInfo {
  version: string;
  buildDate: string;
  gitCommit?: string;
}

// Local to Overleaf sync messages
export interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  content?: string;
  doc_id?: string;
  timestamp: number;
}

export interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  timestamp: number;
}

// Terminal message types
export interface TerminalStartMessage {
  type: 'terminal_start';
  project_id: string;
  cols?: number;
  rows?: number;
  timestamp: number;
}

export interface TerminalDataMessage {
  type: 'terminal_data';
  session_id: string;
  data: string;
  timestamp: number;
}

export interface TerminalResizeMessage {
  type: 'terminal_resize';
  session_id: string;
  cols: number;
  rows: number;
  timestamp: number;
}

export interface TerminalReadyMessage {
  type: 'terminal_ready';
  session_id: string;
  pid: number;
  cwd: string;
  timestamp: number;
}

export interface TerminalExitMessage {
  type: 'terminal_exit';
  session_id: string;
  exit_code: number;
  signal?: string;
  timestamp: number;
}

export interface TerminalErrorMessage {
  type: 'terminal_error';
  session_id: string;
  error: string;
  timestamp: number;
}