import { EditEventMessage, AnyOperation } from '@overleaf-cc/shared';

export function handleEditMonitor(message: EditEventMessage): void {
  const { project_id, data } = message;
  const { doc_id, doc_name, version, ops, meta } = data;

  console.log('\n' + '='.repeat(60));
  console.log('[EditMonitor] Document edited:', doc_name || doc_id);
  console.log('  Project ID:', project_id);
  console.log('  Doc ID:', doc_id);
  console.log('  Version:', version);

  if (meta) {
    console.log('  Source:', meta.source);
    console.log('  User ID:', meta.user_id);
    console.log('  Time:', new Date(meta.timestamp).toLocaleString('zh-CN'));
  }

  console.log('\n  Operations:');
  if (ops.length === 0) {
    console.log('    (no operations)');
  } else {
    ops.forEach((op: AnyOperation, index: number) => {
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
