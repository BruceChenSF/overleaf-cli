/**
 * Shared types for Overleaf Mirror system
 */

import { EditEventMessage } from '@overleaf-cc/shared';

// WebSocket message types
export type WSMessage =
  | MirrorRequestMessage
  | SyncCommandMessage
  | AckMessage
  | EditEventMessage;

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
  operation: 'create' | 'update' | 'delete' | 'rename';
  path: string;
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