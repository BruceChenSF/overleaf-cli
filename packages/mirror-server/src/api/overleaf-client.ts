import fetch, { Response } from 'node-fetch';
import { ProjectFile, OverleafAPIError } from './types';

// NOTE: Using node-fetch@2.x because this is a CommonJS project.
// node-fetch@3+ is ESM-only and incompatible with CommonJS.
// When migrating to ESM, upgrade to node-fetch@3+ or use native fetch (Node 18+).
const OVERLEAF_BASE_URL = 'https://cn.overleaf.com';

/**
 * Type guard to check if object has a 'files' property that is an array
 */
function hasFilesArray(data: unknown): data is { files: unknown[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'files' in data &&
    Array.isArray((data as { files: unknown }).files)
  );
}

/**
 * Type guard to check if object has an 'entities' property that is an array
 */
function hasEntitiesArray(data: unknown): data is { entities: unknown[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'entities' in data &&
    Array.isArray((data as { entities: unknown }).entities)
  );
}

export class OverleafAPIClient {
  constructor(
    private cookies: Map<string, string>,
    private baseUrl: string = OVERLEAF_BASE_URL
  ) {}

  /**
   * Fetch document content by doc_id
   */
  async getDocContent(projectId: string, docId: string): Promise<string> {
    // Input validation
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('projectId must be a non-empty string');
    }
    if (!docId || typeof docId !== 'string') {
      throw new Error('docId must be a non-empty string');
    }

