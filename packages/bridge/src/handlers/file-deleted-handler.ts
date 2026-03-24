import { promises as fs } from 'fs';
import path from 'path';

export async function handleFileDeleted(data: { path: string; docId?: string }, workspaceDir: string): Promise<void> {
  const filePath = path.join(workspaceDir, data.path);

  try {
    // Check if file exists
    await fs.access(filePath);

    // Delete the file
    await fs.unlink(filePath);
    console.log(`🗑️  [Bridge] Deleted file: ${data.path}`);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.warn(`⚠️  [Bridge] File does not exist, skipping deletion: ${data.path}`);
    } else {
      console.error(`✗ [Bridge] Failed to delete ${data.path}:`, error);
      throw error;
    }
  }
}
