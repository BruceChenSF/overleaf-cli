import { MirrorClient } from '../client';
import { OverleafWebSocketClient } from './overleaf-sync';
import { EditorUpdater } from './editor-updater';

interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  content?: string;
  doc_id?: string;
  timestamp: number;
}

interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  timestamp: number;
}

export class OverleafAPIHandler {
  private editorUpdater: EditorUpdater;

  constructor(
    private mirrorClient: MirrorClient,
    private projectId: string,
    private overleafWsClient: OverleafWebSocketClient | null = null
  ) {
    this.editorUpdater = new EditorUpdater();
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    context: string,
    maxRetries: number = 3,
    initialDelay: number = 1000
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxRetries - 1) {
          throw error;
        }

        const delay = initialDelay * Math.pow(2, i);
        console.warn(`[APIHandler] ⚠️ ${context} failed (attempt ${i + 1}/${maxRetries}), retrying in ${delay}ms...`);

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`${context}: Max retries exceeded`);
  }

  async handleSyncRequest(message: SyncToOverleafMessage): Promise<void> {
    try {
      console.log(`[APIHandler] 📢 Received sync request: ${message.operation} ${message.path}`);
      console.log(`[APIHandler]    doc_id: ${message.doc_id || '(none)'}`);
      console.log(`[APIHandler]    content length: ${message.content?.length || 0}`);
      if (message.oldPath) {
        console.log(`[APIHandler]    oldPath: ${message.oldPath}`);
      }

      // 🔍 Only log for now, don't execute actual sync
      console.log(`[APIHandler] 🔍 [TEST MODE] Would execute: ${message.operation.toUpperCase()} ${message.path}`);

      switch (message.operation) {
        case 'update':
          console.log(`[APIHandler] 📝 [UPDATE] Would update doc ${message.doc_id} with ${message.content?.length || 0} chars`);
          // TODO: Implement actual update
          break;
        case 'create':
          console.log(`[APIHandler] ➕ [CREATE] Would create file: ${message.path}`);
          console.log(`[APIHandler]    Content length: ${message.content?.length || 0}`);
          console.log(`[APIHandler]    Would parse filename from path`);
          console.log(`[APIHandler]    Would call POST /project/${this.projectId}/doc`);
          // TODO: Implement actual create
          break;
        case 'delete':
          console.log(`[APIHandler] 🗑️ [DELETE] Would delete doc ${message.doc_id}`);
          console.log(`[APIHandler]    Path: ${message.path}`);
          console.log(`[APIHandler]    Would call DELETE /project/${this.projectId}/doc/${message.doc_id}`);
          // TODO: Implement actual delete
          break;
        case 'rename':
          console.log(`[APIHandler] ✏️ [RENAME] Would rename file`);
          console.log(`[APIHandler]    Old path: ${message.oldPath}`);
          console.log(`[APIHandler]    New path: ${message.path}`);
          console.log(`[APIHandler]    doc_id: ${message.doc_id}`);
          console.log(`[APIHandler]    Would call PUT /api/project/${this.projectId}/doc/${message.doc_id}/rename`);
          // TODO: Implement actual rename
          break;
        default:
          console.error(`[APIHandler] ❌ Unknown operation: ${message.operation}`);
          throw new Error(`Unknown operation: ${message.operation}`);
      }

      // Send success response (test mode)
      this.mirrorClient.send({
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: message.operation,
        path: message.path,
        oldPath: message.oldPath,
        success: true,
        timestamp: Date.now()
      });

      console.log(`[APIHandler] ✅ [TEST MODE] Sent success response for ${message.operation}`);
    } catch (error) {
      console.error(`[APIHandler] ❌ ${message.operation} failed:`, error);

      this.mirrorClient.send({
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: message.operation,
        path: message.path,
        oldPath: message.oldPath,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now()
      });
    }
  }

  private async updateDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    if (!message.doc_id) {
      throw new Error('doc_id is required for update operation');
    }

    if (message.content === undefined) {
      throw new Error('Content is required for update operation');
    }

    // Use EditorUpdater to update document
    console.log(`[APIHandler] 📝 Updating doc via EditorUpdater: ${message.path}`);

    try {
      const syncId = await this.editorUpdater.updateDocument(
        message.doc_id,
        message.content
      );
      console.log(`[APIHandler] ✅ Updated via EditorUpdater (syncId: ${syncId}): ${message.path}`);

      return {
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: 'update',
        path: message.path,
        success: true,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[APIHandler] ❌ EditorUpdater failed:`, error);
      throw error;
    }
  }

  private async createDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    // Parse path
    const pathParts = message.path.split('/');
    const fileName = pathParts.pop() || message.path;

    // Create document
    const response = await this.retryWithBackoff(
      async () => await fetch(
        `/project/${this.projectId}/doc`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: fileName,
            parent_folder_id: 'rootFolder'
          })
        }
      ),
      `Create ${message.path}`
    );

    if (!response.ok) {
      throw new Error(`Create failed: ${response.status} ${response.statusText}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new Error(`Failed to parse response: ${parseError}`);
    }

    if (!data._id) {
      throw new Error('Response missing _id field');
    }

    console.log(`[APIHandler] ✅ Created: ${message.path} (id: ${data._id})`);

    // Immediately update content
    await this.updateDocument({
      ...message,
      doc_id: data._id
    });

    return {
      type: 'sync_to_overleaf_response',
      project_id: this.projectId,
      operation: 'create',
      path: message.path,
      success: true,
      doc_id: data._id,
      timestamp: Date.now()
    };
  }

  private async deleteDocument(message: SyncToOverleafMessage): Promise<SyncToOverleafResponse> {
    if (!message.doc_id) {
      throw new Error('doc_id is required for delete operation');
    }

    const response = await this.retryWithBackoff(
      async () => await fetch(
        `/project/${this.projectId}/doc/${message.doc_id}`,
        {
          method: 'DELETE'
        }
      ),
      `Delete ${message.path}`
    );

    // 404 is also success (file already deleted)
    if (!response.ok && response.status !== 404) {
      throw new Error(`Delete failed: ${response.status} ${response.statusText}`);
    }

    console.log(`[APIHandler] ✅ Deleted: ${message.path}`);

    return {
      type: 'sync_to_overleaf_response',
      project_id: this.projectId,
      operation: 'delete',
      path: message.path,
      success: true,
      timestamp: Date.now()
    };
  }
}
