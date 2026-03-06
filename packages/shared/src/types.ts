/**
 * Shared types for Overleaf Mirror system
 */

// OT 操作类型
export type AnyOperation = InsertOperation | DeleteOperation | RetainOperation;

export interface InsertOperation {
  i: string;  // 插入的文本
  p: number;  // 位置
}

export interface DeleteOperation {
  d: string;  // 删除的文本
  p: number;  // 位置
}

export interface RetainOperation {
  p: number;  // 光标移动位置
}

// 编辑事件消息（通过 WebSocket 发送）
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

// 文本文件扩展名白名单
export const TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  // LaTeX 相关
  '.tex', '.bib', '.cls', '.sty', '.def', '.bst',
  // 文本文件
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml',
  // 代码文件
  '.js', '.ts', '.jsx', '.tsx', '.py', '.c', '.cpp', '.h', '.java',
  // 配置文件
  '.cfg', '.conf', '.ini'
]);
