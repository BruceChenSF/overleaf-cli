import chokidar from 'chokidar';
import { promises as fs } from 'fs';
import path from 'path';
import { OverleafClient } from './overleaf-client.js';

export class SyncManager {
  private overleafClient: OverleafClient;
  private projectId: string;
  private localDir: string;
  private fileCache: Map<string, string> = new Map();
  private watcher?: chokidar.FSWatcher;

  constructor(overleafClient: OverleafClient, projectId: string, localDir: string) {
    this.overleafClient = overleafClient;
    this.projectId = projectId;
    this.localDir = localDir;
  }

  async initialSync(): Promise<void> {
    console.log('[Sync] Fetching project files from Overleaf...');

    const docs = await this.overleafClient.getAllDocs(this.projectId);
    console.log(`[Sync] Found ${docs.length} documents`);

    for (const doc of docs) {
      const content = await this.overleafClient.getDocContent(this.projectId, doc._id);
      const filePath = path.join(this.localDir, doc.path);

      // Create directory structure
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write file
      await fs.writeFile(filePath, content, 'utf-8');
      this.fileCache.set(doc.path, content);

      console.log(`[Sync] Downloaded: ${doc.path}`);
    }

    console.log('[Sync] Initial sync complete');
  }

  startWatching(): void {
    console.log('[Sync] Watching for file changes...');

    this.watcher = chokidar.watch(this.localDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true
    });

    this.watcher.on('change', async (filePath) => {
      const relativePath = path.relative(this.localDir, filePath);
      await this.uploadFile(relativePath);
    });

    this.watcher.on('add', async (filePath) => {
      const relativePath = path.relative(this.localDir, filePath);
      await this.uploadFile(relativePath);
    });
  }

  private async uploadFile(relativePath: string): Promise<void> {
    try {
      const content = await fs.readFile(path.join(this.localDir, relativePath), 'utf-8');
      const cachedContent = this.fileCache.get(relativePath);

      // Only upload if content changed
      if (content !== cachedContent) {
        console.log(`[Sync] Uploading: ${relativePath}`);

        // Find doc ID by path (simplified - in real implementation, cache doc IDs)
        const docs = await this.overleafClient.getAllDocs(this.projectId);
        const doc = docs.find(d => d.path === relativePath);

        if (doc) {
          await this.overleafClient.updateDoc(this.projectId, doc._id, content);
          this.fileCache.set(relativePath, content);
          console.log(`[Sync] Uploaded: ${relativePath}`);
        }
      }
    } catch (error) {
      console.error(`[Sync] Error uploading ${relativePath}:`, error);
    }
  }

  stop(): void {
    this.watcher?.close();
  }
}
