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

    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new OverleafAPIError(
        `Failed to fetch project files: ${response.statusText}`,
        response.status,
        url
      );
    }

    const data = (await response.json()) as unknown;

    // Handle different possible response formats with proper type guards
    if (Array.isArray(data)) {
      return data as ProjectFile[];
    } else if (hasFilesArray(data)) {
      return data.files as ProjectFile[];
    } else {
      return [];
    }
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
