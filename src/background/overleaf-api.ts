import type { OverleafDoc } from '../shared/types';

const OVERLEAF_DOMAIN = 'overleaf.com';

export class OverleafAPI {
  private async getSessionCookie(): Promise<string> {
    const cookies = await chrome.cookies.getAll({
      domain: OVERLEAF_DOMAIN
    });

    console.log('[Overleaf API] Found cookies:', cookies.map(c => c.name));

    const sessionCookie = cookies.find(
      c => c.name === 'overleaf_session_id' || c.name === 'connect.sid'
    );

    if (!sessionCookie?.value) {
      console.error('[Overleaf API] No session cookie found. Available cookies:', cookies.map(c => ({
        name: c.name,
        domain: c.domain,
        value: c.value.substring(0, 20) + '...'
      })));
      throw new Error('Not logged in to Overleaf');
    }

    console.log('[Overleaf API] Session cookie found:', sessionCookie.name);
    return sessionCookie.value;
  }

  private async fetchAPI(endpoint: string, options?: RequestInit): Promise<Response> {
    const sessionId = await this.getSessionCookie();

    return fetch(`https://www.overleaf.com${endpoint}`, {
      ...options,
      headers: {
        'Cookie': `overleaf_session_id=${sessionId}`,
        'Content-Type': 'application/json',
        ...options?.headers
      },
      credentials: 'include'
    });
  }

  async getAllDocs(projectId: string): Promise<OverleafDoc[]> {
    const response = await this.fetchAPI(`/api/project/${projectId}/docs`);

    if (!response.ok) {
      throw new Error(`Failed to fetch docs: ${response.statusText}`);
    }

    const data = await response.json();
    return data.docs || [];
  }

  async getDocContent(projectId: string, docId: string): Promise<string> {
    const response = await this.fetchAPI(`/api/project/${projectId}/doc/${docId}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch doc: ${response.statusText}`);
    }

    const data = await response.json();
    return data.doc || '';
  }

  async updateDoc(projectId: string, docId: string, content: string): Promise<void> {
    const response = await this.fetchAPI(`/api/project/${projectId}/doc/${docId}`, {
      method: 'POST',
      body: JSON.stringify({ content, source: 'browser' })
    });

    if (!response.ok) {
      throw new Error(`Failed to update doc: ${response.statusText}`);
    }
  }
}

export const overleafAPI = new OverleafAPI();
