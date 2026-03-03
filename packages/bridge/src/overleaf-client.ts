import fetch from 'node-fetch';

export interface OverleafDoc {
  _id: string;
  name: string;
  path: string;
}

export class OverleafClient {
  private baseUrl: string;
  private sessionId: string;

  constructor(sessionCookie: string, domain: 'overleaf.com' | 'cn.overleaf.com' = 'overleaf.com') {
    this.baseUrl = `https://${domain === 'cn.overleaf.com' ? 'cn.' : 'www.'}overleaf.com`;
    this.sessionId = sessionCookie;
  }

  async getAllDocs(projectId: string): Promise<OverleafDoc[]> {
    const response = await fetch(`${this.baseUrl}/api/project/${projectId}/docs`, {
      headers: {
        'Cookie': `overleaf_session_id=${this.sessionId}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch docs: ${response.statusText}`);
    }

    const data = await response.json() as { docs: OverleafDoc[] };
    return data.docs || [];
  }

  async getDocContent(projectId: string, docId: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/project/${projectId}/doc/${docId}`, {
      headers: {
        'Cookie': `overleaf_session_id=${this.sessionId}`
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
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content, source: 'browser' })
    });

    if (!response.ok) {
      throw new Error(`Failed to update doc: ${response.statusText}`);
    }
  }
}
