import fetch from 'node-fetch';

export interface OverleafDoc {
  _id: string;
  name: string;
  path: string;
}

export class OverleafClient {
  private baseUrl: string;
  private sessionId: string;
  private csrfToken: string;

  constructor(sessionCookie: string, csrfToken: string, domain: 'overleaf.com' | 'cn.overleaf.com' = 'overleaf.com') {
    this.baseUrl = `https://${domain === 'cn.overleaf.com' ? 'cn.' : 'www.'}overleaf.com`;
    // Decode URL-encoded session cookie
    this.sessionId = decodeURIComponent(sessionCookie);
    this.csrfToken = csrfToken;
  }

  async getAllDocs(projectId: string): Promise<OverleafDoc[]> {
    // Try multiple API endpoints that Overleaf might use
    const endpoints = [
      `/api/project/${projectId}/docs`,
      `/api/project/${projectId}/entities`,
      `/api/project/${projectId}/files`,
      `/project/${projectId}/docs`
    ];

    for (const endpoint of endpoints) {
      const url = `${this.baseUrl}${endpoint}`;
      console.log(`[OverleafClient] Trying: ${url}`);
      console.log(`[OverleafClient] Session cookie (first 10 chars): ${this.sessionId.substring(0, 10)}...`);
      console.log(`[OverleafClient] CSRF token (first 10 chars): ${this.csrfToken.substring(0, 10)}...`);

      const response = await fetch(url, {
        headers: {
          'Cookie': `overleaf_session_id=${this.sessionId}`,
          'X-CSRF-Token': this.csrfToken,
          'Content-Type': 'application/json'
        }
      });

      console.log(`[OverleafClient] Response status: ${response.status} ${response.statusText}`);

      if (response.ok) {
        const data = await response.json() as { docs?: OverleafDoc[]; entities?: OverleafDoc[]; files?: OverleafDoc[] };
        const docs = data.docs || data.entities || data.files || [];
        console.log(`[OverleafClient] Success! Got ${docs.length} docs from ${endpoint}`);
        return docs;
      }

      // Log error but try next endpoint
      const text = await response.text();
      console.log(`[OverleafClient] Failed: ${response.status} - ${text.substring(0, 100)}...`);
    }

    throw new Error('Failed to fetch docs from all endpoints');
  }

  async getDocContent(projectId: string, docId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/project/${projectId}/doc/${docId}`, {
      headers: {
        'Cookie': `overleaf_session_id=${this.sessionId}`,
        'X-CSRF-Token': this.csrfToken
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch doc: ${response.statusText}`);
    }

    const data = await response.json() as { doc: string };
    return data.doc || '';
  }

  async updateDoc(projectId: string, docId: string, content: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/project/${projectId}/doc/${docId}`, {
      method: 'POST',
      headers: {
        'Cookie': `overleaf_session_id=${this.sessionId}`,
        'X-CSRF-Token': this.csrfToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content, source: 'browser' })
    });

    if (!response.ok) {
      throw new Error(`Failed to update doc: ${response.statusText}`);
    }
  }
}
