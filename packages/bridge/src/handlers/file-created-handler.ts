import { promises as fs } from 'fs';
import path from 'path';

export async function handleFileCreated(data: { path: string; docId?: string; name: string }, workspaceDir: string): Promise<void> {
  const filePath = path.join(workspaceDir, data.path);

  try {
    // Check if file already exists
    try {
      await fs.access(filePath);
      console.log(`⚠️  [Bridge] File already exists, skipping creation: ${data.path}`);
      return;
    } catch {
      // File doesn't exist, proceed with creation
    }

    // Create empty file
    await fs.writeFile(filePath, '', 'utf-8');
    console.log(`✓ [Bridge] Created empty file: ${data.path} (docId: ${data.docId})`);
  } catch (error: any) {
    console.error(`✗ [Bridge] Failed to create ${data.path}:`, error);
    throw error;
  }
}
