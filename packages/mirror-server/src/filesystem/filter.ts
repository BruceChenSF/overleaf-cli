/**
 * File extension filtering for Overleaf mirror
 * Whitelist approach: only sync files we understand
 */

export const SYNCABLE_EXTENSIONS = new Set([
  // Text files
  '.tex',
  '.bib',
  '.sty',
  '.cls',
  '.def',
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.py',
  '.js',
  '.ts',
  '.java',
  '.sh',
  '.bat',
  '.ps1',
  '.r',
  '.m',
  '.jl',
  // Image files (for Claude Code context)
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.eps',
  '.bmp',
  '.tiff',
  // PDF files (references)
  '.pdf',
]);

/**
 * Check if a file should be synced based on extension
 */
export function shouldSyncFile(filename: string): boolean {
  const ext = filename.toLowerCase();
  // Find the last dot
  const lastDotIndex = ext.lastIndexOf('.');
  if (lastDotIndex === -1) {
    return false; // No extension
  }
  const extension = ext.substring(lastDotIndex);
  return SYNCABLE_EXTENSIONS.has(extension);
}