    const url = `${this.baseUrl}/project/${projectId}/doc/${docId}`;

    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new OverleafAPIError(
          'Authentication failed. Please check your Overleaf session.',
          response.status,
          url
        );
      }
      throw new OverleafAPIError(
        `Failed to fetch doc: ${response.statusText}`,
        response.status,
        url
      );
    }

    let data: unknown;
    try {
      data = (await response.json()) as unknown;
    } catch (error) {
      throw new OverleafAPIError(
        'Invalid response format: malformed JSON',
        response.status,
        url
      );
    }

    // Validate response structure
    if (
      typeof data !== 'object' ||
      data === null ||
      !('content' in data) ||
      typeof (data as { content: unknown }).content !== 'string'
    ) {
      throw new OverleafAPIError(
        'Invalid response format: missing or invalid content field',
        response.status,
        url
      );
    }

    return (data as { content: string }).content;
  }

  /**
   * Fetch complete project file list
   */
  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    // Input validation
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('projectId must be a non-empty string');
    }

    const url = `${this.baseUrl}/project/${projectId}/entities`;
    console.log('[OverleafAPI] 📋 Fetching project files from:', url);

    const response = await this.fetchWithAuth(url);

    console.log('[OverleafAPI] 📊 Response status:', response.status, response.statusText);

    if (!response.ok) {
      throw new OverleafAPIError(
        `Failed to fetch project files: ${response.statusText}`,
        response.status,
        url
      );
    }

    const data = (await response.json()) as unknown;
    console.log('[OverleafAPI] 📦 Response data type:', Array.isArray(data) ? 'array' : typeof data);
    console.log('[OverleafAPI] 📦 Response data keys:', typeof data === 'object' && data !== null ? Object.keys(data) : 'N/A');

    // 🔧 打印完整的第一个和第二个 entity 来查看结构
    if (hasEntitiesArray(data) && data.entities.length > 0) {
      console.log('[OverleafAPI] 📦 First entity structure:', JSON.stringify(data.entities[0], null, 2));
      if (data.entities.length > 1) {
        console.log('[OverleafAPI] 📦 Second entity structure:', JSON.stringify(data.entities[1], null, 2));
      }
    }

    console.log('[OverleafAPI] 📦 Total entities:', hasEntitiesArray(data) ? data.entities.length : 'N/A');

    // 🔧 尝试获取一个文档的完整实体信息
    if (hasEntitiesArray(data) && data.entities.length > 0) {
      const firstDoc = data.entities.find((e: unknown) => {
        return typeof e === 'object' && e !== null && 'type' in e && (e as { type: string }).type === 'doc';
      });
      if (firstDoc && typeof firstDoc === 'object') {
        console.log('[OverleafAPI] 🔍 First doc keys:', Object.keys(firstDoc));
      }
    }

    // Handle different possible response formats with proper type guards
    if (Array.isArray(data)) {
      console.log('[OverleafAPI] ✅ Returning array with', data.length, 'files');
      return data as ProjectFile[];
    } else if (hasFilesArray(data)) {
      console.log('[OverleafAPI] ✅ Returning files array with', data.files.length, 'files');
      return data.files as ProjectFile[];
    } else if (hasEntitiesArray(data)) {
      // 🔧 新增：处理 entities 格式
      console.log('[OverleafAPI] ✅ Found entities array with', data.entities.length, 'items');
      // 转换 entities 格式到 ProjectFile 格式
      const files: ProjectFile[] = data.entities
        .filter((entity: unknown) => {
          // 只包含文档类型（排除文件夹和文件）
          return (
            typeof entity === 'object' &&
            entity !== null &&
            'type' in entity &&
            (entity as { type: string }).type === 'doc'
          );
        })
        .map((entity: unknown) => {
          const e = entity as { path: string; type: string };
          // 从路径中提取文件名
          const name = e.path.startsWith('/') ? e.path.substring(1) : e.path;
          return {
            _id: name, // 使用文件名作为 _id（后续可以通过其他 API 获取真实 ID）
            name: name,
            path: e.path,
            type: e.type as 'doc' | 'file' | 'folder',
            created: new Date().toISOString(),
            updated: new Date().toISOString()
          };
        });
      console.log('[OverleafAPI] ✅ Converted to ProjectFile format:', files.length, 'docs');
      return files;
    } else {
      console.warn('[OverleafAPI] ⚠️ Unknown response format, returning empty array');
      return [];
    }
  }

  /**
   * Fetch all documents with complete metadata (including _id)
   * This uses the /api/project/{projectId}/docs endpoint
   *
   * @param projectId - Project ID
   * @returns Array of documents with complete metadata
   */
  async getAllDocuments(projectId: string): Promise<Array<{ _id: string; path: string; name: string }>> {
    // Input validation
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('projectId must be a non-empty string');
    }

    const url = `${this.baseUrl}/api/project/${projectId}/docs`;
    console.log('[OverleafAPI] 📋 Fetching all documents from:', url);

    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new OverleafAPIError(
        `Failed to fetch documents: ${response.statusText}`,
        response.status,
        url
      );
    }

    const data = (await response.json()) as unknown;
    console.log('[OverleafAPI] 📦 Docs response type:', Array.isArray(data) ? 'array' : typeof data);
    console.log('[OverleafAPI] 📦 Docs response keys:', typeof data === 'object' && data !== null ? Object.keys(data) : 'N/A');

    // Handle response format
    let docs: Array<{ _id: string; path: string; name: string }> = [];

    if (Array.isArray(data)) {
      docs = data as any;
    } else if (typeof data === 'object' && data !== null && 'docs' in data) {
      docs = (data as { docs: any[] }).docs;
    }

    console.log('[OverleafAPI] ✅ Found', docs.length, 'documents');

    // 打印第一个文档的结构
    if (docs.length > 0) {
      console.log('[OverleafAPI] 📦 First doc structure:', JSON.stringify(docs[0], null, 2));
    }

    return docs;
  }

  /**
   * Fetch file content (for binary files)
   */
  async getFileContent(projectId: string, path: string): Promise<Buffer> {
    // Input validation
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('projectId must be a non-empty string');
    }
    if (!path || typeof path !== 'string') {
      throw new Error('path must be a non-empty string');
    }

    const url = `${this.baseUrl}/project/${projectId}/file/${encodeURIComponent(path)}`;

    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new OverleafAPIError(
        `Failed to fetch file: ${response.statusText}`,
        response.status,
        url
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Fetch document content by blob hash
   *
   * @param projectId - Project ID
   * @param blobHash - Blob hash
   * @returns Document content as plain text
   */
  async getBlobContent(projectId: string, blobHash: string): Promise<string> {
    // Input validation
    if (!projectId || typeof projectId !== 'string') {
      throw new Error('projectId must be a non-empty string');
    }
    if (!blobHash || typeof blobHash !== 'string') {
      throw new Error('blobHash must be a non-empty string');
    }

    const url = `${this.baseUrl}/project/${projectId}/blob/${blobHash}`;
    console.log('[OverleafAPI] 📥 Fetching blob content from:', url);

    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new OverleafAPIError(
        `Failed to fetch blob: ${response.statusText}`,
        response.status,
        url
      );
    }

    // Blob 端点返回原始文本内容（不是 JSON）
    const content = await response.text();
    console.log('[OverleafAPI] ✅ Blob content fetched:', content.length, 'chars');

    return content;
  }

  /**
   * Make authenticated fetch request
   */
  private async fetchWithAuth(
    url: string,
    options: Record<string, unknown> = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
      'Cookie': this.formatCookies(),
      'Accept': 'application/json'
    };

    return fetch(url, { ...options, headers }) as Promise<Response>;
  }

  /**
   * Format cookies for HTTP header
   */
  private formatCookies(): string {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}
