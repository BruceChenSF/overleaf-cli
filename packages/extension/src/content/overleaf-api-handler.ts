import { MirrorClient } from '../client';

interface SyncToOverleafMessage {
  type: 'sync_to_overleaf';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  content?: string;
  doc_id?: string;
  timestamp: number;
}

interface SyncToOverleafResponse {
  type: 'sync_to_overleaf_response';
  project_id: string;
  operation: 'update' | 'create' | 'delete';
  path: string;
  success: boolean;
  error?: string;
  doc_id?: string;
  timestamp: number;
}

export class OverleafAPIHandler {
  constructor(
    private mirrorClient: MirrorClient,
    private projectId: string
  ) {}

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
      console.log(`[APIHandler] ${message.operation} ${message.path}`);

      let result: SyncToOverleafResponse;

      switch (message.operation) {
        case 'update':
          result = await this.updateDocument(message);
          break;
        case 'create':
          result = await this.createDocument(message);
          break;
        case 'delete':
          result = await this.deleteDocument(message);
          break;
        default:
          throw new Error(`Unknown operation: ${message.operation}`);
      }

      this.mirrorClient.send(result);
    } catch (error) {
      console.error(`[APIHandler] ❌ ${message.operation} failed:`, error);

      this.mirrorClient.send({
        type: 'sync_to_overleaf_response',
        project_id: this.projectId,
        operation: message.operation,
        path: message.path,
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

    const response = await this.retryWithBackoff(
      async () => await fetch(
        `/project/${message.project_id}/doc/${message.doc_id}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            lines: message.content.split('\n'),
            version: -1
          })
        }
      ),
      `Update ${message.path}`
    );

    if (!response.ok) {
      throw new Error(`Update failed: ${response.status} ${response.statusText}`);
    }

    console.log(`[APIHandler] ✅ Updated: ${message.path}`);

    return {
      type: 'sync_to_overleaf_response',
      project_id: this.projectId,
      operation: 'update',
      path: message.path,
      success: true,
      timestamp: Date.now()
    };
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
