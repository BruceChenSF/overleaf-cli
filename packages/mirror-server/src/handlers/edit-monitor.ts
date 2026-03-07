import { EditEventMessage, AnyOperation } from '@overleaf-cc/shared';
import { ProjectConfigStore } from '../config/store';
import { OverleafAPIClient } from '../api/overleaf-client';
import { TextFileSyncManager } from '../sync/text-file-sync';

/**
 * Handle edit monitor events with real file system operations
 */
export function handleEditMonitor(
  message: EditEventMessage,
  configStore: ProjectConfigStore
): void {
  const { project_id, data } = message;

  try {
    // Get or create project config
    const projectConfig = configStore.getProjectConfig(project_id);

    console.log('\n' + '='.repeat(60));
    console.log('[EditMonitor] Document edited:', data.doc_name || data.doc_id);
    console.log('  Project ID:', project_id);
    console.log('  Local Path:', projectConfig.localPath);
    console.log('  Doc ID:', data.doc_id);
    console.log('  Version:', data.version);

    if (data.meta) {
      console.log('  Source:', data.meta.source);
      console.log('  User ID:', data.meta.user_id);
      console.log('  Time:', new Date(data.meta.timestamp).toLocaleString('zh-CN'));
    }

    console.log('\n  Operations:');
    if (data.ops.length === 0) {
      console.log('    (no operations)');
    } else {
      data.ops.forEach((op: AnyOperation, index: number) => {
        if ('i' in op) {
          console.log(`    ${index + 1}. Insert "${op.i}" at position ${op.p}`);
        } else if ('d' in op) {
          console.log(`    ${index + 1}. Delete "${op.d}" at position ${op.p}`);
        } else if ('p' in op) {
          console.log(`    ${index + 1}. Retain/Cursor to position ${op.p}`);
        }
      });
    }

    console.log('='.repeat(60) + '\n');

    // TODO: Create TextFileSyncManager and apply ops
    // This will be implemented in next task after cookie handling is complete

  } catch (error) {
    console.error('[EditMonitor] Error handling edit event:', error);
  }
}

// 格式化 ops 为更易读的格式（用于调试）
export function formatOps(ops: AnyOperation[]): string {
  return ops.map(op => {
    if ('i' in op) return `+${JSON.stringify(op.i)}@${op.p}`;
    if ('d' in op) return `-${JSON.stringify(op.d)}@${op.p}`;
    if ('p' in op) return `→${op.p}`;
    return JSON.stringify(op);
  }).join(', ');
}
