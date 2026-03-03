import type { OverleafDoc } from '../shared/types';

const OVERLEAF_DOMAINS = ['overleaf.com', 'cn.overleaf.com'];

export class OverleafAPI {
  private async getSessionCookie(): Promise<string> {
    // Try all possible Overleaf domains
    let allCookies: chrome.cookies.Cookie[] = [];

    for (const domain of OVERLEAF_DOMAINS) {
      const cookies = await chrome.cookies.getAll({ domain });
      console.log(`[Overleaf API] Found ${cookies.length} cookies for domain: ${domain}`);
      allCookies = allCookies.concat(cookies);
    }

    // Log ALL cookies with full details
    console.log('[Overleaf API] All cookies found:');
    allCookies.forEach((c, i) => {
      console.log(`  ${i + 1}. name="${c.name}" domain="${c.domain}" value="${c.value.substring(0, 30)}..."`);
    });

    // Try multiple possible session cookie names
    const sessionCookie = allCookies.find(
      c => c.name === 'overleaf_session_id' ||
           c.name === 'connect.sid' ||
           c.name === 'koa.sid' ||
           c.name === 'sessionId' ||
           c.name.includes('session') ||
           c.name.includes('sid')
    );

    if (!sessionCookie?.value) {
      console.error('[Overleaf API] No session cookie found!');
      console.error('[Overleaf API] Available cookie names:', allCookies.map(c => c.name).join(', '));
      throw new Error('Not logged in to Overleaf');
    }

    console.log('[Overleaf API] ✓ Session cookie found:', sessionCookie.name, 'domain:', sessionCookie.domain);
    return sessionCookie.value;
  }

  private getBaseUrl(): string {
    // Detect if using CN version
    return 'https://www.overleaf.com'; // Default
  }

  private async fetchAPI(endpoint: string, options?: RequestInit): Promise<Response> {
    const sessionId = await this.getSessionCookie();
    const cookieInfo = await this.getCookieInfo();

    // Use the same domain as the cookie
    const baseUrl = cookieInfo.domain.includes('cn')
      ? 'https://cn.overleaf.com'
      : 'https://www.overleaf.com';

    console.log('[Overleaf API] Fetching:', baseUrl + endpoint);

    return fetch(baseUrl + endpoint, {
      ...options,
      headers: {
        'Cookie': `${cookieInfo.name}=${sessionId}`,
        'Content-Type': 'application/json',
        ...options?.headers
      },
      credentials: 'include'
    });
  }

  private async getCookieInfo(): Promise<{ name: string; domain: string }> {
    let allCookies: chrome.cookies.Cookie[] = [];

    for (const domain of OVERLEAF_DOMAINS) {
      const cookies = await chrome.cookies.getAll({ domain });
      allCookies = allCookies.concat(cookies);
    }

    const sessionCookie = allCookies.find(
      c => c.name === 'overleaf_session_id' ||
           c.name === 'connect.sid' ||
           c.name === 'koa.sid' ||
           c.name === 'sessionId' ||
           c.name.includes('session') ||
           c.name.includes('sid')
    );

    if (!sessionCookie) {
      throw new Error('Not logged in to Overleaf');
    }

    return { name: sessionCookie.name, domain: sessionCookie.domain || '' };
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
