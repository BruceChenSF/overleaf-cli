import fetch, { Response } from 'node-fetch';
import { ProjectFile, DocContentResponse, OverleafAPIError } from './types';

const OVERLEAF_BASE_URL = 'https://cn.overleaf.com';

export class OverleafAPIClient {
  constructor(private cookies: Map<string, string>) {}

  /**
   * Fetch document content by doc_id
   */
  async getDocContent(projectId: string, docId: string): Promise<string> {
    const url = `${OVERLEAF_BASE_URL}/project/${projectId}/doc/${docId}`;

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

    const data = (await response.json()) as DocContentResponse;
    return data.content;
  }

  /**
   * Fetch complete project file list
   */
  async getProjectFiles(projectId: string): Promise<ProjectFile[]> {
    const url = `${OVERLEAF_BASE_URL}/project/${projectId}/entities`;

    const response = await this.fetchWithAuth(url);

    if (!response.ok) {
      throw new OverleafAPIError(
        `Failed to fetch project files: ${response.statusText}`,
        response.status,
        url
      );
    }

    // Parse response based on actual API structure
    const data = await response.json() as unknown;

    // Handle different possible response formats
    if (Array.isArray(data)) {
      return data as ProjectFile[];
    } else if ((data as any).files && Array.isArray((data as any).files)) {
      return (data as any).files;
    } else {
      return [];
    }
  }

  /**
   * Fetch file content (for binary files)
   */
  async getFileContent(projectId: string, path: string): Promise<Buffer> {
    const url = `${OVERLEAF_BASE_URL}/project/${projectId}/file/${path}`;

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
  private async fetchWithAuth(url: string, options: any = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
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
