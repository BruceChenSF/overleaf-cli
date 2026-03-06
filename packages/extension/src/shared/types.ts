/**
 * Shared types for browser extension
 * (Mirrors server types for Type safety)
 */

export type WSMessage =
  | MirrorRequestMessage
  | SyncCommandMessage
  | EditEventMessage
  | AckMessage;

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

// OT Operation types
export type AnyOperation = InsertOperation | DeleteOperation | RetainOperation;

export interface InsertOperation {
  i: string;  // text to insert
  p: number;  // position
}

export interface DeleteOperation {
  d: string;  // text to delete
  p: number;  // position
}

export interface RetainOperation {
  p: number;  // cursor position
}

export interface EditEventMessage {
  type: 'edit_event';
  project_id: string;
  data: EditEventData;
}

export interface EditEventData {
  doc_id: string;
  doc_name: string;
  version: number;
  ops: AnyOperation[];
  meta?: {
    user_id: string;
    source: string;        // 'local' | 'remote'
    timestamp: number;
  };
}

export interface AckMessage {
  type: 'ack';
  request_id: string;
  success: boolean;
  error?: string;
}

export interface APIRequest {
  url: string;
  method: string;
  body?: any;
  headers?: Record<string, string>;
}

// Text file extension whitelist
export const TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  // LaTeX related
  '.tex', '.bib', '.cls', '.sty', '.def', '.bst',
  // Text files
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml',
  // Code files
  '.js', '.ts', '.jsx', '.tsx', '.py', '.c', '.cpp', '.h', '.java',
  // Config files
  '.cfg', '.conf', '.ini'
]);
