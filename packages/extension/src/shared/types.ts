/**
 * Shared types for browser extension
 * (Mirrors server types for Type safety)
 */

export type WSMessage =
  | MirrorRequestMessage
  | SyncCommandMessage
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
